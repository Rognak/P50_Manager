from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, delete, select

from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    can_view_employee_owned_by,
)
from app.models.employee import Employee
from app.models.mpk import Meeting, MeetingArtifact
from app.schemas.artifact import MeetingArtifactPublic, MeetingArtifactUpsert

router = APIRouter(
    prefix="/employees/{employee_id}/meetings/{meeting_id}/artifacts",
    tags=["artifacts"],
)


async def _load_meeting(
    session, employee_id: int, meeting_id: int, current_user
) -> Meeting:
    q = await session.execute(select(Employee).where(Employee.id == employee_id))
    emp = q.scalar_one_or_none()
    if emp is None or not can_view_employee_owned_by(current_user, emp.owner_id):
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    q = await session.execute(
        select(Meeting).where(
            Meeting.id == meeting_id, Meeting.employee_id == employee_id
        )
    )
    meeting = q.scalar_one_or_none()
    if meeting is None:
        raise HTTPException(status_code=404, detail="Встреча не найдена")
    return meeting


@router.get("", response_model=list[MeetingArtifactPublic])
async def list_artifacts(
    employee_id: int,
    meeting_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _load_meeting(session, employee_id, meeting_id, current_user)
    q = await session.execute(
        select(MeetingArtifact)
        .where(MeetingArtifact.meeting_id == meeting_id)
        .order_by(MeetingArtifact.created_at)
    )
    return list(q.scalars())


@router.put("/upsert", response_model=MeetingArtifactPublic | None)
async def upsert_artifact(
    employee_id: int,
    meeting_id: int,
    payload: MeetingArtifactUpsert,
    session: SessionDep,
    current_user: MutatorUser,
):
    """Upsert по ключу (meeting_id, kind, ai_item_uid).
    Пустой content → запись удаляется, возвращает null."""
    await _load_meeting(session, employee_id, meeting_id, current_user)

    content = payload.content.strip()

    # для NULL ai_item_uid стандартный == не работает — используем IS NULL
    if payload.ai_item_uid is None:
        where_clause = and_(
            MeetingArtifact.meeting_id == meeting_id,
            MeetingArtifact.kind == payload.kind,
            MeetingArtifact.ai_item_uid.is_(None),
        )
    else:
        where_clause = and_(
            MeetingArtifact.meeting_id == meeting_id,
            MeetingArtifact.kind == payload.kind,
            MeetingArtifact.ai_item_uid == payload.ai_item_uid,
        )

    existing_q = await session.execute(select(MeetingArtifact).where(where_clause))
    existing = existing_q.scalar_one_or_none()

    if not content:
        if existing is not None:
            await session.delete(existing)
            await session.commit()
        return None

    if existing is None:
        artifact = MeetingArtifact(
            meeting_id=meeting_id,
            kind=payload.kind,
            ai_item_uid=payload.ai_item_uid,
            competency_id=payload.competency_id,
            content=content,
            created_by=current_user.id,
        )
        session.add(artifact)
        await session.commit()
        await session.refresh(artifact)
        return artifact

    existing.content = content
    if payload.competency_id is not None:
        existing.competency_id = payload.competency_id
    await session.commit()
    await session.refresh(existing)
    return existing


@router.delete("/{artifact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_artifact(
    employee_id: int,
    meeting_id: int,
    artifact_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _load_meeting(session, employee_id, meeting_id, current_user)
    q = await session.execute(
        select(MeetingArtifact).where(
            MeetingArtifact.id == artifact_id,
            MeetingArtifact.meeting_id == meeting_id,
        )
    )
    artifact = q.scalar_one_or_none()
    if artifact is None:
        raise HTTPException(status_code=404, detail="Артефакт не найден")
    await session.execute(delete(MeetingArtifact).where(MeetingArtifact.id == artifact_id))
    await session.commit()
