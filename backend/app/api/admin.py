"""API админ-панели: feature flags, notifications, cron."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import delete, select
from sqlalchemy.engine import CursorResult

from app.admin.cron_tracker import KNOWN_CRON_JOBS, run_cron_by_name
from app.admin.settings import (
    get_enabled_notification_kinds,
    get_external_links,
    get_integrations,
    get_nav_visibility,
    get_paused_cron_jobs,
    get_setting,
    is_codebuddy_live,
    set_setting,
)
from app.ai.client import make_client, resolve_ai_config
from app.api.deps import AdminUser, SessionDep
from app.codebuddy.cache import invalidate as invalidate_codebuddy_cache
from app.codebuddy.client import CodeBuddyAPIError
from app.codebuddy.service import codebuddy_service
from app.gitlab_status import resolve_gitlab_config
from app.models.admin import (
    SETTING_KEY_ENABLED_NOTIFICATION_KINDS,
    SETTING_KEY_EXTERNAL_LINKS,
    SETTING_KEY_INTEGRATIONS,
    SETTING_KEY_GITLAB,
    SETTING_KEY_LLM,
    SETTING_KEY_NAV_VISIBILITY,
    SETTING_KEY_PAUSED_CRON_JOBS,
    CronRun,
)
from app.models.employee import Employee
from app.models.notification import Notification
from app.models.technology import TechnologyCatalogEntry
from app.models.user import User
from app.redis_pool import get_pool as get_arq_pool
from app.notifications.service import publish_pending, record_notifications
from app.schemas.admin import (
    CacheInvalidateResult,
    CodeBuddyHealthResponse,
    CronJobMeta,
    CronPauseUpdate,
    CronRunPublic,
    ExternalLink,
    ExternalLinksResponse,
    ExternalLinksUpdate,
    GitLabConfigResponse,
    GitLabConfigUpdate,
    IntegrationsResponse,
    IntegrationsUpdate,
    LLMConfigResponse,
    LLMConfigUpdate,
    LLMTestResponse,
    NavVisibilityResponse,
    NavVisibilityUpdate,
    NotificationAdminPublic,
    NotificationBroadcastRequest,
    NotificationBroadcastResult,
    NotificationCleanupRequest,
    NotificationCleanupResult,
    NotificationKindsResponse,
    NotificationKindsUpdate,
    TechnologyCatalogEntryPublic,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get(
    "/technology-catalog",
    response_model=list[TechnologyCatalogEntryPublic],
)
async def technology_catalog(
    session: SessionDep,
    _current_user: AdminUser,
):
    """Справочник сигналов распознавания технологий, доступный только администраторам."""
    return list(
        (
            await session.execute(
                select(TechnologyCatalogEntry).order_by(
                    TechnologyCatalogEntry.type,
                    TechnologyCatalogEntry.name,
                )
            )
        ).scalars()
    )


# Известные nav-ключи UI (источник истины для матрицы видимости).
# Должны совпадать с тем, что рендерит Layout.tsx.
NAV_KEYS: list[str] = [
    "dashboard",
    "employees",
    "projects",
    "technology_radar",
    "departments",
    "assignments",
    "rotations",
    "self_review",
    "hiring",
    "vacancies",
    "mpk_reference",
]

ALL_ROLES: list[str] = ["department_head", "manager", "core_team"]


# Известные kinds уведомлений (источник истины — реальные kind'ы, которые
# мы создаём через record_notifications во всём коде; см. user/11-notifications.md).
NOTIFICATION_KINDS: list[str] = [
    "ai_job_done",
    "ai_job_error",
    "assignment_created",
    "assignment_pending_review",
    "assignment_done",
    "assignment_returned",
    "assignment_cancelled",
    "assignment_due_soon",
    "assignment_overdue",
    "dept_maturity_started",
    "dept_maturity_done",
    "rotation_proposed",
    "rotation_accepted",
    "rotation_rejected",
    "rotation_completed",
    "rotation_reverted",
    "rotation_cancelled",
    "rotation_suggestion",
    "self_review",
    "technology_attention",
]


# ----- Feature flags --------------------------------------------------------


@router.get("/nav-visibility", response_model=NavVisibilityResponse)
async def get_nav_visibility_endpoint(session: SessionDep, _current_user: AdminUser):
    """Текущая карта видимости nav-разделов: {nav_key: {role: bool}}.
    Если раздела нет в map'е — он видим для всех ролей."""
    stored = await get_nav_visibility(session)
    # Возвращаем полную матрицу, заполняя пропуски значением True.
    full: dict[str, dict[str, bool]] = {}
    for nav in NAV_KEYS:
        full[nav] = {}
        for role in ALL_ROLES:
            full[nav][role] = stored.get(nav, {}).get(role, True)
    return NavVisibilityResponse(items=full)


