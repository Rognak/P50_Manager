from datetime import datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Assignment(Base, TimestampMixin):
    """Поручение — задача от одного пользователя другому.

    Назначатель (created_by) — User. Адресат — либо User (assignee_user_id,
    типичный сценарий «CoreTeam → руководитель отдела»), либо Employee
    (assignee_employee_id, типичный сценарий «руководитель → свой сотрудник»).
    Ровно один из этих двух ID должен быть задан (CHECK constraint).

    Вложение (опциональное) хранится BYTEA по той же схеме что и резюме
    кандидатов — filename + content_type + size + data.
    """

    __tablename__ = "assignments"
    __table_args__ = (
        CheckConstraint(
            "(assignee_user_id IS NULL) <> (assignee_employee_id IS NULL)",
            name="ck_assignments_one_assignee",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description_md: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Срок: NULL = бессрочное.
    due_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    # status: open | in_progress | done | cancelled
    status: Mapped[Literal["open", "in_progress", "pending_review", "done", "cancelled"]] = (
        mapped_column(String(20), nullable=False, default="open", server_default="open", index=True)
    )

    created_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )

    assignee_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    assignee_employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=True, index=True
    )

    # Вложение (опционально, ровно один файл).
    attachment_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attachment_content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    attachment_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    attachment_uploaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attachment_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    # Когда статус перешёл в done — для аналитики «время выполнения».
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
