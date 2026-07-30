"""Модели админ-панели: системные настройки + история cron-запусков."""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


# Ключи конфигурации в system_settings.value (всегда JSONB):
#
#   nav_visibility:
#     { "<nav_key>": { "department_head": true, "manager": false, "core_team": true }, ... }
#     Если nav_key отсутствует — считается visible. Если роли нет — visible.
#
#   enabled_notification_kinds:
#     { "<kind>": true|false, ... }
#     Если kind отсутствует — enabled (по умолчанию шлём всё).
#
#   paused_cron_jobs:
#     { "<cron_name>": true|false, ... }
#     true = pause; отсутствие или false = active.

SETTING_KEY_NAV_VISIBILITY = "nav_visibility"
SETTING_KEY_ENABLED_NOTIFICATION_KINDS = "enabled_notification_kinds"
SETTING_KEY_PAUSED_CRON_JOBS = "paused_cron_jobs"
SETTING_KEY_EXTERNAL_LINKS = "external_links"
# external_links: { "links": [{"label": "DSTracker", "url": "https://..."}, ...] }
SETTING_KEY_INTEGRATIONS = "integrations"
# integrations: { "codebuddy_live": true|false }
# Если codebuddy_live = true — backend читает dev-метрики/компетенции из
# CodeBuddy API. Иначе — fallback на mock-таблицы (dev_metrics_snapshots/...).
# Дефолт — false: безопасно для локальной разработки без credentials.
SETTING_KEY_LLM = "llm"
# llm: { "base_url": str, "api_key": str, "model": str }
# Конфиг OpenAI-совместимого LLM, заданный из админ-панели. Любой ключ может
# отсутствовать — тогда значение берётся из .env (AI_BASE_URL/AI_API_KEY/
# AI_MODEL_CHAT). См. app/ai/client.py::resolve_ai_config.


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class CronRun(Base):
    """История одного запуска cron-задачи."""

    __tablename__ = "cron_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cron_name: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    # 'scheduled' — авто-cron по расписанию; 'manual' — кнопкой админа.
    trigger: Mapped[str] = mapped_column(String(20), nullable=False)
    # 'running' | 'ok' | 'error'
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    error_msg: Mapped[str | None] = mapped_column(Text, nullable=True)
    triggered_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
