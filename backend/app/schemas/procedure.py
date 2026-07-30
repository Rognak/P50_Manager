from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ProcedureStatus = Literal["open", "closed"]


class ProcedureCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    period_start: date | None = None
    period_end: date | None = None


class ProcedureUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    period_start: date | None = None
    period_end: date | None = None
    status: ProcedureStatus | None = None
    summary_md: str | None = None


class ProcedurePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    title: str
    period_start: date | None
    period_end: date | None
    status: ProcedureStatus
    summary_md: str | None
    role_snapshot: str | None = None
    grade_snapshot: str | None = None
    preparation_md: str | None = None
    created_by: int
    created_at: datetime
    meeting_ids: list[int] = []
    assessment_ids: list[int] = []


class ProcedureListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    period_start: date | None
    period_end: date | None
    status: ProcedureStatus
    role_snapshot: str | None = None
    grade_snapshot: str | None = None
    meetings_count: int
    assessments_count: int
    created_at: datetime


class ProcedureSnapshotItem(BaseModel):
    competency_id: int
    competency_name: str
    sort_order: int
    procedure_level: int | None
    required_level: int | None
    gap: int | None


class ProcedureSnapshot(BaseModel):
    items: list[ProcedureSnapshotItem]
