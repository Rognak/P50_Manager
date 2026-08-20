"""Helpers для уведомлений: запись в БД и публикация в SSE-hub.

Двухфазная схема, чтобы не публиковать событие до успешного commit:
  1. `record_notifications` добавляет строки в session, делает flush для id;
  2. caller делает session.commit();
  3. caller вызывает `publish_pending(notifs)` — пушит в hub.
"""

from __future__ import annotations

from typing import Any, Iterable

from app.models.notification import Notification
from app.notifications.hub import hub


async def record_notifications(
    session,
    *,
    recipient_user_ids: Iterable[int],
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    payload: dict[str, Any] | None = None,
    exclude_user_ids: Iterable[int] = (),
) -> list[Notification]:
    """Записать уведомления в session (без commit). Возвращает список записей
    с уже заполненными id (через flush).

    Если этот kind глобально выключен в админ-панели — возвращаем пустой список
    (молча игнорируем создание, чтобы вызывающий код не падал)."""
    # late import чтобы избежать циклов на старте
    from app.admin.settings import is_notification_kind_enabled

    if not await is_notification_kind_enabled(session, kind):
        return []

    excluded = set(exclude_user_ids)
    targets = [uid for uid in dict.fromkeys(recipient_user_ids) if uid and uid not in excluded]
    if not targets:
        return []
    created: list[Notification] = []
    for uid in targets:
        n = Notification(
            recipient_user_id=uid,
            kind=kind,
            title=title,
            body=body,
            link=link,
            payload=payload or {},
            is_read=False,
        )
        session.add(n)
        created.append(n)
    await session.flush()
    return created


async def publish_pending(notifs: Iterable[Notification]) -> None:
    """Опубликовать ранее записанные уведомления в hub.
    Вызывать ТОЛЬКО после successful session.commit()."""
    for n in notifs:
        await hub.publish(
            n.recipient_user_id,
            {
                "id": n.id,
                "kind": n.kind,
                "title": n.title,
                "body": n.body,
                "link": n.link,
                "payload": n.payload,
                "created_at": n.created_at.isoformat() if n.created_at else None,
                "is_read": False,
            },
        )
