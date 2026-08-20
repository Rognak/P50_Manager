from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func, select

from app.api.technologies import _list_items
from app.db import SessionLocal
from app.models.notification import Notification
from app.models.technology import Technology
from app.models.user import User
from app.notifications.service import publish_pending, record_notifications


async def technology_radar_alerts(_ctx: dict[Any, Any], *args: Any, **kwargs: Any) -> None:
    """Ежедневно уведомляет администраторов о новых сигналах радара."""
    async with SessionLocal() as session:
        already_sent = (
            await session.execute(
                select(Notification.id)
                .where(
                    Notification.kind == "technology_attention",
                    func.date(Notification.created_at) == date.today(),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if already_sent is not None:
            return
        technologies = list(
            (
                await session.execute(select(Technology).where(Technology.is_active.is_(True)))
            ).scalars()
        )
        items = [
            item
            for item in await _list_items(session, technologies)
            if item.attention.has_attention
        ]
        if not items:
            return
        admin_ids = list(
            (
                await session.execute(
                    select(User.id).where(User.is_admin.is_(True), User.is_active.is_(True))
                )
            ).scalars()
        )
        notifications = await record_notifications(
            session,
            recipient_user_ids=admin_ids,
            kind="technology_attention",
            title=f"Радар технологий: требуют внимания {len(items)}",
            body=", ".join(item.name for item in items[:8]),
            link="/technology-radar?attention=true",
            payload={
                "technology_ids": [item.id for item in items],
                "generated_at": datetime.now(UTC).isoformat(),
            },
        )
        await session.commit()
        await publish_pending(notifications)