@router.put("/nav-visibility", response_model=NavVisibilityResponse)
async def put_nav_visibility(
    payload: NavVisibilityUpdate,
    session: SessionDep,
    current_user: AdminUser,
):
    """Перезаписать карту видимости. Валидируем, что nav_key и role известны."""
    cleaned: dict[str, dict[str, bool]] = {}
    for nav, roles in payload.items.items():
        if nav not in NAV_KEYS:
            raise HTTPException(status_code=400, detail=f"Неизвестный nav-ключ: {nav}")
        cleaned[nav] = {}
        for role, val in roles.items():
            if role not in ALL_ROLES:
                raise HTTPException(status_code=400, detail=f"Неизвестная роль: {role}")
            cleaned[nav][role] = bool(val)
    await set_setting(session, SETTING_KEY_NAV_VISIBILITY, cleaned, current_user.id)
    await session.commit()
    return await get_nav_visibility_endpoint(session, current_user)


# ----- Notifications: kind toggles -----------------------------------------


@router.get("/notifications/kinds", response_model=NotificationKindsResponse)
async def get_notification_kinds(session: SessionDep, _current_user: AdminUser):
    enabled = await get_enabled_notification_kinds(session)
    full = {k: enabled.get(k, True) for k in NOTIFICATION_KINDS}
    return NotificationKindsResponse(enabled=full, all_known_kinds=NOTIFICATION_KINDS)


@router.put("/notifications/kinds", response_model=NotificationKindsResponse)
async def put_notification_kinds(
    payload: NotificationKindsUpdate,
    session: SessionDep,
    current_user: AdminUser,
):
    cleaned: dict[str, bool] = {
        k: bool(v) for k, v in payload.enabled.items() if k in NOTIFICATION_KINDS
    }
    await set_setting(
        session,
        SETTING_KEY_ENABLED_NOTIFICATION_KINDS,
        cleaned,
        current_user.id,
    )
    await session.commit()
    return await get_notification_kinds(session, current_user)


# ----- Notifications: admin view -------------------------------------------


