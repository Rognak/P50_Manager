from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.mpk import GradePublic, RolePublic


class EmployeeBase(BaseModel):
    full_name: str
    email: str | None = None
    position: str | None = None


class EmployeeCreate(EmployeeBase):
    hired_at: date | None = None


class EmployeeUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    position: str | None = None
    role_id: int | None = None
    grade_id: int | None = None
    department_id: int | None = None
    hired_at: date | None = None
    left_at: date | None = None


class DepartmentRef(BaseModel):
    """Минимальная ссылка на отдел для прикрепления к сотруднику."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class OwnerRef(BaseModel):
    """Минимальная ссылка на руководителя — для CoreTeam-фильтрации."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str


class EmployeePublic(EmployeeBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    owner_id: int
    owner: OwnerRef | None = None
    role: RolePublic | None = None
    grade: GradePublic | None = None
    department: DepartmentRef | None = None
    hired_at: date | None = None
    left_at: date | None = None


class EmployeeProjectHistoryItem(BaseModel):
    """Один продукт из истории сотрудника. Текущие = left_at is None."""

    product_id: int
    product_name: str
    product_status: str  # active | on_hold | completed
    gitlab_group: str | None = None
    role_in_project: str | None
    joined_at: date | None
    left_at: date | None
    rotation_locked: bool
    rotation_lock_note: str | None
    is_current: bool


class EmployeeImportRow(BaseModel):
    """Одна строка preview импорта из XLSX.

    `action='create'` — будет создан, `'skip'` — пропускается (дубликат),
    `'error'` — невалидная строка (например, без ФИО).

    Импортируем минимальный набор полей: ФИО, email, должность, дата найма.
    Роль/грейд проставляются вручную в карточке сотрудника после импорта.
    `department_id` — приходит из UI (отдел текущего DH)."""

    row: int  # номер строки в Excel (1-based, начиная с заголовка)
    action: Literal["create", "skip", "error"]
    full_name: str | None
    email: str | None
    position: str | None
    department_id: int | None
    hired_at: date | None
    warnings: list[str] = []
    error: str | None = None


class EmployeeImportPreview(BaseModel):
    total_rows: int
    to_create: int
    to_skip: int
    errors: int
    rows: list[EmployeeImportRow]


class EmployeeImportCommit(BaseModel):
    """Подтверждение импорта — список строк, которые пользователь хочет создать.
    UI отправляет только те, у которых `action='create'` (с возможными правками)."""

    rows: list[EmployeeImportRow]


class EmployeeImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[str] = []


class EmployeeListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str | None
    position: str | None
    owner_id: int
    owner: OwnerRef | None = None
    role: RolePublic | None = None
    grade: GradePublic | None = None
    department: DepartmentRef | None = None
    hired_at: date | None = None
    left_at: date | None = None
