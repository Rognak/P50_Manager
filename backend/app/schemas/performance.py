"""Pydantic-схемы performance-аналитики продукта.

Источник данных — CodeBuddy (PR-ы репозиториев продукта + dev-snapshot'ы
участников). Все метрики считаются за период; сравнение с предыдущим
окном даёт дельты.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


SignalSeverity = Literal["critical", "warning", "info"]


# ----- рейтинг разработчика --------------------------------------------


class DevScoreBreakdown(BaseModel):
    """Оси composite-score, каждая 0..1 (вклад до умножения на вес)."""

    quality: float  # средний quality PR-ов
    tests: float  # доля PR с тестами
    review: float  # активность в ревью (commentsWritten, нормализ.)
    low_rework: float  # 1 − доля PR с переделками
    volume: float  # объём (mr_count, нормализ. к максимуму команды)


class DeveloperPerformance(BaseModel):
    employee_id: int
    full_name: str
    role_name: str | None = None
    grade_code: str | None = None

    mr_count: int
    prs_open: int
    prs_merged: int
    prs_closed: int

    avg_quality: float  # 0..1
    tests_pct: float  # 0..1
    description_pct: float  # 0..1
    avg_iterations: float
    rework_pct: float  # 0..1 — доля PR с iterations>1
    comments_received: int
    ai_comments_received: int
    comments_written: int  # ревью, написанные сотрудником (snapshot-wide)
    lines_added: int
    lines_removed: int
    avg_ttm_hours: float | None  # среднее time-to-merge по merged PR

    composite_score: float  # 0..100
    breakdown: DevScoreBreakdown

    # Сравнение с предыдущим окном того же размера.
    score_delta: float | None = None
    mr_count_delta: int | None = None
    quality_delta: float | None = None


# ----- здоровье продукта ------------------------------------------------


class ProductHealth(BaseModel):
    total_prs: int
    prs_open: int
    prs_merged: int
    prs_closed: int

    avg_quality: float | None = None  # 0..1
    with_tests_pct: float | None = None  # 0..1
    avg_ttm_hours: float | None = None

    wip_count: int
    stale_count: int

    coverage_gap: float  # сумма гэпов ★-компетенций
    bus_factor_count: int  # уникальных носителей ★-компетенций

    # распределение нагрузки
    workload_top_share: float | None = None  # доля PR самого активного, 0..1
    active_developers: int  # сколько сделали ≥1 PR
    team_size: int

    # review-баланс
    reviewers_count: int  # сколько людей пишут ревью

    # общая оценка здоровья
    health_status: Literal["healthy", "attention", "critical"]
    health_score: float  # 0..100 интегральная

    # дельты
    total_prs_delta: int | None = None
    avg_quality_delta: float | None = None


# ----- сигналы для внимания --------------------------------------------


class SignalEvidenceItem(BaseModel):
    """Один пункт доказательной базы сигнала (конкретный PR / компетенция)."""

    label: str  # заголовок (название PR / компетенции)
    detail: str | None = None  # пояснение (возраст, дата, quality, уровень)
    url: str | None = None  # ссылка (для PR)


class PerfSignal(BaseModel):
    severity: SignalSeverity
    kind: str  # машинный код типа сигнала
    title: str
    detail: str
    employee_id: int | None = None
    employee_name: str | None = None
    # Конкретика: какие именно PR-ы / компетенции стоят за сигналом.
    evidence: list[SignalEvidenceItem] = []


# ----- ответ ------------------------------------------------------------


class ProductPerformanceResponse(BaseModel):
    enabled: bool  # False если CodeBuddy выключен
    period_from: date
    period_to: date
    health: ProductHealth
    developers: list[DeveloperPerformance]
    signals: list[PerfSignal]


# ----- AI-обзор ---------------------------------------------------------


class TrendBucket(BaseModel):
    """Метрики продукта за одно временное окно (для графика динамики)."""

    period_from: date
    period_to: date
    total_prs: int
    prs_merged: int
    avg_quality: float | None = None
    with_tests_pct: float | None = None
    stale_open_count: int  # open PR старше 14 дн на конец окна (приближение)


class ProductTrendsResponse(BaseModel):
    enabled: bool
    bucket_days: int
    buckets: list[TrendBucket]  # от старого окна к новому


class ReviewPerformer(BaseModel):
    """Сильный исполнитель в AI-разборе."""

    name: str
    reason: str  # за что отмечен


class ReviewRisk(BaseModel):
    """Зона риска в AI-разборе."""

    name: str | None = None  # сотрудник; None — риск уровня продукта
    severity: SignalSeverity
    text: str


class ReviewAction(BaseModel):
    """Рекомендованное действие руководителю (по приоритету сверху вниз)."""

    title: str
    detail: str


class ProductReviewResult(BaseModel):
    """Структурированный AI-разбор performance продукта."""

    summary: str  # общая оценка (2–4 предложения)
    health_verdict: str  # короткий вердикт по здоровью
    top_performers: list[ReviewPerformer]
    risks: list[ReviewRisk]
    actions: list[ReviewAction]


class PerformanceReviewPublic(BaseModel):
    """AI-разбор performance продукта (статус + структурированный результат)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    status: Literal["queued", "running", "done", "error"]
    period_from: date | None
    period_to: date | None
    content_json: ProductReviewResult | None = None
    model: str | None
    error: str | None
    created_at: datetime
    finished_at: datetime | None
