from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

MeetingStatus = Literal["planned", "done", "cancelled"]


class MeetingCreate(BaseModel):
    scheduled_at: datetime
    duration_min: int = Field(default=30, ge=5, le=600)
    status: MeetingStatus = "planned"
    agenda_md: str | None = None
    summary_md: str | None = None
    transcript_md: str | None = None
    procedure_id: int | None = None


class MeetingUpdate(BaseModel):
    scheduled_at: datetime | None = None
    duration_min: int | None = Field(default=None, ge=5, le=600)
    status: MeetingStatus | None = None
    agenda_md: str | None = None
    summary_md: str | None = None
    transcript_md: str | None = None


class MeetingPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    procedure_id: int | None = None
    scheduled_at: datetime
    duration_min: int
    status: MeetingStatus
    agenda_md: str | None
    summary_md: str | None
    transcript_md: str | None = None
    ai_questions: dict | None = None
    ai_tasks: dict | None = None
    created_by: int
