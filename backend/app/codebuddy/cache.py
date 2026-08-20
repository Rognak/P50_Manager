"""Redis-кэш для CodeBuddy-запросов.

Используется в `service.py` через `cached(key, ttl, fetch)`. Если Redis не
поднят (тесты, локальный скрипт) — просто пропускаем кэш и вызываем `fetch()`.

Не используется для записи бинарных данных — JSON only.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable

from app.redis_pool import get_pool

logger = logging.getLogger(__name__)


# Префикс для всех ключей CodeBuddy в Redis — чтобы можно было FLUSH'ить
# выборочно, не задевая ARQ-очередь и pub/sub.
KEY_PREFIX = "cb:"


def make_key(*parts: object) -> str:
    """Собрать ключ кэша. Все части — str() + join через ':'."""
    return KEY_PREFIX + ":".join(str(p) for p in parts if p is not None)


async def cached(
    key: str,
    ttl_seconds: int,
    fetch: Callable[[], Awaitable[Any]],
) -> Any:
    """Get-or-fetch helper.

    Args:
        key: Redis ключ (см. `make_key`).
        ttl_seconds: TTL свежего значения.
        fetch: async-функция, вычисляющая значение при cache miss.

    Returns:
        Значение из кэша или результат `fetch()`. JSON-сериализуется.
        Если значение не сериализуется — возвращаем как есть, без кэширования.
    """
    try:
        pool = get_pool()
    except RuntimeError:
        # Redis не инициализирован — фолбэк на прямой fetch
        logger.debug("redis pool not ready, bypassing cache for %s", key)
        return await fetch()

    try:
        raw = await pool.get(key)
    except Exception as e:  # noqa: BLE001 — широкий catch для сетевых проблем
        logger.warning("redis GET failed for %s: %s — bypassing cache", key, e)
        return await fetch()

    if raw is not None:
        try:
            text = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
            return json.loads(text)
        except (ValueError, UnicodeDecodeError):
            logger.warning("broken cache value for %s — refetching", key)

    value = await fetch()

    try:
        serialised = json.dumps(value, default=str, ensure_ascii=False)
    except (TypeError, ValueError) as e:
        logger.warning("can't serialise value for %s: %s — skip cache", key, e)
        return value

    try:
        await pool.set(key, serialised, ex=ttl_seconds)
    except Exception as e:  # noqa: BLE001
        logger.warning("redis SET failed for %s: %s", key, e)

    return value


async def invalidate(pattern: str = KEY_PREFIX + "*") -> int:
    """Удалить все ключи, соответствующие паттерну. Возвращает число удалённых.
    Используется для админ-кнопки «Сбросить кэш CodeBuddy»."""
    try:
        pool = get_pool()
    except RuntimeError:
        return 0
    deleted = 0
    try:
        async for key in pool.scan_iter(match=pattern, count=200):
            await pool.delete(key)
            deleted += 1
    except Exception as e:  # noqa: BLE001
        logger.warning("redis scan/delete failed: %s", e)
    return deleted
