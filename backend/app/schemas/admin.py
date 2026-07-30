"""Pydantic-схемы админ-панели."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


# ----- nav visibility -------------------------------------------------------

NavRoleVisibility = dict[str, bool]  # {role_name: visible}


class NavVisibilityUpdate(BaseModel):
    """Полная карта видимости — каждый раздел × каждая роль.
    На уровне UI: матрица галочек."""

    items: dict[str, NavRoleVisibility]


class NavVisibilityResponse(BaseModel):
    items: dict[str, NavRoleVisibility]


# ----- notification kinds ---------------------------------------------------


class NotificationKindToggle(BaseModel):
    kind: str
    enabled: bool


class NotificationKindsUpdate(BaseModel):
    """{kind: enabled}; те kinds, которых нет в map'е — считаются enabled."""

    enabled: dict[str, bool]


class NotificationKindsResponse(BaseModel):
    """Текущая карта + список «всех известных kinds» для UI."""

    enabled: dict[str, bool]
    all_known_kinds: list[str]


# ----- broadcast ------------------------------------------------------------


class NotificationBroadcastRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    body: str | None = None
    # Если оба пусты — отправляем всем активным пользователям.
    role: Literal["department_head", "manager", "core_team"] | None = None
    user_ids: list[int] | None = None


class NotificationBroadcastResult(BaseModel):
    delivered: int


# ----- notifications view + cleanup ----------------------------------------


class NotificationAdminPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    recipient_user_id: int
    recipient_email: str | None  # join'им в эндпойнте
    kind: str
    title: str
    body: str | None
    link: str | None
    is_read: bool
    created_at: datetime


class NotificationCleanupRequest(BaseModel):
    older_than_days: int = Field(default=30, ge=1, le=3650)


class NotificationCleanupResult(BaseModel):
    deleted: int


# ----- cron -----------------------------------------------------------------


class CronJobMeta(BaseModel):
    name: str
    schedule: str
    description: str
    paused: bool
    last_run: CronRunPublic | None = None


class CronRunPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cron_name: str
    trigger: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    error_msg: str | None
    triggered_by: int | None


class CronPauseUpdate(BaseModel):
    paused: bool


# ----- external links ------------------------------------------------------


class ExternalLink(BaseModel):
    label: str = Field(min_length=1, max_length=50)
    url: str = Field(min_length=1, max_length=500)


class ExternalLinksResponse(BaseModel):
    links: list[ExternalLink]


class ExternalLinksUpdate(BaseModel):
    links: list[ExternalLink]


# ----- integrations / feature flags ----------------------------------------


class IntegrationsResponse(BaseModel):
    """Карта on/off для интеграций. Все ключи опциональны, дефолт — false."""

    codebuddy_live: bool = False


class IntegrationsUpdate(BaseModel):
    codebuddy_live: bool


class CodeBuddyHealthResponse(BaseModel):
    """Результат /admin/codebuddy/healthcheck."""

    ok: bool
    reason: str | None = None
    status_code: int | None = None
    # Краткая статистика feature-catalog при успехе.
    languages: int | None = None
    categories: int | None = None
    features: int | None = None
    checked_at: datetime


class CacheInvalidateResult(BaseModel):
    deleted: int


class LLMConfigResponse(BaseModel):
    """Текущий (разрешённый) конфиг LLM. api_key наружу не отдаётся —
    только факт его наличия."""

    base_url: str
    model: str
    api_key_set: bool


class LLMConfigUpdate(BaseModel):
    base_url: str
    model: str
    # Пустая строка / None — оставить текущий ключ без изменений.
    api_key: str | None = None


class LLMTestResponse(BaseModel):
    """Результат /admin/llm/test — лёгкая проверка связи с провайдером."""

    ok: bool
    reason: str | None = None
    model: str | None = None
    checked_at: datetime


# Forward-ref rebuild
CronJobMeta.model_rebuild()
