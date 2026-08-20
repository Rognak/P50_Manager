from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    can_view_employee_owned_by,
)
from app.models.employee import Employee
from app.models.mpk import AIJob
from app.schemas.ai_job import AIJobPublic

# Жёсткий таймаут на AI-задачу: если воркер не отчитался за это время —
# считаем зависшей. Должен быть >= WorkerSettings.job_timeout (300с).
AI_JOB_TIMEOUT_SECONDS = 360


async def _maybe_timeout(session, job: AIJob) -> AIJob:
    """Если задача queued/running дольше таймаута — помечаем error.
    Вызывается на каждый GET/list, чтобы фронт-polling быстро видел проблему."""
    if job.status not in ("queued", "running"):
        return job
    age = datetime.now(UTC) - (job.started_at or job.created_at)
    if age > timedelta(seconds=AI_JOB_TIMEOUT_SECONDS):
        job.status = "error"
        job.error = f"Превышен таймаут ({AI_JOB_TIMEOUT_SECONDS // 60} мин) — воркер не отчитался"
        job.finished_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(job)
    return job


router = APIRouter(
    prefix="/employees/{employee_id}/ai-jobs",
    tags=["ai-jobs"],
)


async def _ensure_owner(session, employee_id: int, current_user) -> Employee:
    q = await session.execute(select(Employee).where(Employee.id == employee_id))
    emp = q.scalar_one_or_none()
    if emp is None or not can_view_employee_owned_by(current_user, emp.owner_id):
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return emp


@router.get("/{job_id}", response_model=AIJobPublic)
async def get_job(
    employee_id: int,
    job_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(AIJob).where(AIJob.id == job_id, AIJob.employee_id == employee_id)
    )
    job = q.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    return await _maybe_timeout(session, job)


@router.post("/{job_id}/cancel", response_model=AIJobPublic)
async def cancel_job(
    employee_id: int,
    job_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    """Отменить задачу. Помечает AIJob в БД как error с пояснением «отменено».

    Для queued — дополнительно пробуем удалить из ARQ-очереди (best effort,
    чтобы воркер не подобрал её позже). Для running — пометка в БД сразу
    разрывает polling на фронте; задача в воркере доработает в фоне, но её
    результат уже не примут (status уже error)."""
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(AIJob).where(AIJob.id == job_id, AIJob.employee_id == employee_id)
    )
    job = q.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Задача не найдена")
    if job.status not in ("queued", "running"):
        # уже завершилась — отменять нечего
        return job

    job.status = "error"
    job.error = "Отменено пользователем"
    job.finished_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(job)
    return job


@router.get("", response_model=list[AIJobPublic])
async def list_jobs(
    employee_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    status: str | None = None,
    kind: str | None = None,
    target_kind: str | None = None,
    target_id: int | None = None,
    limit: int = 50,
):
    """Список задач сотрудника (для подхвата active jobs после refresh и для отладки).

    Параметры status и kind поддерживают перечисление через запятую:
    `status=queued,running` или `kind=meeting_questions,meeting_tasks`.
    """
    await _ensure_owner(session, employee_id, current_user)
    q = select(AIJob).where(AIJob.employee_id == employee_id)
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if statuses:
            q = q.where(AIJob.status.in_(statuses))
    if kind:
        kinds = [k.strip() for k in kind.split(",") if k.strip()]
        if kinds:
            q = q.where(AIJob.kind.in_(kinds))
    if target_kind:
        q = q.where(AIJob.target_kind == target_kind)
    if target_id is not None:
        q = q.where(AIJob.target_id == target_id)
    q = q.order_by(AIJob.id.desc()).limit(min(max(limit, 1), 200))
    result = await session.execute(q)
    jobs = list(result.scalars())
    for job in jobs:
        await _maybe_timeout(session, job)
    return jobs
