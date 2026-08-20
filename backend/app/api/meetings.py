from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from sqlalchemy.orm import selectinload

from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    can_view_employee_owned_by,
)
from app.models.employee import Employee
from app.models.mpk import Assessment, Meeting, MpkProcedure
from app.schemas.assessment import AssessmentListItem
from app.schemas.meeting import MeetingCreate, MeetingPublic, MeetingUpdate

router = APIRouter(prefix="/employees/{employee_id}/meetings", tags=["meetings"])


async def _ensure_owner(session, employee_id: int, current_user) -> Employee:
    q = await session.execute(
        select(Employee)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .where(Employee.id == employee_id)
    )
    emp = q.scalar_one_or_none()
    if emp is None or not can_view_employee_owned_by(current_user, emp.owner_id):
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return emp


@router.get("", response_model=list[MeetingPublic])
async def list_meetings(employee_id: int, session: SessionDep, current_user: CurrentUser):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Meeting)
        .where(Meeting.employee_id == employee_id)
        .order_by(Meeting.scheduled_at.desc())
    )
    return list(q.scalars())


@router.post("", response_model=MeetingPublic, status_code=status.HTTP_201_CREATED)
async def create_meeting(
    employee_id: int,
    payload: MeetingCreate,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)

    if payload.procedure_id is not None:
        pq = await session.execute(
            select(MpkProcedure).where(
                MpkProcedure.id == payload.procedure_id,
                MpkProcedure.employee_id == employee_id,
            )
        )
        if pq.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=400, detail="Процедура не найдена или принадлежит другому сотруднику"
            )

    meeting = Meeting(
        employee_id=employee_id,
        procedure_id=payload.procedure_id,
        created_by=current_user.id,
        scheduled_at=payload.scheduled_at,
        duration_min=payload.duration_min,
        status=payload.status,
        agenda_md=payload.agenda_md,
        summary_md=payload.summary_md,
        transcript_md=payload.transcript_md,
    )
    session.add(meeting)
    await session.commit()
    await session.refresh(meeting)
    return meeting


@router.get("/{meeting_id}", response_model=MeetingPublic)
async def get_meeting(
    employee_id: int,
    meeting_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.employee_id == employee_id)
    )
    m = q.scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail="Встреча не найдена")
    return m


@router.patch("/{meeting_id}", response_model=MeetingPublic)
async def update_meeting(
    employee_id: int,
    meeting_id: int,
    payload: MeetingUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.employee_id == employee_id)
    )
    m = q.scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail="Встреча не найдена")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(m, key, value)
    await session.commit()
    await session.refresh(m)
    return m


@router.get("/{meeting_id}/assessments", response_model=list[AssessmentListItem])
async def list_meeting_assessments(
    employee_id: int,
    meeting_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Assessment)
        .options(selectinload(Assessment.meetings))
        .join(Assessment.meetings)
        .where(
            Assessment.employee_id == employee_id,
            Meeting.id == meeting_id,
        )
        .order_by(Assessment.assessed_at.desc(), Assessment.id.desc())
    )
    result = []
    for a in q.scalars().unique():
        result.append(
            {
                "id": a.id,
                "assessed_at": a.assessed_at,
                "source": a.source,
                "notes": a.notes,
                "meeting_ids": [m.id for m in a.meetings],
            }
        )
    return result


@router.delete("/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_meeting(
    employee_id: int,
    meeting_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.employee_id == employee_id)
    )
    m = q.scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail="Встреча не найдена")
    await session.delete(m)
    await session.commit()
