"""Pydantic-схемы для dev-метрик, извлечённых компетенций и цифрового профиля."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any  # noqa: F401  used in inner annotations

from pydantic import BaseModel, ConfigDict


# ----- Dev metrics snapshot ------------------------------------------------


class QualityBreakdownComponents(BaseModel):
    """Компоненты `prQualityScore`: «почему quality такой»."""

    conventional_commits_pct: float  # 0..100
    description_pct: float
    size_pct: float
    weights: dict[str, float]  # {"convCommits": 0.4, "description": 0.3, "size": 0.3}


class WipMrItem(BaseModel):
    """Один WIP/stale MR — для списка «висящих» PR-ов."""

    mr_iid: int
    project_id: int | None = None
    project_name: str | None = None
    title: str
    url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    age_days: int
    is_stale: bool


class DevMetricsSnapshotPublic(BaseModel):
    """Агрегированные dev-метрики за период. Может быть вычислено on-the-fly
    из таблицы pull_requests — поэтому без id."""

    model_config = ConfigDict(from_attributes=True)

    period_start: date
    period_end: date

    total_commits: int
    total_mrs: int
    lines_added: int
    lines_removed: int

    mr_size_xs: int
    mr_size_s: int
    mr_size_m: int
    mr_size_l: int
    mr_size_xl: int

    mr_with_tests: int
    mr_with_description: int
    mr_with_review_discussion: int

    avg_iterations: float
    avg_time_to_merge_hours: float | None
    avg_quality_ratio: float

    comments_given: int
    comments_received: int
    # Отдельно — review-комментарии от AI (Code-Review-бот). Сумма ai+peer = comments_received.
    ai_comments_received: int = 0

    wip_count: int
    stale_count: int
    # Стабильно есть только для CodeBuddy. Из mock-снапшота — пустой.
    wip_mrs: list[WipMrItem] = []
    stale_threshold_days: int | None = None

    # Breakdown — почему quality такой (CodeBuddy only; для mock — None).
    quality_breakdown: QualityBreakdownComponents | None = None


# ----- Pull request --------------------------------------------------------


class PullRequestPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    external_id: str
    project_id: int | None
    project_name: str | None = None  # join'им в эндпойнте

    title: str
    url: str | None
    state: str

    created_at_ext: datetime
    merged_at_ext: datetime | None

    additions: int
    deletions: int
    files_changed: int
    tests_changed: int

    size_bucket: str
    iterations: int
    comments_count: int
    time_to_merge_hours: float | None

    signals: dict[str, Any]
    quality_ratio: float

    # Дополнительные поля из CodeBuddy (для mock — пустые/null):
    feature_keys: list[str] = []  # детальные теги фич (`csharp.async`, `react.hooks` …)
    commits_count: int | None = None
    conventional_commits_rate: float | None = None  # 0..1
    comments_from_peers: int | None = None
    comments_from_ai: int | None = None
    # Автор PR из контекста запроса. CodeBuddy сам не возвращает автора в
    # /mrs (он по сути уже фильтрован по username), мы проставляем при
    # пакетной выгрузке. У одного PR разные авторы быть не могут (PR ↔ один
    # author), но при cross-team запросах это поле помогает не дублировать
    # row'ы и строить drill-down «кто что писал».
    author_employee_id: int | None = None
    author_full_name: str | None = None


# ----- Extracted competency ------------------------------------------------


class CompetencyTopSignal(BaseModel):
    """Один сигнал, вошедший во `frequencyScore` компетенции (объяснимость)."""

    signal: str  # `csharp.async`, `react.hooks`, …
    signal_type: str  # `feature_key` | `library` | `pattern`
    occurrences: int
    weight: float
    contribution: float  # вклад в итоговый score


class CompetencyTopicCoverage(BaseModel):
    """Подтема ИПР, покрываемая компетенцией (бонусные данные CodeBuddy)."""

    topic_id: int
    section: str | None = None
    topic: str
    recommended_level: int | None = None
    score: float  # 0..100
    signal_count: int


class ExtractedCompetencyItem(BaseModel):
    """Одна извлечённая компетенция сотрудника. Содержит сравнение с МПК-профилем."""

    competency_id: int
    competency_name: str
    sort_order: int
    frequency: int
    last_seen_at: datetime | None
    pr_examples: list[dict[str, Any]]

    # Сравнение «заявлено vs факт» — приходит из МПК-профиля
    required_level: int | None = None  # из RoleProfile роли+грейда сотрудника
    current_level: int | None = None  # из последней Assessment

    # Дополнительный контекст CodeBuddy (mock возвращает пустые):
    frequency_score: float | None = None  # 0..100 — готовая оценка
    max_level: int | None = None
    top_signals: list[CompetencyTopSignal] = []
    topic_coverage: list[CompetencyTopicCoverage] = []
    mptk_answer: str | None = None  # развёрнутый разбор из PDF, при ?include_answers=true


class ExtractedCompetenciesResponse(BaseModel):
    items: list[ExtractedCompetencyItem]
    # Период, из которого собирались данные (для подписи «за …»)
    period_start: date | None = None
    period_end: date | None = None


# ----- Project-level aggregation -------------------------------------------


class ProjectCompetencyEmployeeContrib(BaseModel):
    """Вклад одного сотрудника в проявление компетенции на проекте."""

    employee_id: int
    full_name: str
    frequency: int
    pr_examples: list[dict[str, Any]]  # PR-ы этого сотрудника по этой компетенции


class ProjectExtractedCompetencyItem(BaseModel):
    """Одна компетенция в контексте проекта."""

    competency_id: int
    competency_name: str
    sort_order: int

    # «Заявлено» — из ProjectCompetency
    project_target_level: int | None = None

    # «Факт» — кол-во участников проекта, у которых эта компетенция извлечена
    employees_with: int
    total_frequency: int  # сумма frequency по этим участникам
    employees: list[ProjectCompetencyEmployeeContrib]  # все носители для drill-down

    # Аггрегированные сигналы по проекту (top-5 по сумме contribution).
    top_signals: list[CompetencyTopSignal] = []


class ProjectExtractedCompetenciesResponse(BaseModel):
    items: list[ProjectExtractedCompetencyItem]
    total_team: int  # общее число активных members проекта
    period_start: date | None = None
    period_end: date | None = None


# ----- Digital profile -----------------------------------------------------


class DigitalProfilePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    generated_at: datetime
    content_md: str
    content_json: dict[str, Any] | None = None
    input_summary: dict[str, Any]
    model: str
