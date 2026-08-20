from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Notification(Base, TimestampMixin):
    """Уведомление пользователю.

    Кроссистемное событие: «вам поставили поручение», «адресат заявил
    выполнение», «AI-задача готова» и т.п.

    Хранится не вечно — на каждом list-запросе старше TTL_DAYS чистится.
    """

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)

    recipient_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # kind — короткий тип события для UI (иконка/окраска).
    # См. перечень в app.notifications.kinds.
    kind: Mapped[str] = mapped_column(String(50), nullable=False, index=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Ссылка для перехода (относительный URL во фронтенде).
    link: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Доп. структурированные данные (assignment_id, rotation_id, …).
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")

    is_read: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
