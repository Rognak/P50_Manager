from datetime import datetime

from sqlalchemy import (
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class TechMaturitySurvey(Base, TimestampMixin):
    """Опросник «техническая зрелость практик» по продукту, на конкретный период.

    Шаблон опросника статичен (process/direction/levels/data) — лежит JSON-файлом
    в `app/tech_maturity/template.json`. В survey хранятся только ответы менеджера
    (`answers: { paramCode -> value }`) и meta (`info: команда/код/менеджер/...`).

    `period` — строка вида `'2026-Q1'`. UNIQUE с product_id."""

    __tablename__ = "tech_maturity_surveys"
    __table_args__ = (
        UniqueConstraint("project_id", "period"),  # legacy, удалим в этапе 5
        UniqueConstraint(
            "product_id", "period",
            name="uq_tech_maturity_surveys_product_period",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # DEPRECATED: тех.зрелость переехала на уровень продукта.
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=True, index=True
    )
    period: Mapped[str] = mapped_column(String(20), nullable=False)
    # status: 'draft' | 'done'
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="draft", server_default="draft"
    )
    template_version: Mapped[str] = mapped_column(String(20), nullable=False)

    # info (произвольные поля шаблона: code, owner, team, manager, ...)
    info: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # answers: {paramCode: value(0..1)} — value=0 (не выполнено), 1 (выполнено)
    # для будущей расширяемости допускаем числа в [0..1]
    answers: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
