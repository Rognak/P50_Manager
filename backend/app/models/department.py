from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Department(Base, TimestampMixin):
    """Практика / отдел разработки. У каждого есть руководитель (User-owner)."""

    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )


class DeptMaturitySurvey(Base, TimestampMixin):
    """Квартальный опросник техзрелости отдела/практики.

    Шаблон отдела прост: 7 направлений × 5 уровней = 35 ячеек, в каждой
    доля выполнения 0..1. Менеджер отдела ставит долю напрямую.
    Формула рейтинга та же что у команд: сумма долей до первого ≤ 0.8 × (100/35)."""

    __tablename__ = "dept_maturity_surveys"
    __table_args__ = (UniqueConstraint("department_id", "period"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="draft", server_default="draft"
    )
    template_version: Mapped[str] = mapped_column(String(20), nullable=False)
    info: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # answers: { "{directionCode}-{level}": float (0..1) } — 35 ячеек
    answers: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
