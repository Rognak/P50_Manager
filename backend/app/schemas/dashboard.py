from datetime import date, datetime

from pydantic import BaseModel


class EmployeeRef(BaseModel):
    id: int
    full_name: str
    last_assessed_at: date | None
    role_name: str | None
    grade_code: str | None


class GapCompetencyItem(BaseModel):
    competency_id: int
    competency_name: str
    affected_count: int
    avg_gap: float
    total_with_role: int


class TeamGradeBucket(BaseModel):
    grade_code: str
    sort_order: int
    count: int


class TeamRoleBucket(BaseModel):
    role_id: int
    role_name: str
    count: int


class TeamRecentEvent(BaseModel):
    """Сотрудник, нанятый или ушедший в этом году."""

    employee_id: int
    full_name: str
    role_name: str | None
    grade_code: str | None
    at: date


class UpcomingMeeting(BaseModel):
    """Унифицированная запись «ближайшая встреча» из трёх источников."""

    kind: str  # 'mpk' | 'hiring' | 'self_review'
    when: datetime
    employee_id: int
    employee_name: str
    employee_kind: str  # 'employee' | 'candidate' — для иконок
    title: str  # короткое описание встречи
    meeting_id: int | None  # для mpk/hiring
    self_review_id: int | None  # для self_review


class TeamMetrics(BaseModel):
    """Динамика и состав команды (сотрудники текущего пользователя-руководителя)."""

    total_active: int
    total_all_time: int
    interns: int
    without_role: int
    without_grade: int
    without_hire_date: int
    avg_tenure_months: float | None  # средний стаж активных, если hired_at известен
    hired_year: int
    hired_count_year: int
    left_count_year: int
    net_change_year: int
    grades: list[TeamGradeBucket]
    roles: list[TeamRoleBucket]
    recent_hires: list[TeamRecentEvent]
    recent_leaves: list[TeamRecentEvent]


class RotationCandidateRef(BaseModel):
    employee_id: int
    full_name: str
    role_name: str | None
    grade_code: str | None
    from_project_id: int
    from_project_name: str
    tenure_months: int
    score: int
    bus_factor_score: int


class HiringStageBucket(BaseModel):
    stage: str
    count: int


class HiringTopVacancy(BaseModel):
    id: int
    title: str
    status: str  # open | closed
    project_name: str | None
    department_name: str | None
    candidates_count: int


class DashboardMetrics(BaseModel):
    # годовой цикл
    employees_total: int
    assessed_last_12m: int
    not_assessed_last_12m: int
    not_assessed_employees: list[EmployeeRef]

    # процедуры
    procedures_planned: int  # открыта, первая встреча ещё впереди
    procedures_open: int  # открыта, хотя бы одна встреча уже прошла
    procedures_closed_last_12m: int

    # состояние команды
    employees_with_role_grade: int
    avg_gap_score: float | None
    top_gap_competencies: list[GapCompetencyItem]

    # активность 30 дней
    assessments_last_30d: int
    meetings_done_last_30d: int
    ai_jobs_done_last_30d: int

    # ротации (по всем видимым проектам, не только своим сотрудникам)
    rotations_completed_last_30d: int
    rotations_completed_last_12m: int
    rotations_in_progress: int
    rotation_candidates_count: int
    rotation_top_candidates: list[RotationCandidateRef]
    bus_factor_alerts: int
    locked_members_count: int

    # Self-Review за текущий год (только «свои» сотрудники)
    self_review_year: int
    self_review_total: int
    self_review_drafts: int
    self_review_submitted: int
    self_review_closed: int
    self_review_pending: int  # нет ревью у тех, у кого должен быть
    self_review_avg_project: float | None
    self_review_avg_company: float | None
    # Дедлайны / алерты
    self_review_days_to_year_end: int  # дней до 31 декабря текущего года
    self_review_stuck_submitted: int  # submitted > 14 дней без close
    self_review_stale_drafts: int  # draft без файла > 30 дней с создания

    # Найм
    vacancies_open: int
    vacancies_closed: int
    candidates_total: int
    candidates_in_pipeline: int  # не hired и не rejected
    candidates_added_last_30d: int
    candidates_hired_year: int
    candidates_rejected_year: int
    candidates_by_stage: list[HiringStageBucket]
    top_vacancies: list[HiringTopVacancy]


# ----- Dev-activity (CodeBuddy aggregation) --------------------------------


class StaleMrAlert(BaseModel):
    employee_id: int
    full_name: str
    stale_count: int
    oldest_age_days: int
    sample_title: str | None = None
    sample_url: str | None = None


class TeamCompetencyAggregate(BaseModel):
    competency_id: int
    competency_name: str
    total_signal_count: int
    employees_with: int


class DevLeaderboardEmployee(BaseModel):
    """Метрики одного сотрудника для независимых рейтингов команды."""

    employee_id: int
    full_name: str
    total_mrs: int
    avg_quality_ratio: float
    comments_given: int
    avg_time_to_merge_hours: float | None = None
    tests_ratio: float
    stale_count: int


class DevActivitySummary(BaseModel):
    """Сводка по разработческой активности команды (источник: CodeBuddy).

    Если интеграция выключена (`codebuddy_live=false`) — `enabled=False` и
    остальные поля пустые/нулевые.
    """

    enabled: bool
    period_from: date | None = None
    period_to: date | None = None
    team_size: int
    with_metrics: int  # сотрудников, по которым удалось получить данные
    total_mrs: int  # сумма total_mrs по команде
    avg_quality_ratio: float | None = None
    stale_total: int
    wip_total: int
    stale_alerts: list[StaleMrAlert] = []
    top_competencies: list[TeamCompetencyAggregate] = []
    leaderboard: list[DevLeaderboardEmployee] = []
