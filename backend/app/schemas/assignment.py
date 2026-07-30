from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

AssignmentStatus = Literal[
    "open",
    "in_progress",
    "pending_review",
    "done",
    "cancelled",
]


class AssignmentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description_md: str | None = None
    due_at: datetime | None = None
    # Ровно один из двух:
    assignee_user_id: int | None = None
    assignee_employee_id: int | None = None

    @model_validator(mode="after")
    def _exactly_one_assignee(self) -> "AssignmentCreate":
        a = self.assignee_user_id is not None
        b = self.assignee_employee_id is not None
        if a == b:
            raise ValueError(
                "Нужен ровно один адресат: assignee_user_id или assignee_employee_id"
            )
        return self


class AssignmentUpdate(BaseModel):
    title: str | None = None
    description_md: str | None = None
    due_at: datetime | None = None
    status: AssignmentStatus | None = None


class AssigneeRef(BaseModel):
    """Единая ссылка на адресата — User или Employee."""

    kind: Literal["user", "employee"]
    id: int
    full_name: str


class AssignmentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description_md: str | None
    due_at: datetime | None
    status: AssignmentStatus
    completed_at: datetime | None

    created_by_id: int
    created_by_name: str | None
    assignee: AssigneeRef

    has_attachment: bool
    attachment_filename: str | None
    attachment_size_bytes: int | None
    attachment_uploaded_at: datetime | None

    created_at: datetime
    updated_at: datetime


class AssignmentListItem(BaseModel):
    """Строка для таблицы списка."""

    id: int
    title: str
    due_at: datetime | None
    status: AssignmentStatus
    created_by_id: int
    created_by_name: str | None
    assignee: AssigneeRef
    has_attachment: bool
    completed_at: datetime | None
    created_at: datetime
