from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

DeptMaturityStatus = Literal["draft", "done"]


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None


class DepartmentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class DepartmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    owner_id: int
    owner_name: str | None
    is_owner: bool
    created_at: datetime


class DeptMaturitySurveyCreate(BaseModel):
    period: str = Field(min_length=1, max_length=20)


class DeptMaturitySurveyUpdate(BaseModel):
    info: dict[str, Any] | None = None
    answers: dict[str, Any] | None = None
    status: DeptMaturityStatus | None = None


class DirectionMarks(BaseModel):
    name: str
    level_marks: dict[str, float | None]
    level: int
    rating: float
    processes: list[str] = []


class DeptMaturityMarks(BaseModel):
    by_direction: dict[str, DirectionMarks]
    total_rating: float
    overall_level: int


class DeptMaturitySurveyPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    department_id: int
    period: str
    status: DeptMaturityStatus
    template_version: str
    info: dict[str, Any]
    answers: dict[str, Any]
    completed_at: datetime | None
    created_by: int
    created_by_name: str | None
    created_at: datetime
    marks: DeptMaturityMarks


class DeptMaturitySurveyListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    department_id: int
    period: str
    status: DeptMaturityStatus
    completed_at: datetime | None
    created_at: datetime
    created_by: int
    created_by_name: str | None
    overall_level: int
    total_rating: float
    rating_by_direction: dict[str, float]


class DeptMaturityProcess(BaseModel):
    code: str
    name: str


class DeptMaturityDirection(BaseModel):
    code: str
    name: str
    processes: list[DeptMaturityProcess]


class DeptMaturityCriterion(BaseModel):
    level: int
    idx: int
    what: str
    how: str | None = None


class DeptMaturityTemplate(BaseModel):
    version: str
    period_default: str
    directions: list[DeptMaturityDirection]
    level_names: list[str]
    criteria: list[DeptMaturityCriterion]


class DeptMaturityOverviewItem(BaseModel):
    """Для cross-department отчёта-таблицы (heatmap practice × direction)."""

    department_id: int
    department_name: str
    owner_name: str | None
    period: str
    overall_level: int
    total_rating: float
    rating_by_direction: dict[str, float]
