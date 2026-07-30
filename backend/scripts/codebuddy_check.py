"""Smoke-test CodeBuddy auth + базовый запрос.

Запуск:
    cd backend
    uv run python -m scripts.codebuddy_check

Перед запуском заполните в `backend/.env`:
    codebuddy_client_id=<TUZ>
    codebuddy_client_secret=<SECRET>
    # опционально:
    codebuddy_base_url=https://codebuddy.example.com
    codebuddy_keycloak_url=https://auth.example.com/realms/example
    codebuddy_verify_ssl=false
"""
from __future__ import annotations

import asyncio
import sys
from datetime import date, timedelta

from app.codebuddy.auth import CodeBuddyAuthError, token_manager
from app.codebuddy.client import CodeBuddyAPIError, codebuddy_client
from app.config import settings


def _mask(s: str, keep: int = 6) -> str:
    if not s:
        return "<empty>"
    if len(s) <= keep * 2:
        return "*" * len(s)
    return s[:keep] + "…" + s[-keep:]


async def main() -> int:
    print("=" * 60)
    print("CodeBuddy smoke-test")
    print("=" * 60)
    print(f"base_url       : {settings.codebuddy_base_url}")
    print(f"keycloak_url   : {settings.codebuddy_keycloak_url}")
    print(f"client_id      : {settings.codebuddy_client_id or '<empty>'}")
    print(f"client_secret  : {_mask(settings.codebuddy_client_secret)}")
    print(f"verify_ssl     : {settings.codebuddy_verify_ssl}")
    print()

    # ---- 1. Запрашиваем токен ----
    print("Шаг 1: запрос токена у Keycloak…")
    try:
        token = await token_manager.get_token()
    except CodeBuddyAuthError as e:
        print(f"  ✗ {e}", file=sys.stderr)
        return 1
    print(f"  ✓ Токен получен: {_mask(token, 12)}")

    # Повторный вызов должен вернуть тот же токен из кэша
    print("Шаг 1b: повторный get_token() — должен прийти из кэша…")
    token2 = await token_manager.get_token()
    if token2 == token:
        print("  ✓ Кэш работает")
    else:
        print("  ✗ Кэш не сработал — токен заново выдан")

    # ---- 2. Проверяем доступ к /developers ----
    today = date.today()
    period_from = (today - timedelta(days=30)).isoformat()
    period_to = today.isoformat()

    print()
    print(f"Шаг 2: GET /api/external/v1/developers?from={period_from}&to={period_to}&limit=1")
    try:
        data = await codebuddy_client.get(
            "/api/external/v1/developers",
            params={"from": period_from, "to": period_to, "limit": 1},
        )
    except CodeBuddyAPIError as e:
        print(f"  ✗ {e} (status={e.status_code})", file=sys.stderr)
        return 1

    n = len(data.get("developers") or [])
    print(f"  ✓ Ответ получен: developers count={n}")
    if n > 0:
        sample = data["developers"][0]
        print(f"     первый: username={sample.get('username')!r}, "
              f"mrCount={sample.get('mrCount')}, "
              f"prQualityScore={sample.get('prQualityScore')}")

    # ---- 3. Проверяем доступ к /feature-catalog ----
    print()
    print("Шаг 3: GET /api/external/v1/feature-catalog")
    try:
        catalog = await codebuddy_client.get(
            "/api/external/v1/feature-catalog"
        )
    except CodeBuddyAPIError as e:
        print(f"  ✗ {e}", file=sys.stderr)
        return 1
    print(
        f"  ✓ Каталог: languages={len(catalog.get('languages') or [])}, "
        f"categories={len(catalog.get('categories') or [])}, "
        f"features={len(catalog.get('features') or [])}"
    )

    print()
    print("=" * 60)
    print("Всё ОК. CodeBuddy auth работает.")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
