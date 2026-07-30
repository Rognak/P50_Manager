from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RecommendationGenerateRequest(BaseModel):
    procedure_id: int | None = None  # если привязываем к процедуре
    title: str | None = None  # человеко-понятное название; если не задано — сгенерируется


class RecommendationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    employee_id: int
    procedure_id: int | None
    title: str
    content_md: str
    context_summary: dict
    model: str
    created_by: int
    created_at: datetime


class RecommendationListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    procedure_id: int | None
    model: str
    created_at: datetime