@router.get("/notifications", response_model=list[NotificationAdminPublic])
async def list_all_notifications(
    session: SessionDep,
    _current_user: AdminUser,
    limit: int = Query(default=100, ge=1, le=500),
    user_id: int | None = None,
    kind: str | None = None,
):
    """Просмотр всех уведомлений в системе (для отладки)."""
    stmt = (
        select(Notification, User.email)
        .join(User, User.id == Notification.recipient_user_id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    if user_id is not None:
        stmt = stmt.where(Notification.recipient_user_id == user_id)
    if kind:
        stmt = stmt.where(Notification.kind == kind)
    rows = (await session.execute(stmt)).all()
    return [
        NotificationAdminPublic(
            id=n.id,
            recipient_user_id=n.recipient_user_id,
            recipient_email=email,
            kind=n.kind,
            title=n.title,
            body=n.body,
            link=n.link,
            is_read=n.is_read,
            created_at=n.created_at,
        )
        for n, email in rows
    ]


# ----- Notifications: broadcast --------------------------------------------


@router.post("/notifications/broadcast", response_model=NotificationBroadcastResult)
async def broadcast_notification(
    payload: NotificationBroadcastRequest,
    session: SessionDep,
    current_user: AdminUser,
):
    """Отправить уведомление группе. Без указания role/user_ids — всем активным."""
    stmt = select(User.id).where(User.is_active.is_(True))
    if payload.user_ids:
        stmt = stmt.where(User.id.in_(payload.user_ids))
    elif payload.role:
        stmt = stmt.where(User.role == payload.role)
    user_ids = [uid for (uid,) in (await session.execute(stmt)).all()]
    if not user_ids:
        return NotificationBroadcastResult(delivered=0)
    notifs = await record_notifications(
        session,
        recipient_user_ids=user_ids,
        kind="admin_broadcast",
        title=payload.title.strip(),
        body=payload.body,
        link=None,
        payload={"by_admin_id": current_user.id},
    )
    await session.commit()
    await publish_pending(notifs)
    return NotificationBroadcastResult(delivered=len(notifs))


# ----- Notifications: cleanup ----------------------------------------------


@router.post("/notifications/cleanup", response_model=NotificationCleanupResult)
async def cleanup_notifications(
    payload: NotificationCleanupRequest,
    session: SessionDep,
    _current_user: AdminUser,
):
    cutoff = datetime.now(UTC) - timedelta(days=payload.older_than_days)
    res = await session.execute(delete(Notification).where(Notification.created_at < cutoff))
    if not isinstance(res, CursorResult):
        raise RuntimeError("Ожидался CursorResult при удалении уведомлений")
    await session.commit()
    return NotificationCleanupResult(deleted=int(res.rowcount or 0))


# ----- Cron -----------------------------------------------------------------


async def _last_run_for(session, cron_name: str) -> CronRun | None:
    q = await session.execute(
        select(CronRun)
        .where(CronRun.cron_name == cron_name)
        .order_by(CronRun.started_at.desc())
        .limit(1)
    )
    return q.scalar_one_or_none()


@router.get("/cron", response_model=list[CronJobMeta])
async def list_cron_jobs(session: SessionDep, _current_user: AdminUser):
    paused = await get_paused_cron_jobs(session)
    out: list[CronJobMeta] = []
    for spec in KNOWN_CRON_JOBS:
        last = await _last_run_for(session, spec["name"])
        out.append(
            CronJobMeta(
                name=spec["name"],
                schedule=spec["schedule"],
                description=spec["description"],
                paused=bool(paused.get(spec["name"], False)),
                last_run=CronRunPublic.model_validate(last) if last else None,
            )
        )
    return out


@router.get("/cron/{name}/runs", response_model=list[CronRunPublic])
async def list_cron_runs(
    name: str,
    session: SessionDep,
    _current_user: AdminUser,
    limit: int = Query(default=50, ge=1, le=500),
):
    q = await session.execute(
        select(CronRun)
        .where(CronRun.cron_name == name)
        .order_by(CronRun.started_at.desc())
        .limit(limit)
    )
    return [CronRunPublic.model_validate(r) for r in q.scalars()]


@router.put("/cron/{name}/pause")
async def set_cron_pause(
    name: str,
    payload: CronPauseUpdate,
    session: SessionDep,
    current_user: AdminUser,
):
    if not any(j["name"] == name for j in KNOWN_CRON_JOBS):
        raise HTTPException(status_code=404, detail="Неизвестный cron")
    paused = await get_paused_cron_jobs(session)
    paused[name] = bool(payload.paused)
    await set_setting(session, SETTING_KEY_PAUSED_CRON_JOBS, paused, current_user.id)
    await session.commit()
    return {"name": name, "paused": paused[name]}


@router.post("/cron/{name}/run")
async def trigger_cron_now(name: str, _session: SessionDep, current_user: AdminUser):
    """Запустить cron-задачу немедленно в фоне (не блокируем HTTP-ответ)."""
    if not any(j["name"] == name for j in KNOWN_CRON_JOBS):
        raise HTTPException(status_code=404, detail="Неизвестный cron")

    async def _run_in_bg():
        try:
            await run_cron_by_name(name, triggered_by=current_user.id)
        except Exception as e:
            logger.exception("manual cron run failed: %s", e)

    asyncio.create_task(_run_in_bg())
    return {"name": name, "status": "started"}


# ----- External links -------------------------------------------------------


@router.get("/external-links", response_model=ExternalLinksResponse)
async def get_external_links_endpoint(session: SessionDep, _current_user: AdminUser):
    links = await get_external_links(session)
    return ExternalLinksResponse(links=[ExternalLink(**link) for link in links])


@router.put("/external-links", response_model=ExternalLinksResponse)
async def put_external_links(
    payload: ExternalLinksUpdate,
    session: SessionDep,
    current_user: AdminUser,
):
    """Перезаписать список внешних ссылок целиком (DSTracker, CodeBuddy и т.п.)."""
    data = {"links": [link.model_dump() for link in payload.links]}
    await set_setting(session, SETTING_KEY_EXTERNAL_LINKS, data, current_user.id)
    await session.commit()
    return ExternalLinksResponse(links=payload.links)


# ----- Integrations / feature flags ----------------------------------------


@router.get("/integrations", response_model=IntegrationsResponse)
async def get_integrations_endpoint(session: SessionDep, _current_user: AdminUser):
    """Текущая карта on/off интеграций. Все флаги опциональны, дефолт — false."""
    flags = await get_integrations(session)
    return IntegrationsResponse(
        codebuddy_live=bool(flags.get("codebuddy_live", False)),
    )


@router.put("/integrations", response_model=IntegrationsResponse)
async def put_integrations(
    payload: IntegrationsUpdate,
    session: SessionDep,
    current_user: AdminUser,
):
    """Перезаписать карту флагов интеграций."""
    cleaned = {"codebuddy_live": bool(payload.codebuddy_live)}
    await set_setting(session, SETTING_KEY_INTEGRATIONS, cleaned, current_user.id)
    await session.commit()
    return IntegrationsResponse(**cleaned)


# ----- GitLab direct status sync -------------------------------------------


@router.get("/gitlab", response_model=GitLabConfigResponse)
async def get_gitlab_config(session: SessionDep, _current_user: AdminUser):
    """Текущий GitLab-конфиг. Сам API token никогда не возвращается."""
    config = await resolve_gitlab_config(session)
    stored = await get_setting(session, SETTING_KEY_GITLAB)
    return GitLabConfigResponse(
        base_url=config.base_url,
        api_token_set=bool(config.api_token),
        api_token_source=config.token_source,
        auto_sync_enabled=bool(stored.get("auto_sync_enabled", True)),
    )


@router.put("/gitlab", response_model=GitLabConfigResponse)
async def put_gitlab_config(
    payload: GitLabConfigUpdate,
    session: SessionDep,
    current_user: AdminUser,
):
    """Сохранить токен и флаг автоматики; пустой token оставляет текущий."""
    stored = await get_setting(session, SETTING_KEY_GITLAB)
    supplied_token = (payload.api_token or "").strip()
    cleaned: dict[str, str | bool] = {
        "auto_sync_enabled": bool(payload.auto_sync_enabled),
    }
    existing_admin_token = str(stored.get("api_token") or "").strip()
    admin_token = supplied_token or existing_admin_token
    if admin_token:
        cleaned["api_token"] = admin_token
    await set_setting(session, SETTING_KEY_GITLAB, cleaned, current_user.id)
    await session.commit()
    config = await resolve_gitlab_config(session)
    return GitLabConfigResponse(
        base_url=config.base_url,
        api_token_set=bool(config.api_token),
        api_token_source=config.token_source,
        auto_sync_enabled=bool(cleaned["auto_sync_enabled"]),
    )


# ----- LLM (OpenAI-совместимый провайдер) ----------------------------------


@router.get("/llm", response_model=LLMConfigResponse)
async def get_llm_config(session: SessionDep, _current_user: AdminUser):
    """Текущий конфиг LLM (значения админ-панели поверх .env). Ключ не отдаём."""
    cfg = await resolve_ai_config(session)
    return LLMConfigResponse(base_url=cfg.base_url, model=cfg.model, api_key_set=cfg.configured)


@router.put("/llm", response_model=LLMConfigResponse)
async def put_llm_config(
    payload: LLMConfigUpdate,
    session: SessionDep,
    current_user: AdminUser,
):
    """Сохранить конфиг LLM. Пустой api_key в запросе — оставить текущий ключ."""
    stored = await get_setting(session, SETTING_KEY_LLM)
    new_key = (payload.api_key or "").strip() or stored.get("api_key", "")
    cleaned = {
        "base_url": payload.base_url.strip(),
        "model": payload.model.strip(),
        "api_key": new_key,
    }
    await set_setting(session, SETTING_KEY_LLM, cleaned, current_user.id)
    await session.commit()
    cfg = await resolve_ai_config(session)
    return LLMConfigResponse(base_url=cfg.base_url, model=cfg.model, api_key_set=cfg.configured)


@router.post("/llm/test", response_model=LLMTestResponse)
async def test_llm_config(session: SessionDep, _current_user: AdminUser):
    """Проверить связь с LLM: запрос на 1 токен к текущему провайдеру."""
    cfg = await resolve_ai_config(session)
    client = make_client(cfg)
    now = datetime.now(UTC)
    if client is None:
        return LLMTestResponse(
            ok=False, reason="API-ключ не задан", model=cfg.model, checked_at=now
        )
    try:
        await asyncio.wait_for(
            client.chat.completions.create(
                model=cfg.model,
                messages=[{"role": "user", "content": "ping"}],
                max_tokens=1,
            ),
            timeout=30,
        )
    except Exception as e:  # noqa: BLE001
        return LLMTestResponse(ok=False, reason=str(e)[:300], model=cfg.model, checked_at=now)
    return LLMTestResponse(ok=True, model=cfg.model, checked_at=now)


# ----- CodeBuddy: healthcheck + cache invalidation -------------------------


@router.get("/codebuddy/healthcheck", response_model=CodeBuddyHealthResponse)
async def codebuddy_healthcheck(_current_user: AdminUser):
    """Проверить связь с CodeBuddy: token + лёгкий запрос feature-catalog."""
    result = await codebuddy_service.healthcheck()
    return CodeBuddyHealthResponse(
        ok=bool(result.get("ok")),
        reason=result.get("reason"),
        status_code=result.get("status_code"),
        languages=result.get("languages"),
        categories=result.get("categories"),
        features=result.get("features"),
        checked_at=datetime.now(UTC),
    )


@router.delete("/codebuddy/cache", response_model=CacheInvalidateResult)
async def codebuddy_cache_invalidate(_current_user: AdminUser):
    """Сбросить Redis-кэш CodeBuddy. Возвращает число удалённых ключей."""
    deleted = await invalidate_codebuddy_cache()
    return CacheInvalidateResult(deleted=deleted)


@router.get("/codebuddy/developers")
async def codebuddy_list_developers(
    _current_user: AdminUser,
    limit: int = Query(default=200, ge=1, le=500),
):
    """Список GitLab-пользователей, активных в CodeBuddy.

    Используется в UI для подсказок при заполнении `Employee.gitlab_username`.
    Кэшируется на час.
    """
    try:
        items = await codebuddy_service.list_developers(limit=limit)
        return {"items": items}
    except CodeBuddyAPIError as e:
        code = e.status_code or 502
        http_code = 429 if code == 429 else 502
        raise HTTPException(status_code=http_code, detail=f"CodeBuddy: {e}") from e


@router.post("/codebuddy/sync-projects-full")
async def codebuddy_sync_projects_full(
    session: SessionDep,
    _current_user: AdminUser,
):
    """Ручной полный синк проектов из CodeBuddy за всё время.

    Ставит ARQ-задачу `run_codebuddy_sync_projects(emp_id, all_time=True)` на
    каждого активного сотрудника. Возвращает сколько задач отправлено в
    очередь. Прогресс смотреть в `cron_runs` / логах worker'а.
    """
    if not await is_codebuddy_live(session):
        raise HTTPException(
            status_code=400,
            detail="CodeBuddy интеграция выключена (флаг codebuddy_live=false)",
        )
    eq = await session.execute(
        select(Employee).where(
            Employee.kind == "employee",
            Employee.left_at.is_(None),
        )
    )
    employees = list(eq.scalars())
    if not employees:
        return {"enqueued": 0, "team_size": 0}
    try:
        pool = get_arq_pool()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=f"Redis: {e}") from e
    enqueued = 0
    for emp in employees:
        try:
            await pool.enqueue_job("run_codebuddy_sync_projects", emp.id, True)
            enqueued += 1
        except Exception as e:  # noqa: BLE001
            logger.warning("sync-projects-full: enqueue emp #%s failed: %s", emp.id, e)
    return {"enqueued": enqueued, "team_size": len(employees)}


# ----- Self-check (для UI) --------------------------------------------------


@router.get("/whoami")
async def admin_whoami(current_user: AdminUser):
    """Проверка прав. UI зовёт перед открытием раздела."""
    return {"id": current_user.id, "email": current_user.email, "is_admin": True}
