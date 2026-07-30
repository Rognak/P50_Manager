from datetime import date

from pydantic import BaseModel, ConfigDict, Field


class AssessmentScoreIn(BaseModel):
    competency_id: int
    level: int = Field(ge=0, le=5)
    comment: str | None = None


class AssessmentScorePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    competency_id: int
    level: int
    comment: str | None


class AssessmentCreate(BaseModel):
    assessed_at: date | None = None
    notes: str | None = None
    meeting_ids: list[int] = []
    scores: list[AssessmentScoreIn]


class AssessmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    assessed_at: date
    author_id: int
    source: str
    notes: str | None
    meeting_ids: list[int] = []
    scores: list[AssessmentScorePublic]


class AssessmentListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    assessed_at: date
    source: str
    notes: str | None
    meeting_ids: list[int] = []
