from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

SelfReviewStatus = Literal["draft", "submitted", "closed"]


class SelfReviewCreate(BaseModel):
    year: int
    project_score: int | None = Field(default=None, ge=1, le=10)
    company_score: int | None = Field(default=None, ge=1, le=10)
    manager_notes_md: str | None = None


class SelfReviewUpdate(BaseModel):
    project_score: int | None = Field(default=None, ge=1, le=10)
    company_score: int | None = Field(default=None, ge=1, le=10)
    manager_notes_md: str | None = None
    status: SelfReviewStatus | None = None
    scheduled_1on1_at: datetime | None = None


class SelfReviewListItem(BaseModel):
    """Краткий элемент для списка ревью сотрудника / общего списка."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_name: str | None = None
    owner_id: int | None = None
    owner_name: str | None = None
    year: int
    status: SelfReviewStatus
    has_source: bool
    project_score: int | None
    company_score: int | None
    submitted_at: datetime | None
    closed_at: datetime | None
    scheduled_1on1_at: datetime | None
    created_at: datetime


class SelfReviewPublic(BaseModel):
    """Полная карточка ревью (без бинарных данных)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    employee_name: str
    year: int
    status: SelfReviewStatus

    has_source: bool
    source_filename: str | None
    source_size_bytes: int | None
    source_uploaded_at: datetime | None

    project_score: int | None
    company_score: int | None
    manager_notes_md: str | None

    ai_topics_md: str | None
    ai_comparison_md: str | None
    ai_burnout_md: str | None
    ai_calibration_md: str | None
    ai_drafting_md: str | None

    submitted_at: datetime | None
    closed_at: datetime | None
    scheduled_1on1_at: datetime | None
    created_by: int
    created_at: datetime


class SelfReviewDashboard(BaseModel):
    """Агрегаты по «своим» сотрудникам для виджета на дашборде."""

    total_employees: int
    reviews_current_year: int
    reviews_draft: int
    reviews_submitted: int
    reviews_closed: int
    avg_project_score: float | None
    avg_company_score: float | None
