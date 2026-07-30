from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class NotificationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    title: str
    body: str | None
    link: str | None
    payload: dict[str, Any]
    is_read: bool
    read_at: datetime | None
    created_at: datetime


class UnreadCount(BaseModel):
    unread: int
