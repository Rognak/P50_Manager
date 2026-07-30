"""OpenAI-совместимый LLM-клиент.

Конфиг берётся из админ-панели (`system_settings['llm']`); если там пусто —
fallback на значения из `.env` (`AI_*`). Так LLM можно переключать прямо в UI
без правки переменных окружения и перезапуска процессов.
"""
from __future__ import annotations

from dataclasses import dataclass

import httpx
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.settings import get_setting
from app.config import settings
from app.db import SessionLocal
from app.models.admin import SETTING_KEY_LLM


@dataclass(frozen=True)
class AIConfig:
    """Разрешённый конфиг LLM (значения админ-панели поверх `.env`)."""

    base_url: str
    api_key: str
    model: str
    timeout: float
    verify_ssl: bool

    @property
    def configured(self) -> bool:
        """LLM считается настроенным, если задан API-ключ."""
        return bool(self.api_key)


async def resolve_ai_config(session: AsyncSession) -> AIConfig:
    """Собрать конфиг: значения из `system_settings['llm']` поверх `.env`."""
    raw = await get_setting(session, SETTING_KEY_LLM)
    return AIConfig(
        base_url=(raw.get("base_url") or settings.ai_base_url).strip(),
        api_key=(raw.get("api_key") or settings.ai_api_key).strip(),
        model=(raw.get("model") or settings.ai_model_chat).strip(),
        timeout=settings.ai_request_timeout,
        verify_ssl=settings.ai_verify_ssl,
    )


def make_client(cfg: AIConfig) -> AsyncOpenAI | None:
    """Собрать клиент из конфига. None — если API-ключ не задан."""
    if not cfg.configured:
        return None
    # У LLM-эндпоинта может быть self-signed сертификат — тогда подсовываем
    # свой httpx-клиент без верификации SSL (cfg.verify_ssl=False).
    http_client = (
        None
        if cfg.verify_ssl
        else httpx.AsyncClient(verify=False, timeout=cfg.timeout)
    )
    client = AsyncOpenAI(
        base_url=cfg.base_url,
        api_key=cfg.api_key,
        timeout=cfg.timeout,
        http_client=http_client,
    )
    # Модель «едет» вместе с клиентом — чтобы слой service.py не тянул её
    # из глобальных settings (см. model_of).
    client.p50_model = cfg.model  # type: ignore[attr-defined]
    return client


def model_of(client: AsyncOpenAI | None) -> str:
    """Модель, прикреплённая к клиенту фабрикой make_client; fallback — `.env`."""
    return getattr(client, "p50_model", settings.ai_model_chat)


async def get_client() -> AsyncOpenAI | None:
    """Готовый LLM-клиент по текущему конфигу (или None, если AI не настроен)."""
    async with SessionLocal() as session:
        cfg = await resolve_ai_config(session)
    return make_client(cfg)
