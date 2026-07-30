"""Обёртка над cron-handlers: пишет в `cron_runs` start/stop с status.

Также чекает «не приостановлен ли cron» через paused_cron_jobs setting.
"""
from __future__ import annotations

import contextvars
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Awaitable, Callable

from app.admin.settings import is_cron_paused
from app.db import SessionLocal
from app.models.admin import CronRun


# Список cron-задач, известных админ-панели. Должен совпадать с именами
# функций в worker.py:cron_jobs[*].coroutine.__name__.
KNOWN_CRON_JOBS: list[dict[str, str]] = [
    {
        "name": "refresh_stale_rotation_suggestions",
        "schedule": "вс 03:00 UTC",
        "description": "Обновить устаревшие AI-обоснования ротаций (>30 дней).",
    },
    {
        "name": "assignment_due_reminders",
        "schedule": "каждые 30 мин",
        "description": "Напоминания о приближении/просрочке дедлайна поручений.",
    },
    {
        "name": "stale_self_review_reminders",
        "schedule": "ежедневно 09:00 UTC",
        "description": "Зависшие Self-Review (submitted >14 дней; draft без файла >30 дней).",
    },
    {
        "name": "codebuddy_sync_projects",
        "schedule": "ежедневно 02:30 UTC",
        "description": "Авто-создание проектов из CodeBuddy: для каждого сотрудника тянем PR-ы за 30 дней, создаём недостающие Project + ProjectMember.",
    },
]


# ContextVar для проброса manual-trigger info в cron handlers через track_cron.
# Если cron вызвали через run_cron_by_name — track_cron внутри подхватит это
# и запишет trigger='manual' + triggered_by.
_manual_context: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "_cron_manual_context", default=None
)


def tracked_cron(cron_name: str):
    """Декоратор для cron-handler'а: оборачивает в track_cron, чекает паузу.
    Если cron приостановлен — возвращает {'paused': True} без выполнения тела.

    Использование:
        @tracked_cron("assignment_due_reminders")
        async def assignment_due_reminders(ctx):
            ... основная работа ...
    """
    def decorator(fn):
        async def wrapped(ctx):
            async with track_cron(cron_name) as run_id:
                if run_id is None:
                    return {"paused": True}
                return await fn(ctx)
        # ARQ registers по __qualname__ / __name__ — сохраним совместимость
        wrapped.__name__ = cron_name
        wrapped.__qualname__ = cron_name
        wrapped.__doc__ = fn.__doc__
        return wrapped
    return decorator


@asynccontextmanager
async def track_cron(cron_name: str):
    """Контекст-менеджер для оборачивания cron-handler'ов.

    1) Проверяет paused — если да, пишет run('ok', 'paused') и yield'ит None.
    2) Создаёт CronRun(status='running').
    3) После выхода — обновляет на 'ok' или 'error' с сообщением.

    Trigger детектится через ContextVar: если выставлен через
    `run_cron_by_name` — 'manual' + triggered_by, иначе — 'scheduled'.

    Использование (в cron-handler'е):
        async def assignment_due_reminders(ctx):
            async with track_cron('assignment_due_reminders') as run_id:
                if run_id is None: return       # paused
                ... основная работа ...
    """
    manual = _manual_context.get()
    trigger = "manual" if manual else "scheduled"
    triggered_by = manual.get("triggered_by") if manual else None

    # 1) проверка паузы
    async with SessionLocal() as s:
        paused = await is_cron_paused(s, cron_name)
    if paused:
        async with SessionLocal() as s:
            s.add(
                CronRun(
                    cron_name=cron_name,
                    trigger=trigger,
                    status="ok",
                    finished_at=datetime.now(UTC),
                    error_msg="paused",
                    triggered_by=triggered_by,
                )
            )
            await s.commit()
        yield None
        return

    # 2) старт
    run_id: int | None = None
    async with SessionLocal() as s:
        run = CronRun(
            cron_name=cron_name,
            trigger=trigger,
            status="running",
            triggered_by=triggered_by,
        )
        s.add(run)
        await s.commit()
        await s.refresh(run)
        run_id = run.id
    try:
        yield run_id
    except Exception as e:
        # 3) error
        async with SessionLocal() as s:
            row = await s.get(CronRun, run_id)
            if row is not None:
                row.status = "error"
                row.finished_at = datetime.now(UTC)
                row.error_msg = str(e)[:4000]
                await s.commit()
        raise
    else:
        # 3) ok
        async with SessionLocal() as s:
            row = await s.get(CronRun, run_id)
            if row is not None:
                row.status = "ok"
                row.finished_at = datetime.now(UTC)
                await s.commit()


async def run_cron_by_name(name: str, *, triggered_by: int) -> None:
    """Запустить cron-функцию по имени вручную (из админ-эндпойнта)."""
    from app.ai.cron import (
        assignment_due_reminders,
        codebuddy_sync_projects,
        refresh_stale_rotation_suggestions,
        stale_self_review_reminders,
    )

    registry: dict[str, Callable[[dict], Awaitable[None]]] = {
        "refresh_stale_rotation_suggestions": refresh_stale_rotation_suggestions,
        "assignment_due_reminders": assignment_due_reminders,
        "stale_self_review_reminders": stale_self_review_reminders,
        "codebuddy_sync_projects": codebuddy_sync_projects,
    }
    func = registry.get(name)
    if func is None:
        raise ValueError(f"Неизвестный cron: {name}")
    token = _manual_context.set({"triggered_by": triggered_by})
    try:
        await func({})  # ctx={} — у cron-функций сигнатура (ctx)
    finally:
        _manual_context.reset(token)
