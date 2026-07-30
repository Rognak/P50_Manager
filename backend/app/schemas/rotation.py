from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ReplacementCandidatePublic(BaseModel):
    employee_id: int
    full_name: str
    role_name: str | None
    grade_code: str | None
    owner_id: int
    current_project_id: int | None
    current_project_name: str | None
    tenure_months: int
    overlap_competencies: list[dict]  # [{competency_id, competency_name}]
    fit_score: float
    readiness_score: float
    total_score: float
    status: Literal["ready", "approachable", "early", "free"]
    blocker: Literal["locked", "pending"] | None


class RotationCandidatePublic(BaseModel):
    """Кандидат на ротацию с разложенным score'ом и (если есть) AI-обоснованием."""

    model_config = ConfigDict(from_attributes=True)

    employee_id: int
    member_id: int
    full_name: str
    role_id: int | None
    role_name: str | None
    grade_id: int | None
    grade_code: str | None
    owner_id: int
    owner_name: str | None
    joined_at: date | None
    tenure_months: int

    rotation_locked: bool
    rotation_lock_note: str | None
    pending_rotation_id: int | None

    tenure_score: int
    bus_factor_score: int
    score: int
    bus_factor_competencies: list[dict]  # [{competency_id, competency_name}]

    # из RotationSuggestion (если есть)
    rationale_md: str | None
    target_projects: list[dict]  # [{project_id, project_name, code}]
    suggestion_generated_at: datetime | None
    suggestion_running: bool  # True если AIJob ещё в queue/running

    # нужна ли замена по ★-слотам уходящего (без знания целевого проекта)
    replacement_needed: bool
    # имя текущего проекта — для пояснений в UI
    replacement_project_name: str
    # ★-компетенции роли уходящего, которые входят в стек проекта
    replacement_role_keys_in_stack: list[dict]  # [{competency_id, competency_name}]


class RotationsPanel(BaseModel):
    """Что показываем во вкладке «Ротации» проекта."""

    candidates: list[RotationCandidatePublic]
    no_candidates: bool  # True → «ротация не требуется»


class GlobalRotationCandidate(RotationCandidatePublic):
    """Кандидат с информацией о его проекте (для общей вкладки «Ротации»)."""

    from_project_id: int
    from_project_code: str | None
    from_project_name: str


class LockedMemberPublic(BaseModel):
    """Заморожённый от ротации участник активного проекта (для глобальной вкладки)."""

    model_config = ConfigDict(from_attributes=True)

    employee_id: int
    member_id: int
    full_name: str
    role_name: str | None
    grade_code: str | None
    owner_id: int
    owner_name: str | None
    project_id: int
    project_name: str
    project_code: str | None
    joined_at: date | None
    tenure_months: int
    rotation_lock_note: str | None


class ReplacementsResponse(BaseModel):
    """Кандидаты на замену для конкретной пары (employee, from_project, to_project)."""

    needed: bool
    viable: list[ReplacementCandidatePublic]
    blocked: list[ReplacementCandidatePublic]
    empty_reason: str | None


class JobAccepted(BaseModel):
    """Ответ на ручной запуск пересчёта обоснования."""

    job_id: int
    employee_id: int
    from_project_id: int


# ---------- lifecycle ----------


RotationStatus = Literal["proposed", "accepted", "completed", "cancelled", "reverted"]


class RotationCreate(BaseModel):
    employee_id: int
    # Новый формат: указываем продукты (ротация на уровне продукта). Старые
    # project_id-поля оставлены для обратной совместимости (старая страница
    # Rotations.tsx и /projects/{id}/rotations всё ещё их используют).
    # Если переданы product-поля — используется новая ветка propose_rotation.
    from_product_id: int | None = None
    to_product_id: int | None = None
    from_project_id: int | None = None
    to_project_id: int | None = None
    reason_md: str | None = None
    planned_start_at: date | None = None
    extra_approver_ids: list[int] = []  # дополнительные согласующие сверх авто
    replacement_employee_id: int | None = None  # для записи в reason_md


class ApprovalDecision(BaseModel):
    decision: Literal["approve", "reject"]
    comment: str | None = None


class RotationApproverPreview(BaseModel):
    """Один авто-согласующий для предпросмотра перед созданием ротации."""

    user_id: int
    full_name: str | None
    reasons: list[str]  # почему он согласует (может быть несколько ролей)
    is_initiator: bool  # совпадает с текущим пользователем → авто-голос


class RotationApprovalPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: int
    user_name: str | None
    decision: Literal["approve", "reject"] | None
    decided_at: datetime | None
    comment: str | None


class RotationPublic(BaseModel):
    """Полная карточка ротации. С этапа 3 поля from_project_*/to_project_*
    могут быть None (для ротаций нового формата — на уровне продукта); тогда
    смотрите from_product_*/to_product_*."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_name: str
    # Старые поля проекта (для bw-compat и для отображения «откуда/куда» на
    # старых ротациях, заведённых до этапа 3).
    from_project_id: int | None
    from_project_name: str | None
    from_project_code: str | None
    to_project_id: int | None
    to_project_name: str | None
    to_project_code: str | None
    # Новые поля продукта.
    from_product_id: int | None = None
    from_product_name: str | None = None
    to_product_id: int | None = None
    to_product_name: str | None = None
    status: RotationStatus
    reason_md: str | None
    initiated_by_id: int
    initiated_by_name: str | None
    proposed_at: datetime
    planned_start_at: date | None
    accepted_at: datetime | None
    completed_at: datetime | None
    cancelled_at: datetime | None
    reverted_at: datetime | None
    reverted_by_id: int | None
    replacement_employee_id: int | None
    replacement_full_name: str | None
    approvals: list[RotationApprovalPublic]


class RotationListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_name: str
    # На этапе 3+ ротации создаются на уровне продукта, поэтому project-поля
    # могут быть None.
    from_project_id: int | None
    from_project_name: str | None
    to_project_id: int | None
    to_project_name: str | None
    from_product_id: int | None = None
    from_product_name: str | None = None
    to_product_id: int | None = None
    to_product_name: str | None = None
    status: RotationStatus
    proposed_at: datetime
    completed_at: datetime | None


class MemberLockBody(BaseModel):
    note: str | None = Field(default=None, max_length=500)
