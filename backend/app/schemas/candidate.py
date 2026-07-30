from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.mpk import GradePublic, RolePublic

CandidateStage = Literal["new", "screening", "interview", "offer", "hired", "rejected"]
FeedbackDecision = Literal["positive", "negative"]


class CandidateCreate(BaseModel):
    """Создаём как Employee + CandidateProfile одной записью."""

    full_name: str = Field(min_length=1)
    email: str | None = None
    position: str | None = None  # ожидаемая должность
    source: str | None = None
    vacancy_id: int | None = None
    expected_role_id: int | None = None
    expected_grade_id: int | None = None


class CandidateUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    position: str | None = None
    stage: CandidateStage | None = None
    source: str | None = None
    vacancy_id: int | None = None
    expected_role_id: int | None = None
    expected_grade_id: int | None = None


class CandidateVacancyRef(BaseModel):
    """Минимальная ссылка на вакансию в карточке кандидата."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    status: str
    project_id: int | None = None
    project_name: str | None = None


class CandidatePublic(BaseModel):
    """Полная карточка кандидата (без бинарных данных резюме)."""

    model_config = ConfigDict(from_attributes=True)

    id: int  # = employee_id
    employee_id: int
    full_name: str
    email: str | None
    position: str | None
    owner_id: int
    stage: CandidateStage
    source: str | None
    vacancy: CandidateVacancyRef | None = None
    expected_role: RolePublic | None
    expected_grade: GradePublic | None

    has_resume: bool
    resume_filename: str | None
    resume_size_bytes: int | None
    resume_uploaded_at: datetime | None

    # AI-скрининг: качественная рекомендация (да/нет) + обоснование
    ai_screening_recommended: bool | None
    ai_screening_reasoning_md: str | None
    ai_screening_at: datetime | None

    feedback_decision: FeedbackDecision | None
    rejection_reason_md: str | None

    hired_at: date | None
    created_at: datetime


class CandidateListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str | None
    position: str | None
    stage: CandidateStage
    source: str | None
    vacancy_id: int | None = None
    vacancy_title: str | None = None
    expected_role_name: str | None
    expected_grade_code: str | None
    has_resume: bool
    ai_screening_recommended: bool | None = None
    feedback_decision: FeedbackDecision | None
    created_at: datetime


class CandidateRejectBody(BaseModel):
    reason_md: str | None = None


class CandidateDecisionUpdate(BaseModel):
    """Ручная правка финального решения после интервью."""

    feedback_decision: FeedbackDecision | None = None
    rejection_reason_md: str | None = None
