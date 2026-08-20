from datetime import datetime
from typing import Literal

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SelfReview(Base, TimestampMixin):
    """Годовой Self-Review сотрудника.

    Контент хранится как загруженный DOCX-файл (источник истины), плюс кэш
    извлечённого текста для AI. Численные оценки и заметки руководителя —
    отдельные поля для дашборд-агрегатов и фильтров. Шаблон отчёта может
    меняться без правок схемы — рендерим как viewer через mammoth.

    Один сотрудник + год = одна запись (UniqueConstraint)."""

    __tablename__ = "self_reviews"
    __table_args__ = (UniqueConstraint("employee_id", "year"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    # status: draft | submitted | closed
    status: Mapped[Literal["draft", "submitted", "closed"]] = mapped_column(
        String(20), nullable=False, default="draft", index=True
    )

    # Загруженный DOCX (BYTEA). NULL = ещё не приложен.
    source_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_uploaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    source_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    # Текст, извлечённый при загрузке — кэш для AI и для дешёвых запросов.
    source_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Численные оценки 1..10 (вводит руководитель вручную для дашборда)
    project_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    company_score: Mapped[int | None] = mapped_column(Integer, nullable=True)

    manager_notes_md: Mapped[str | None] = mapped_column(Text, nullable=True)

    # AI-артефакты — каждый раздел отдельно, чтобы перегенерировать по одному
    ai_topics_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_comparison_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_burnout_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_calibration_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_drafting_md: Mapped[str | None] = mapped_column(Text, nullable=True)

    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Дата/время запланированной 1:1 встречи по обсуждению ревью.
    scheduled_1on1_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
