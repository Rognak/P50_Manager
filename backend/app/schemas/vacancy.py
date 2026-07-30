from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

VacancyStatus = Literal["open", "closed"]


class VacancyCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    project_id: int | None = None
    department_id: int | None = None
    role_id: int | None = None
    grade_id: int | None = None
    requirements_md: str | None = None

    @model_validator(mode="after")
    def _target_required(self) -> "VacancyCreate":
        if self.project_id is None and self.department_id is None:
            raise ValueError(
                "Нужно указать project_id или department_id (либо оба)"
            )
        return self


class VacancyUpdate(BaseModel):
    title: str | None = None
    project_id: int | None = None
    department_id: int | None = None
    role_id: int | None = None
    grade_id: int | None = None
    requirements_md: str | None = None
    status: VacancyStatus | None = None


class VacancyRef(BaseModel):
    """Минимальная ссылка для вложения в карточку кандидата."""

    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    status: VacancyStatus


class VacancyPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    project_id: int | None
    project_name: str | None
    department_id: int | None
    department_name: str | None
    role_id: int | None
    role_name: str | None
    grade_id: int | None
    grade_code: str | None
    requirements_md: str | None
    status: VacancyStatus
    created_by_id: int
    created_by_name: str | None
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    candidates_count: int = 0


class VacancyListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    project_id: int | None
    project_name: str | None
    department_id: int | None
    department_name: str | None
    role_name: str | None
    grade_code: str | None
    status: VacancyStatus
    created_at: datetime
    candidates_count: int


class RequirementsTemplateRequest(BaseModel):
    role_id: int | None = None
    grade_id: int | None = None
    project_id: int | None = None


class RequirementsTemplate(BaseModel):
    requirements_md: str
