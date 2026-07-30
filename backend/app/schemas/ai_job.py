from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

JobStatus = Literal["queued", "running", "done", "error"]
JobKind = Literal[
    "meeting_questions",
    "meeting_tasks",
    "meeting_summary",
    "procedure_preparation",
    "employee_recommendation",
    "rotation_suggestion",
    "self_review_topics",
    "self_review_compare",
    "self_review_burnout",
    "self_review_calibration",
    "self_review_draft",
    "candidate_screening",
    "digital_profile",
]


class AIJobPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: JobKind
    status: JobStatus
    employee_id: int
    target_kind: str | None
    target_id: int | None
    payload: dict
    result: dict | None
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_by: int
    created_at: datetime
