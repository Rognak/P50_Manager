"""ARQ worker. Запуск:  uv run arq app.worker.WorkerSettings"""
from datetime import UTC, datetime, timedelta

from arq import cron
from sqlalchemy import or_, update

from app.ai.cron import (
    assignment_due_reminders,
    codebuddy_sync_projects,
    refresh_stale_rotation_suggestions,
    stale_self_review_reminders,
)
from app.ai.tasks import (
    run_candidate_screening,
    run_digital_profile,
    run_employee_recommendation,
    run_meeting_questions,
    run_meeting_summary,
    run_meeting_tasks,
    run_procedure_preparation,
    run_product_performance_review,
    run_rotation_suggestion,
    run_self_review_burnout,
    run_self_review_calibration,
    run_self_review_compare,
    run_self_review_draft,
    run_self_review_topics,
)
from app.codebuddy.tasks import run_codebuddy_sync_projects
from app.db import SessionLocal
from app.models.mpk import AIJob
from app.redis_pool import close_redis, init_redis, redis_settings


async def _on_startup(_ctx) -> None:
    """Старт воркера: чистим зависшие задачи + поднимаем общий redis-pool
    (нужен для уведомлений-pubsub в notifications.hub).

    Зависшие задачи бывают двух типов:
      1) status='running' — воркер был прерван в середине обработки;
      2) status='queued' старше 5 минут — поставлены в очередь, но ARQ их
         не подхватил (например, имя task-функции не было зарегистрировано
         в WorkerSettings.functions на момент enqueue). ARQ их дропает,
         они зависают навсегда — чистим.
    """
    await init_redis()
    stuck_cutoff = datetime.now(UTC) - timedelta(minutes=5)
    async with SessionLocal() as session:
        await session.execute(
            update(AIJob)
            .where(
                or_(
                    AIJob.status == "running",
                    (AIJob.status == "queued")
                    & (AIJob.created_at < stuck_cutoff),
                )
            )
            .values(
                status="error",
                error="воркер был перезапущен или задача не подхватилась — задача прервана",
                finished_at=datetime.now(UTC),
            )
        )
        await session.commit()


async def _on_shutdown(_ctx) -> None:
    await close_redis()


class WorkerSettings:
    functions = [
        run_meeting_questions,
        run_meeting_tasks,
        run_meeting_summary,
        run_procedure_preparation,
        run_employee_recommendation,
        run_rotation_suggestion,
        run_self_review_topics,
        run_self_review_compare,
        run_self_review_burnout,
        run_self_review_calibration,
        run_self_review_draft,
        run_candidate_screening,
        run_digital_profile,
        run_codebuddy_sync_projects,
        run_product_performance_review,
    ]
    cron_jobs = [
        # каждое воскресенье 03:00 UTC — пересчёт устаревших обоснований ротации
        cron(
            refresh_stale_rotation_suggestions,
            weekday="sun",
            hour=3,
            minute=0,
            run_at_startup=False,
        ),
        # каждые 30 минут — напоминания по поручениям (срок скоро / просрочено)
        cron(
            assignment_due_reminders,
            minute={0, 30},
            run_at_startup=False,
        ),
        # каждый день в 09:00 UTC — зависшие Self-Review (>14 дней submitted)
        cron(
            stale_self_review_reminders,
            hour=9,
            minute=0,
            run_at_startup=False,
        ),
        # каждый день в 02:30 UTC — авто-синк проектов из CodeBuddy
        cron(
            codebuddy_sync_projects,
            hour=2,
            minute=30,
            run_at_startup=False,
        ),
    ]
    redis_settings = redis_settings()
    job_timeout = 300  # 5 минут на задачу
    max_jobs = 4
    keep_result = 60
    on_startup = _on_startup
    on_shutdown = _on_shutdown
