"""Keycloak OAuth2 token-менеджер для CodeBuddy External API.

Получает access_token через `client_credentials` grant, кэширует в памяти,
проактивно обновляет за `REFRESH_MARGIN_SEC` до истечения. Безопасен для
конкурентных вызовов из разных корутин — параллельные запросы за токеном
ждут одну реальную загрузку через `asyncio.Lock`.

Использование:
    from app.codebuddy.auth import token_manager
    token = await token_manager.get_token()
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class CodeBuddyAuthError(RuntimeError):
    """Ошибка получения/обновления токена. Содержит причину для логов."""


@dataclass(frozen=True)
class _Token:
    access_token: str
    expires_at: float  # unix epoch seconds (UTC)


class KeycloakTokenManager:
    """Singleton-кэш токена Keycloak.

    Логика:
      1. `get_token()` → если кэш валиден (TTL > REFRESH_MARGIN_SEC) — отдаём.
      2. Иначе берём lock, проверяем кэш повторно (на случай гонки),
         запрашиваем новый токен у Keycloak.
      3. При 401 от target-API caller вызывает `invalidate()` и повторяет.
    """

    # За сколько секунд до истечения проактивно обновлять.
    # 60с — компромисс: запас на сетевую задержку и долгий запрос target-API.
    REFRESH_MARGIN_SEC = 60

    def __init__(self) -> None:
        self._token: _Token | None = None
        self._lock = asyncio.Lock()

    def is_configured(self) -> bool:
        return bool(settings.codebuddy_client_id) and bool(
            settings.codebuddy_client_secret
        )

    async def get_token(self) -> str:
        """Вернуть валидный access_token. При необходимости запрашивает новый."""
        if self._is_valid():
            assert self._token is not None
            return self._token.access_token
        async with self._lock:
            # double-check: другая корутина могла обновить пока мы ждали лок
            if self._is_valid():
                assert self._token is not None
                return self._token.access_token
            self._token = await self._fetch_token()
            return self._token.access_token

    def invalidate(self) -> None:
        """Сбросить кэш — следующий `get_token()` форснёт fetch.
        Использовать при 401 от target API."""
        self._token = None

    # ---- internals -----------------------------------------------------

    def _is_valid(self) -> bool:
        if self._token is None:
            return False
        return time.time() < self._token.expires_at - self.REFRESH_MARGIN_SEC

    async def _fetch_token(self) -> _Token:
        if not self.is_configured():
            raise CodeBuddyAuthError(
                "CodeBuddy не настроен. Задайте CODEBUDDY_CLIENT_ID и "
                "CODEBUDDY_CLIENT_SECRET в backend/.env"
            )

        url = (
            settings.codebuddy_keycloak_url.rstrip("/")
            + "/protocol/openid-connect/token"
        )
        logger.info("Keycloak token fetch: %s", url)
        try:
            async with httpx.AsyncClient(
                verify=settings.codebuddy_verify_ssl, timeout=10.0
            ) as client:
                resp = await client.post(
                    url,
                    data={
                        "grant_type": "client_credentials",
                        "client_id": settings.codebuddy_client_id,
                        "client_secret": settings.codebuddy_client_secret,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
        except httpx.HTTPError as e:
            raise CodeBuddyAuthError(
                f"Не удалось связаться с Keycloak ({url}): {e}"
            ) from e

        if resp.status_code != 200:
            raise CodeBuddyAuthError(
                f"Keycloak вернул {resp.status_code}: {resp.text[:300]}"
            )

        try:
            data = resp.json()
            access_token = data["access_token"]
            expires_in = int(data.get("expires_in", 300))
        except (ValueError, KeyError) as e:
            raise CodeBuddyAuthError(
                f"Не удалось распарсить ответ Keycloak: {e}"
            ) from e

        logger.info("Keycloak token received, expires in %ds", expires_in)
        return _Token(
            access_token=access_token, expires_at=time.time() + expires_in
        )


# Singleton — один на процесс
token_manager = KeycloakTokenManager()
