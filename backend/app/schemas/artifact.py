from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

ArtifactKind = Literal[
    "question_answer",
    "task_answer",
    "task_code",
    "manager_comment",
    "general_note",
]


class MeetingArtifactUpsert(BaseModel):
    kind: ArtifactKind
    ai_item_uid: str | None = None
    competency_id: int | None = None
    content: str


class MeetingArtifactPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    meeting_id: int
    kind: ArtifactKind
    ai_item_uid: str | None
    competency_id: int | None
    content: str
    created_by: int
    created_at: datetime
    updated_at: datetime
