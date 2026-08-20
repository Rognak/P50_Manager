"""ARQ cron-таски."""

import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from app.admin.cron_tracker import tracked_cron
from app.admin.settings import is_codebuddy_live
from app.codebuddy.client import CodeBuddyAPIError
from app.codebuddy.projects_sync import sync_projects_from_codebuddy
from app.codebuddy.service import codebuddy_service
from app.db import SessionLocal
from app.models.assignment import Assignment
from app.models.employee import Employee
from app.models.mpk import AIJob
from app.models.notification import Notification
from app.models.project import Project
from app.models.rotation import RotationSuggestion
from app.models.self_review import SelfReview
from app.notifications.service import publish_pending, record_notifications
from app.rotations.ranking import compute_candidates

logger = logging.getLogger(__name__)

# Свежим считаем обоснование, написанное за последние N дней
SUGGESTION_FRESH_DAYS = 14


@tracked_cron("refresh_stale_rotation_suggestions")
async def refresh_stale_rotation_suggestions(ctx) -> dict:
    """Раз в неделю: обходит все активные проекты, для каждого кандидата без свежего
    RotationSuggestion ставит в очередь run_rotation_suggestion.

    Не плодит дубликаты: пропускает, если уже есть queued/running AIJob того же
    kind с той же парой (employee_id, target_id).
    """
    pool = ctx["redis"]
    enqueued = 0
    skipped = 0

    async with SessionLocal() as session:
        active_q = await session.execute(select(Project.id).where(Project.status == "active"))
        project_ids = [pid for (pid,) in active_q.all()]

        # уже-в-работе AIJob'ы по ротациям
        running_q = await session.execute(
            select(AIJob.employee_id, AIJob.target_id).where(
                AIJob.kind == "rotation_suggestion",
                AIJob.status.in_(("queued", "running")),
            )
        )
        in_flight = {(eid, tid) for eid, tid in running_q.all()}

        # свежие suggestions
        cutoff = datetime.now(UTC) - timedelta(days=SUGGESTION_FRESH_DAYS)
        fresh_q = await session.execute(
            select(RotationSuggestion.employee_id, RotationSuggestion.from_project_id).where(
                RotationSuggestion.generated_at >= cutoff
            )
        )
        fresh_pairs = {(eid, pid) for eid, pid in fresh_q.all()}

        # система-юзер для created_by — берём id=1, иначе любого активного
        from app.models.user import User

        sys_user = await session.get(User, 1)
        if sys_user is None:
            uq = await session.execute(select(User).order_by(User.id).limit(1))
            sys_user = uq.scalar_one_or_none()
        if sys_user is None:
            return {"enqueued": 0, "skipped": 0, "error": "no users in db"}

        for pid in project_ids:
            candidates = await compute_candidates(session, pid)
            for c in candidates:
                if c.rotation_locked or c.pending_rotation_id is not None:
                    skipped += 1
                    continue
                if (c.employee_id, pid) in fresh_pairs:
                    skipped += 1
                    continue
                if (c.employee_id, pid) in in_flight:
                    skipped += 1
                    continue

                job = AIJob(
                    kind="rotation_suggestion",
                    status="queued",
                    employee_id=c.employee_id,
                    target_kind="rotation_suggestion",
                    target_id=pid,
                    payload={"reason": "weekly_cron"},
                    created_by=sys_user.id,
                )
                session.add(job)
                await session.commit()
                await session.refresh(job)
                await pool.enqueue_job("run_rotation_suggestion", job.id)
                enqueued += 1

    return {"enqueued": enqueued, "skipped": skipped}


# ---------- Уведомления о сроках поручений ----------


SOON_HOURS = 24  # за столько до дедлайна шлём «срок скоро»
DEDUP_WINDOW_HOURS = 23  # не дублируем напоминание чаще, чем раз в N часов


