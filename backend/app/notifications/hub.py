"""In-memory pub/sub hub для уведомлений + Redis backplane.

Локально (один процесс) hub раздаёт сообщения подписчикам через asyncio.Queue.
Между процессами (API ↔ ARQ worker) — Redis pub/sub: publish PUBLISH'ит в
канал `notifications`, а каждый API-процесс при старте поднимает фоновую
задачу-слушатель, которая получает сообщения и кладёт их в локальные очереди.

Если redis-pool ещё не инициализирован (тесты, скрипты) — публикация
ограничивается локальным фанаутом, чтобы не падать.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

REDIS_CHANNEL = "notifications"


class NotificationHub:
    def __init__(self) -> None:
        self._subs: dict[int, list[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()
        self._listener_task: Optional[asyncio.Task] = None

    async def subscribe(self, user_id: int) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        async with self._lock:
            self._subs.setdefault(user_id, []).append(q)
        return q

    async def unsubscribe(self, user_id: int, queue: asyncio.Queue) -> None:
        async with self._lock:
            qs = self._subs.get(user_id)
            if qs is None:
                return
            try:
                qs.remove(queue)
            except ValueError:
                pass
            if not qs:
                self._subs.pop(user_id, None)

    async def _local_fanout(self, user_id: int, event: dict[str, Any]) -> None:
        async with self._lock:
            qs = list(self._subs.get(user_id, []))
        for q in qs:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning(
                    "notification queue full for user %s — dropping", user_id
                )

    async def publish(self, user_id: int, event: dict[str, Any]) -> None:
        """Опубликовать событие. Всегда через Redis, если он доступен —
        иначе локальный фанаут (fallback)."""
        try:
            from app.redis_pool import get_pool  # late import — может быть не init

            pool = get_pool()
            payload = json.dumps(
                {"user_id": user_id, "event": event}, default=str
            )
            await pool.publish(REDIS_CHANNEL, payload)
        except Exception:
            # Redis недоступен — фолбэк
            await self._local_fanout(user_id, event)

    async def start_redis_listener(self) -> None:
        """Запустить фоновый таск, который слушает Redis-канал и кладёт
        сообщения в локальные очереди.

        Без слушателя SSE-эндпоинт не получит событий, опубликованных через
        Redis (см. publish). Вызывать один раз при старте процесса (lifespan).
        """
        if self._listener_task is not None:
            return
        self._listener_task = asyncio.create_task(self._listen_loop())

    async def stop_redis_listener(self) -> None:
        if self._listener_task is None:
            return
        self._listener_task.cancel()
        try:
            await self._listener_task
        except asyncio.CancelledError:
            pass
        self._listener_task = None

    async def _listen_loop(self) -> None:
        from app.redis_pool import get_pool

        try:
            pool = get_pool()
        except RuntimeError:
            logger.info("redis pool not ready — notification listener skipped")
            return
        pubsub = pool.pubsub()
        await pubsub.subscribe(REDIS_CHANNEL)
        logger.info("notification listener subscribed to %s", REDIS_CHANNEL)
        try:
            async for msg in pubsub.listen():
                if msg.get("type") != "message":
                    continue
                try:
                    raw = msg.get("data")
                    if isinstance(raw, bytes):
                        raw = raw.decode("utf-8")
                    payload = json.loads(raw)
                    user_id = int(payload["user_id"])
                    event = payload["event"]
                except Exception:
                    logger.exception("bad notification message")
                    continue
                await self._local_fanout(user_id, event)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("notification listener crashed")
        finally:
            try:
                await pubsub.unsubscribe(REDIS_CHANNEL)
                await pubsub.aclose()
            except Exception:
                pass

    async def has_subscribers(self, user_id: int) -> bool:
        async with self._lock:
            return bool(self._subs.get(user_id))


hub = NotificationHub()
