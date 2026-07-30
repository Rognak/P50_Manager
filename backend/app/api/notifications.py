"""Уведомления: REST + SSE-стрим.

Хранение: TTL 30 дней, чистится на каждом list-запросе (одна DELETE).
Реалтайм: in-memory hub публикует в подписки, SSE отдаёт по EventSource.
Аутентификация SSE — через query-параметр `token` (EventSource не пробрасывает headers).
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from jose import JWTError
from sqlalchemy import delete, func, select, update

from app.api.deps import CurrentUser, SessionDep
from app.core.security import decode_access_token
from app.db import SessionLocal
from app.models.notification import Notification
from app.models.user import User
from app.notifications.hub import hub
from app.schemas.notification import NotificationPublic, UnreadCount

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])

TTL_DAYS = 30
HEARTBEAT_SEC = 25
SSE_LIST_LIMIT = 50  # сколько последних событий вернуть при подключении


async def _cleanup_old(session) -> None:
    """Удаляет уведомления старше TTL_DAYS. Вызывается из list/count."""
    cutoff = datetime.now(UTC) - timedelta(days=TTL_DAYS)
    await session.execute(
        delete(Notification).where(Notification.created_at < cutoff)
    )
    # commit — caller-контекст; здесь auto-commit от FastAPI session
    await session.commit()


@router.get("", response_model=list[NotificationPublic])
async def list_notifications(
    session: SessionDep,
    current_user: CurrentUser,
    unread_only: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
):
    await _cleanup_old(session)
    stmt = (
        select(Notification)
        .where(Notification.recipient_user_id == current_user.id)
        .order_by(Notification.created_at.desc())
        .limit(limit)
    )
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    rows = (await session.execute(stmt)).scalars().all()
    return [NotificationPublic.model_validate(n) for n in rows]


@router.get("/unread-count", response_model=UnreadCount)
async def unread_count(session: SessionDep, current_user: CurrentUser):
    await _cleanup_old(session)
    res = await session.execute(
        select(func.count(Notification.id)).where(
            Notification.recipient_user_id == current_user.id,
            Notification.is_read.is_(False),
        )
    )
    return UnreadCount(unread=int(res.scalar() or 0))


@router.post("/{notification_id}/read", response_model=NotificationPublic)
async def mark_read(
    notification_id: int, session: SessionDep, current_user: CurrentUser
):
    n = await session.get(Notification, notification_id)
    if n is None or n.recipient_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Уведомление не найдено")
    if not n.is_read:
        n.is_read = True
        n.read_at = datetime.now(UTC)
        await session.commit()
        await session.refresh(n)
    return NotificationPublic.model_validate(n)


@router.post("/mark-all-read", response_model=UnreadCount)
async def mark_all_read(session: SessionDep, current_user: CurrentUser):
    now = datetime.now(UTC)
    await session.execute(
        update(Notification)
        .where(
            Notification.recipient_user_id == current_user.id,
            Notification.is_read.is_(False),
        )
        .values(is_read=True, read_at=now)
    )
    await session.commit()
    return UnreadCount(unread=0)


@router.delete("/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: int, session: SessionDep, current_user: CurrentUser
):
    n = await session.get(Notification, notification_id)
    if n is None or n.recipient_user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Уведомление не найдено")
    await session.delete(n)
    await session.commit()


# ---------- SSE stream ----------


def _sse(event: str, data: dict | str) -> bytes:
    """Сформировать SSE-фрейм (`event:`, `data:`, разделитель `\\n\\n`)."""
    payload = data if isinstance(data, str) else json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n".encode("utf-8")


async def _validate_sse_token(token: str) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Bad token"
    )
    try:
        payload = decode_access_token(token)
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise credentials_exc
    async with SessionLocal() as s:
        u = await s.get(User, user_id)
        if u is None or not u.is_active:
            raise credentials_exc
        return u


@router.get("/stream")
async def stream(
    request: Request,
    token: str = Query(..., description="JWT (через query — EventSource не шлёт headers)"),
):
    """Server-Sent Events: real-time push новых уведомлений.

    Браузер: `new EventSource('/api/notifications/stream?token=' + jwt)`.
    Эмитим:
      • `event: notification` — каждое новое уведомление (json)
      • `event: ping`         — heartbeat каждые 25с
    """
    user = await _validate_sse_token(token)
    user_id = user.id

    async def gen():
        queue = await hub.subscribe(user_id)
        try:
            # сразу шлём приветствие, чтобы клиент понял что соединение живое
            yield _sse("ready", {"user_id": user_id})
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=HEARTBEAT_SEC
                    )
                    yield _sse("notification", event)
                except asyncio.TimeoutError:
                    yield _sse("ping", {})
        except asyncio.CancelledError:  # noqa: BLE001
            pass
        finally:
            await hub.unsubscribe(user_id, queue)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            # отключаем буферизацию у nginx-proxy
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