async def _recipients_for_assignment(session, a: Assignment) -> list[int]:
    """Кому слать напоминание: адресат-User либо владелец Employee-адресата,
    плюс инициатор (для прозрачности по своим поручениям)."""
    targets: list[int] = [a.created_by_id]
    if a.assignee_user_id is not None:
        targets.append(a.assignee_user_id)
    elif a.assignee_employee_id is not None:
        emp = await session.get(Employee, a.assignee_employee_id)
        if emp:
            targets.append(emp.owner_id)
    # дедуп — set + порядок
    return list(dict.fromkeys(targets))


async def _already_notified_recently(
    session, *, recipient_id: int, kind: str, payload_match: dict
) -> bool:
    """Не дублируем одну и ту же напоминалку чаще DEDUP_WINDOW_HOURS."""
    cutoff = datetime.now(UTC) - timedelta(hours=DEDUP_WINDOW_HOURS)
    q = await session.execute(
        select(Notification.id).where(
            Notification.recipient_user_id == recipient_id,
            Notification.kind == kind,
            Notification.created_at >= cutoff,
            Notification.payload.contains(payload_match),
        )
    )
    return q.scalar_one_or_none() is not None


@tracked_cron("assignment_due_reminders")
async def assignment_due_reminders(ctx) -> dict:  # noqa: ARG001
    """Раз в N минут: проходит активные поручения и шлёт уведомления:
      • `assignment_due_soon` — если до due_at <= SOON_HOURS и оно ещё не отправлено
      • `assignment_overdue`  — если due_at прошёл, и за последние сутки
        не уведомляли об этом
    Не выходим из активных статусов (open/in_progress/pending_review).
    """
    now = datetime.now(UTC)
    soon_until = now + timedelta(hours=SOON_HOURS)
    sent_soon = 0
    sent_overdue = 0

    async with SessionLocal() as session:
        active_statuses = ("open", "in_progress", "pending_review")
        q = await session.execute(
            select(Assignment).where(
                Assignment.status.in_(active_statuses),
                Assignment.due_at.is_not(None),
            )
        )
        rows = list(q.scalars())
        for a in rows:
            assert a.due_at is not None
            link = f"/assignments?id={a.id}"
            if a.due_at < now:
                # просрочено
                kind = "assignment_overdue"
                title = f"Просрочено: «{a.title}»"
                body = f"Срок прошёл {a.due_at.strftime('%d.%m.%Y %H:%M')}"
            elif a.due_at <= soon_until:
                # дедлайн в ближайшие 24ч
                kind = "assignment_due_soon"
                title = f"Скоро срок: «{a.title}»"
                body = f"До {a.due_at.strftime('%d.%m.%Y %H:%M')}"
            else:
                continue

            recipients = await _recipients_for_assignment(session, a)
            new_targets: list[int] = []
            for uid in recipients:
                if await _already_notified_recently(
                    session,
                    recipient_id=uid,
                    kind=kind,
                    payload_match={"assignment_id": a.id},
                ):
                    continue
                new_targets.append(uid)
            if not new_targets:
                continue

            notifs = await record_notifications(
                session,
                recipient_user_ids=new_targets,
                kind=kind,
                title=title,
                body=body,
                link=link,
                payload={"assignment_id": a.id},
            )
            await session.commit()
            await publish_pending(notifs)
            if kind == "assignment_overdue":
                sent_overdue += len(notifs)
            else:
                sent_soon += len(notifs)

    return {"due_soon": sent_soon, "overdue": sent_overdue}


# ---------- Зависшие Self-Review ----------


STALE_SELF_REVIEW_DAYS = 14


