"""Helpers для чтения/записи системных настроек админ-панели.

Используется как из API (admin/*), так и из обработчиков (cron, notify-create)
чтобы проверять «включено ли это глобально».
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import (
    SETTING_KEY_ENABLED_NOTIFICATION_KINDS,
    SETTING_KEY_EXTERNAL_LINKS,
    SETTING_KEY_NAV_VISIBILITY,
    SETTING_KEY_PAUSED_CRON_JOBS,
    SystemSetting,
)


# ----- generic --------------------------------------------------------------


async def get_setting(session: AsyncSession, key: str) -> dict[str, Any]:
    """Получить настройку или {}, если её нет."""
    row = await session.get(SystemSetting, key)
    return dict(row.value) if row else {}


async def set_setting(
    session: AsyncSession, key: str, value: dict, updated_by: int | None
) -> SystemSetting:
    """Перезаписать настройку целиком. Caller сам делает commit."""
    row = await session.get(SystemSetting, key)
    if row is None:
        row = SystemSetting(key=key, value=value, updated_by=updated_by)
        session.add(row)
    else:
        row.value = value
        row.updated_by = updated_by
    await session.flush()
    return row


# ----- nav visibility -------------------------------------------------------


async def get_nav_visibility(session: AsyncSession) -> dict[str, dict[str, bool]]:
    return await get_setting(session, SETTING_KEY_NAV_VISIBILITY)


def is_nav_visible_for_role(
    nav_key: str, role: str, visibility: dict[str, dict[str, bool]]
) -> bool:
    """По умолчанию всё видно. Сохраняемое значение `false` скрывает."""
    if nav_key not in visibility:
        return True
    return visibility[nav_key].get(role, True)


# ----- enabled notification kinds ------------------------------------------


async def get_enabled_notification_kinds(
    session: AsyncSession,
) -> dict[str, bool]:
    return await get_setting(session, SETTING_KEY_ENABLED_NOTIFICATION_KINDS)


async def is_notification_kind_enabled(
    session: AsyncSession, kind: str
) -> bool:
    """По умолчанию все типы включены. Только явное `false` глушит kind."""
    enabled = await get_enabled_notification_kinds(session)
    if kind not in enabled:
        return True
    return bool(enabled[kind])


# ----- paused cron ----------------------------------------------------------


async def get_paused_cron_jobs(session: AsyncSession) -> dict[str, bool]:
    return await get_setting(session, SETTING_KEY_PAUSED_CRON_JOBS)


async def is_cron_paused(session: AsyncSession, cron_name: str) -> bool:
    """По умолчанию все cron-задачи активны. true => приостановлено."""
    paused = await get_paused_cron_jobs(session)
    return bool(paused.get(cron_name, False))


# ----- external links -------------------------------------------------------


async def get_external_links(session: AsyncSession) -> list[dict[str, str]]:
    """Список ссылок на смежные системы (DSTracker, CodeBuddy, …).

    Возвращает list, а не dict — каждая ссылка вида `{"label", "url"}`.
    Если ничего не задано — пустой список.
    """
    raw = await get_setting(session, SETTING_KEY_EXTERNAL_LINKS)
    return list(raw.get("links", []))


# ----- integrations / feature flags ----------------------------------------


async def get_integrations(session: AsyncSession) -> dict[str, bool]:
    """Карта on/off для интеграций. Дефолт — все выключены."""
    return await get_setting(session, "integrations")


async def is_codebuddy_live(session: AsyncSession) -> bool:
    """Использовать CodeBuddy live API вместо mock-таблиц? Дефолт — False."""
    flags = await get_integrations(session)
    return bool(flags.get("codebuddy_live", False))
