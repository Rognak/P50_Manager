"""ARQ-задачи для CodeBuddy-синхронизации.

Используются в трёх местах:
  1. Хуки create_employee / import-xlsx commit → enqueue с all_time=True
     для каждого нового сотрудника.
  2. Ручной запуск из админ-панели → enqueue с all_time=True для всех
     активных сотрудников.
  3. (Будущее) per-employee ручная кнопка.

Идемпотентны: повторный запуск не плодит дубликатов проектов/мемберов.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from app.admin.settings import is_codebuddy_live
from app.codebuddy.client import CodeBuddyAPIError
from app.codebuddy.projects_sync import sync_projects_from_codebuddy
from app.codebuddy.service import codebuddy_service
from app.db import SessionLocal
from app.models.employee import Employee

logger = logging.getLogger(__name__)


# Начальная дата для «всего времени». CodeBuddy раньше этой даты не
# содержит ничего полезного — Прогресс 50 как продукт моложе.
_EARLIEST_DATE = date(2018, 1, 1)


async def run_codebuddy_sync_projects(
    ctx,  # noqa: ARG001 — ARQ передаёт контекст; не используем
    employee_id: int,
    all_time: bool = False,
) -> dict:
    """Один сотрудник → синк проектов из CodeBuddy.

    `all_time=True` — за весь период (с _EARLIEST_DATE) с пагинацией.
    `all_time=False` — последние 30 дней, одной страницей (fallback для
    ручного per-employee вызова, если не нужен полный бэкфилл).
    """
    async with SessionLocal() as session:
        if not await is_codebuddy_live(session):
            return {"skipped": True, "reason": "codebuddy_live=false"}
        emp = await session.get(Employee, employee_id)
        if emp is None:
            return {"skipped": True, "reason": "employee not found"}
        full_name = emp.full_name

    period_to = date.today()
    if all_time:
        period_from = _EARLIEST_DATE
    else:
        period_from = period_to - timedelta(days=30)

    try:
        if all_time:
            prs = await codebuddy_service.iterate_all_pull_requests(
                emp, period_from, period_to
            )
        else:
            prs = await codebuddy_service.get_pull_requests(
                emp, period_from, period_to, limit=100
            )
    except CodeBuddyAPIError as e:
        logger.warning(
            "run_codebuddy_sync_projects: emp #%s (%s) failed: %s",
            employee_id, full_name, e,
        )
        return {"error": str(e), "status_code": e.status_code}

    if not prs:
        return {
            "employee_id": employee_id,
            "prs_seen": 0,
            "projects_created": 0,
            "members_added": 0,
        }

    seen = [
        (p.project_id, p.project_name, p.created_at_ext, p.url)
        for p in prs
        if p.project_id
    ]

    async with SessionLocal() as session:
        # Re-fetch внутри сессии, так как объект из предыдущей сессии detached.
        fresh = await session.get(Employee, employee_id)
        if fresh is None:
            return {"skipped": True, "reason": "employee deleted mid-flight"}
        res = await sync_projects_from_codebuddy(session, fresh, seen)

    logger.info(
        "codebuddy_sync_projects emp #%s (%s, all_time=%s): "
        "prs=%d, created=%d, members=%d, product_members=%d",
        employee_id, full_name, all_time, len(prs),
        res["created_projects"], res["added_members"],
        res["added_product_members"],
    )
    return {
        "employee_id": employee_id,
        "prs_seen": len(prs),
        "projects_created": res["created_projects"],
        "members_added": res["added_members"],
        "product_members_added": res["added_product_members"],
    }
