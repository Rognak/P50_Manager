"""Метрики разработки из внешней системы (TeamPerformanceHub-like).

Импортируются периодически (через cron / ручной импорт), хранятся как snapshot.
В текущей реализации заполняются seed-скриптом с mock-данными.

Сущности:
  • DevMetricsSnapshot — агрегированные метрики per (employee, period).
  • PullRequest       — отдельные PR с quality-сигналами для drill-down.
  • ExtractedCompetency — какие МПК-компетенции AI извлёк из PR-ов сотрудника.
  • DigitalProfile    — AI-сгенерированная сводка (summary + strengths + actions).
"""

from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class DevMetricsSnapshot(Base, TimestampMixin):
    """Агрегированные dev-метрики сотрудника за период."""

    __tablename__ = "dev_metrics_snapshots"
    __table_args__ = (UniqueConstraint("employee_id", "period_start", "period_end"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)

    # Commits / общие объёмы
    total_commits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_mrs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lines_added: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lines_removed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Распределение по размеру (XS/S/M/L/XL)
    mr_size_xs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mr_size_s: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mr_size_m: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mr_size_l: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mr_size_xl: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Quality signals (count из total_mrs)
    mr_with_tests: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mr_with_description: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mr_with_review_discussion: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Средние/агрегаты
    avg_iterations: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    avg_time_to_merge_hours: Mapped[float | None] = mapped_column(Float, nullable=True)
    avg_quality_ratio: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Comments
    comments_given: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    comments_received: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # WIP / зависшие
    wip_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    stale_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class PullRequest(Base, TimestampMixin):
    """Один MR/PR сотрудника. Сохраняем для drill-down и для извлечения компетенций."""

    __tablename__ = "pull_requests"
    __table_args__ = (UniqueConstraint("external_id", "project_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    external_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )

    title: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    state: Mapped[str] = mapped_column(String(20), nullable=False)
    # open | merged | closed | wip

    created_at_ext: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    merged_at_ext: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    additions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deletions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    files_changed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tests_changed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    size_bucket: Mapped[str] = mapped_column(String(4), nullable=False, default="S")
    iterations: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    comments_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    time_to_merge_hours: Mapped[float | None] = mapped_column(Float, nullable=True)

    # JSONB { small_size, has_description, minimal_rework, has_review_discussion, has_tests }
    signals: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    quality_ratio: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)


class ExtractedCompetency(Base, TimestampMixin):
    """Извлечённая AI-моделью компетенция из PR-ов сотрудника.

    Уникальна по (employee_id, competency_id). При перегенерации обновляется.
    """

    __tablename__ = "extracted_competencies"
    __table_args__ = (UniqueConstraint("employee_id", "competency_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    competency_id: Mapped[int] = mapped_column(
        ForeignKey("competencies.id", ondelete="CASCADE"), nullable=False, index=True
    )

    # Сколько PR-ов оказались релевантны этой компетенции
    frequency: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # JSONB: [{ "pr_id": int, "pr_external_id": str, "title": str, "url": str,
    #          "project_id": int|None, "evidence": "что именно проявило компетенцию" }, ...]
    pr_examples: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)

    # Опционально — источник извлечения
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="ai", server_default="ai"
    )


class DigitalProfile(Base, TimestampMixin):
    """AI-сгенерированный цифровой профиль сотрудника.

    Один-к-одному с Employee (UNIQUE), но историчность через `generated_at` +
    несколько строк не хранится — UI всегда показывает актуальный."""

    __tablename__ = "digital_profiles"
    __table_args__ = (UniqueConstraint("employee_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Markdown-fallback (для legacy-просмотра и экспорта). Основной носитель —
    # content_json со структурированными секциями (summary/strengths/...).
    content_md: Mapped[str] = mapped_column(Text, nullable=False)
    content_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    # Что вошло в контекст генерации — для воспроизводимости/дебага.
    input_summary: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    model: Mapped[str] = mapped_column(String(50), nullable=False, default="mock")
