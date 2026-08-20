"""Низкоуровневый HTTP-клиент CodeBuddy External API.

Использование:
    from app.codebuddy.client import codebuddy_client

    devs = await codebuddy_client.get(
        "/api/external/v1/developers",
        params={"from": "2026-04-01", "to": "2026-05-18"},
    )

Логика:
  • Перед каждым запросом получаем валидный токен из `token_manager`.
  • На `401` — один раз сбрасываем токен и повторяем (на случай race condition
    «токен только что истёк»).
  • На `403`/`429` — кидаем человекочитаемый `CodeBuddyAPIError`.
  • На прочие 4xx/5xx — `CodeBuddyAPIError` с фрагментом тела для отладки.

Высокоуровневые методы (`get_developer`, `get_mrs`, …) будут отдельно.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.codebuddy.auth import CodeBuddyAuthError, token_manager
from app.config import settings

logger = logging.getLogger(__name__)


class CodeBuddyAPIError(RuntimeError):
    """Ошибка вызова CodeBuddy API."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class CodeBuddyClient:
    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 30.0,
        verify_ssl: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.verify_ssl = verify_ssl

    async def get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        return await self._request("GET", path, params=params)

    async def post(self, path: str, *, json: dict[str, Any] | None = None) -> Any:
        return await self._request("POST", path, json=json)

    # ---- internals -----------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json: dict[str, Any] | None = None,
        _retry: bool = True,
    ) -> Any:
        try:
            token = await token_manager.get_token()
        except CodeBuddyAuthError as e:
            raise CodeBuddyAPIError(f"Auth failed: {e}", status_code=502) from e

        url = f"{self.base_url}{path}"
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        logger.debug("CodeBuddy %s %s params=%s", method, path, params)

        try:
            async with httpx.AsyncClient(verify=self.verify_ssl, timeout=self.timeout) as client:
                resp = await client.request(method, url, params=params, json=json, headers=headers)
        except httpx.HTTPError as e:
            raise CodeBuddyAPIError(f"Сетевая ошибка {method} {path}: {e}", status_code=502) from e

        # 401 — токен мог просто истечь между нашей проверкой и target-проверкой.
        # Сбрасываем кэш и пытаемся ровно один раз. Если опять 401 — реальная проблема.
        if resp.status_code == 401 and _retry:
            logger.info("CodeBuddy 401 — invalidating token and retrying once")
            token_manager.invalidate()
            return await self._request(method, path, params=params, json=json, _retry=False)

        if resp.status_code == 403:
            raise CodeBuddyAPIError(
                "CodeBuddy: 403 — у service-account нет роли `codebuddy:external-stats`",
                status_code=403,
            )
        if resp.status_code == 429:
            raise CodeBuddyAPIError(
                "CodeBuddy: 429 — превышен rate limit (60 req/min). Подождите минуту и повторите.",
                status_code=429,
            )
        if resp.status_code == 404:
            raise CodeBuddyAPIError(
                f"CodeBuddy: 404 — {path} не найдено или нет данных",
                status_code=404,
            )
        if not resp.is_success:
            raise CodeBuddyAPIError(
                f"CodeBuddy {method} {path} → HTTP {resp.status_code}: {resp.text[:300]}",
                status_code=resp.status_code,
            )

        # 304 Not Modified — пока пустой ответ, в будущем conditional GET с ETag
        if resp.status_code == 304:
            return None

        try:
            return resp.json()
        except ValueError as e:
            raise CodeBuddyAPIError(
                f"CodeBuddy {method} {path} → неvalidный JSON: {e}",
                status_code=502,
            ) from e


# Singleton — настройки берутся из settings один раз при старте процесса
codebuddy_client = CodeBuddyClient(
    settings.codebuddy_base_url,
    timeout=settings.codebuddy_request_timeout,
    verify_ssl=settings.codebuddy_verify_ssl,
)
