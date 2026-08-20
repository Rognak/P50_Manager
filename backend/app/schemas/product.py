"""Pydantic-схемы для Product (логической единицы из 1+ репо)."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ProductStatus = Literal["active", "on_hold", "completed"]


# ----- CRUD --------------------------------------------------------------


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    status: ProductStatus = "active"
    started_at: date | None = None
    finished_at: date | None = None
    gitlab_group: str | None = None


class ProductUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: ProductStatus | None = None
    started_at: date | None = None
    finished_at: date | None = None
    gitlab_group: str | None = None


class ProductRepoRef(BaseModel):
    """Краткая инфа о репо в составе продукта."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    gitlab_project_id: int | None
    gitlab_group: str | None


class ProductListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    status: ProductStatus
    started_at: date | None
    finished_at: date | None
    gitlab_group: str | None
    created_by: int
    members_count: int
    competencies_count: int
    repos_count: int


# ----- Members ----------------------------------------------------------


class ProductMemberAdd(BaseModel):
    employee_id: int
    role_in_project: str | None = None
    joined_at: date | None = None


class ProductMemberUpdate(BaseModel):
    role_in_project: str | None = None
    joined_at: date | None = None
    left_at: date | None = None


class ProductMemberPublic(BaseModel):
    id: int
    employee_id: int
    full_name: str
    role_name: str | None
    grade_code: str | None
    owner_id: int
    owner_name: str | None
    role_in_project: str | None
    joined_at: date | None
    left_at: date | None
    rotation_locked: bool
    rotation_lock_note: str | None
    is_yours: bool


# ----- Competencies (stack) --------------------------------------------


class ProductCompetencyPublic(BaseModel):
    competency_id: int
    competency_name: str
    target_level: int


class ProductCompetencyUpdate(BaseModel):
    competency_id: int
    target_level: int = Field(ge=0, le=5)


class ProductStackBulkUpdate(BaseModel):
    items: list[ProductCompetencyUpdate]


# ----- Detail -----------------------------------------------------------


class ProductPublic(BaseModel):
    id: int
    name: str
    description: str | None
    status: ProductStatus
    started_at: date | None
    finished_at: date | None
    gitlab_group: str | None
    created_by: int
    created_at: datetime
    members: list[ProductMemberPublic]
    competencies: list[ProductCompetencyPublic]
    repos: list[ProductRepoRef]
