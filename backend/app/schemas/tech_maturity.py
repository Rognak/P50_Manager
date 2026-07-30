from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

TechMaturityStatus = Literal["draft", "done"]


class TechMaturitySurveyCreate(BaseModel):
    period: str = Field(min_length=1, max_length=20)  # e.g. '2026-Q1'


class TechMaturitySurveyUpdate(BaseModel):
    info: dict[str, Any] | None = None
    answers: dict[str, Any] | None = None
    status: TechMaturityStatus | None = None


class DirectionMarks(BaseModel):
    name: str
    level_marks: dict[str, float | None]  # "1".."5" → доля
    level: int  # достигнутый уровень
    rating: float


class TechMaturityMarks(BaseModel):
    by_direction: dict[str, DirectionMarks]
    total_rating: float
    overall_level: int


class TechMaturitySurveyPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int | None = None
    period: str
    status: TechMaturityStatus
    template_version: str
    info: dict[str, Any]
    answers: dict[str, Any]
    completed_at: datetime | None
    created_by: int
    created_by_name: str | None
    created_at: datetime
    marks: TechMaturityMarks


class TechMaturitySurveyListItem(BaseModel):
    """Краткая запись со счётчиками для списка / графика динамики."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int | None = None
    period: str
    status: TechMaturityStatus
    completed_at: datetime | None
    created_at: datetime
    created_by: int
    created_by_name: str | None
    overall_level: int
    total_rating: float
    rating_by_direction: dict[str, float]  # directionCode → rating


class TechMaturityTemplate(BaseModel):
    """Возвращаем шаблон как JSON для рендера формы на фронте."""

    version: str
    period_default: str
    process: dict[str, Any]
    direction: dict[str, str]
    levels: list[str]
    data: list[dict[str, Any]]
