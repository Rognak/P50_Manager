"""Модель AI-обзора performance продукта."""
from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ProductPerformanceReview(Base, TimestampMixin):
    """AI-разбор performance продукта за период.

    Генерируется по кнопке: эвристические метрики (`/products/{id}/performance`)
    собираются в контекст и отправляются в LLM, который пишет связный
    текстовый обзор. История разборов хранится — можно сравнивать.
    """

    __tablename__ = "product_performance_reviews"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # status: queued | running | done | error
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="queued", index=True
    )
    period_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Старое свободное-текстовое поле (deprecated после перехода на JSON).
    content_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Структурированный AI-разбор (ProductReviewResult).
    content_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    model: Mapped[str | None] = mapped_column(String(50), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