@tracked_cron("stale_self_review_reminders")
async def stale_self_review_reminders(ctx) -> dict:  # noqa: ARG001
    """Self-Review со статусом submitted, который висит без 1:1 / закрытия
    более STALE_SELF_REVIEW_DAYS — уведомляем владельца сотрудника."""
    cutoff = datetime.now(UTC) - timedelta(days=STALE_SELF_REVIEW_DAYS)
    sent = 0
    async with SessionLocal() as session:
        q = await session.execute(
            select(SelfReview, Employee)
            .join(Employee, Employee.id == SelfReview.employee_id)
            .where(
                SelfReview.status == "submitted",
                SelfReview.submitted_at.is_not(None),
                SelfReview.submitted_at < cutoff,
            )
        )
        rows = list(q.all())
        for rv, emp in rows:
            kind = "self_review_stuck"
            if await _already_notified_recently(
                session,
                recipient_id=emp.owner_id,
                kind=kind,
                payload_match={"self_review_id": rv.id},
            ):
                continue
            notifs = await record_notifications(
                session,
                recipient_user_ids=[emp.owner_id],
                kind=kind,
                title=f"Зависший Self-Review: {emp.full_name}",
                body=f"Отправлен > {STALE_SELF_REVIEW_DAYS} дней назад — нужно провести 1:1 / закрыть",
                link=f"/self-review/{emp.id}/{rv.id}",
                payload={"self_review_id": rv.id},
            )
            await session.commit()
            await publish_pending(notifs)
            sent += len(notifs)
    return {"reminders_sent": sent}


# Сколько дней назад смотреть в CodeBuddy при ежесуточной синхронизации.
# 30 дней — компромисс между «увидеть свежие проекты» и rate-limit CodeBuddy
# (60 req/min, и каждый сотрудник = 1 запрос /mrs).
_CODEBUDDY_PROJECTS_SYNC_DAYS = 30


@tracked_cron("codebuddy_sync_projects")
async def codebuddy_sync_projects(ctx) -> dict:  # noqa: ARG001
    """Ежесуточная синхронизация проектов из CodeBuddy.

    Для каждого активного сотрудника (с резолвящимся gitlab-username) тянет
    список PR-ов за последние 30 дней, выявляет уникальные projectId и
    автоматически создаёт `Project` + `ProjectMember`, если их ещё нет.

    Без эффекта, если `codebuddy_live` выключен.
    """
    async with SessionLocal() as session:
        if not await is_codebuddy_live(session):
            return {"skipped": True, "reason": "codebuddy_live=false"}

        eq = await session.execute(
            select(Employee).where(
                Employee.kind == "employee",
                Employee.left_at.is_(None),
            )
        )
        employees = list(eq.scalars())

    period_to = date.today()
    period_from = period_to - timedelta(days=_CODEBUDDY_PROJECTS_SYNC_DAYS)

    employees_checked = 0
    projects_created_total = 0
    members_added_total = 0
    errors = 0

    for emp in employees:
        try:
            prs = await codebuddy_service.get_pull_requests(emp, period_from, period_to, limit=100)
        except CodeBuddyAPIError as e:
            logger.warning(
                "codebuddy_sync_projects: skip emp #%s due to error: %s",
                emp.id,
                e,
            )
            errors += 1
            continue
        employees_checked += 1
        if not prs:
            continue
        seen = [
            (p.project_id, p.project_name, p.created_at_ext, p.url) for p in prs if p.project_id
        ]
        if not seen:
            continue
        async with SessionLocal() as session:
            try:
                # Перезагружаем сотрудника в свежей сессии — нам нужна только
                # его id для FK, объект сам по себе stateless для sync-хелпера.
                fresh = await session.get(Employee, emp.id)
                if fresh is None:
                    continue
                res = await sync_projects_from_codebuddy(session, fresh, seen)
                projects_created_total += res["created_projects"]
                members_added_total += res["added_members"]
            except Exception as e:  # noqa: BLE001
                logger.warning(
                    "codebuddy_sync_projects: failed for emp #%s: %s",
                    emp.id,
                    e,
                )
                errors += 1

    return {
        "employees_total": len(employees),
        "employees_checked": employees_checked,
        "projects_created": projects_created_total,
        "members_added": members_added_total,
        "errors": errors,
    }
