from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ProjectStatus = Literal["active", "on_hold", "completed"]


class ProjectCreate(BaseModel):
    code: str | None = None
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    status: ProjectStatus = "active"
    started_at: date | None = None
    finished_at: date | None = None


class ProjectUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    description: str | None = None
    status: ProjectStatus | None = None
    started_at: date | None = None
    finished_at: date | None = None
    gitlab_group: str | None = None


class ProjectListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str | None
    name: str
    status: ProjectStatus
    started_at: date | None
    finished_at: date | None
    members_count: int
    competencies_count: int
    created_by: int
    gitlab_group: str | None = None
    gitlab_project_id: int | None = None


class ProjectMemberAdd(BaseModel):
    employee_id: int
    role_in_project: str | None = None
    joined_at: date | None = None


class ProjectMemberUpdate(BaseModel):
    role_in_project: str | None = None
    joined_at: date | None = None
    left_at: date | None = None


class ProjectMemberPublic(BaseModel):
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


class ProjectCompetencyPublic(BaseModel):
    competency_id: int
    competency_name: str
    target_level: int


class ProjectCompetencyUpdate(BaseModel):
    competency_id: int
    target_level: int = Field(ge=0, le=5)


class ProjectStackBulkUpdate(BaseModel):
    items: list[ProjectCompetencyUpdate]


class ProjectPublic(BaseModel):
    id: int
    code: str | None
    name: str
    description: str | None
    status: ProjectStatus
    started_at: date | None
    finished_at: date | None
    created_by: int
    created_at: datetime
    members: list[ProjectMemberPublic]
    competencies: list[ProjectCompetencyPublic]
    gitlab_group: str | None = None
    gitlab_project_id: int | None = None
    product_id: int | None = None


# Матрица оценок
class MatrixCell(BaseModel):
    employee_id: int
    competency_id: int
    level: int | None  # latest-per-comp current level или null если не оценивали


class MatrixCompetencyRef(BaseModel):
    competency_id: int
    competency_name: str
    target_level: int | None  # из стека проекта (если задан)


class MatrixEmployeeRef(BaseModel):
    employee_id: int
    full_name: str
    role_name: str | None
    grade_code: str | None


class ProjectMatrix(BaseModel):
    employees: list[MatrixEmployeeRef]
    competencies: list[MatrixCompetencyRef]
    cells: list[MatrixCell]


# Покрытие тех.стека
class CoverageItem(BaseModel):
    competency_id: int
    competency_name: str
    target_level: int
    members_total: int
    members_assessed: int
    members_meeting: int  # current_level >= target_level
    members_below: int
    avg_level: float | None


class ProjectCoverage(BaseModel):
    items: list[CoverageItem]
    risk_score: int  # сумма (target - avg) по компетенциям где avg < target


class GradeCount(BaseModel):
    grade_code: str
    sort_order: int
    count: int


class ProjectGradeDistribution(BaseModel):
    items: list[GradeCount]
    no_grade: int  # без грейда


# Поиск сотрудников для добавления
class EmployeeSearchItem(BaseModel):
    id: int
    full_name: str
    role_name: str | None
    grade_code: str | None
    owner_id: int
    owner_name: str | None
    is_yours: bool
