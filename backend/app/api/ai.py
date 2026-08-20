"""AI endpoints — теперь все enqueue в ARQ. Возвращают AIJob, клиент поллит /ai-jobs/{id}."""

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import (
    MutatorUser,
    SessionDep,
    can_view_employee_owned_by,
)
from app.models.employee import Employee
from app.models.mpk import AIJob, Meeting
from app.redis_pool import get_pool
from app.schemas.ai import AIGenParams, AISummaryRequest
from app.schemas.ai_job import AIJobPublic

router = APIRouter(
    prefix="/employees/{employee_id}/meetings/{meeting_id}/ai",
    tags=["ai"],
)


async def _load_meeting(
    session, employee_id: int, meeting_id: int, current_user
) -> tuple[Employee, Meeting]:
    q = await session.execute(
        select(Employee)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .where(Employee.id == employee_id)
    )
    emp = q.scalar_one_or_none()
    if emp is None or not can_view_employee_owned_by(current_user, emp.owner_id):
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    q = await session.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.employee_id == employee_id)
    )
    meeting = q.scalar_one_or_none()
    if meeting is None:
        raise HTTPException(status_code=404, detail="Встреча не найдена")
    return emp, meeting


async def _enqueue_job(
    session,
    *,
    kind: str,
    employee_id: int,
    target_kind: str | None,
    target_id: int | None,
    payload: dict,
    created_by: int,
    function_name: str,
) -> AIJob:
    job = AIJob(
        kind=kind,
        status="queued",
        employee_id=employee_id,
        target_kind=target_kind,
        target_id=target_id,
        payload=payload,
        created_by=created_by,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    pool = get_pool()
    await pool.enqueue_job(function_name, job.id)
    return job


@router.post("/questions", response_model=AIJobPublic)
async def queue_questions(
    employee_id: int,
    meeting_id: int,
    params: AIGenParams,
    session: SessionDep,
    current_user: MutatorUser,
):
    emp, meeting = await _load_meeting(session, employee_id, meeting_id, current_user)
    return await _enqueue_job(
        session,
        kind="meeting_questions",
        employee_id=emp.id,
        target_kind="meeting",
        target_id=meeting.id,
        payload=params.model_dump(mode="json"),
        created_by=current_user.id,
        function_name="run_meeting_questions",
    )


@router.post("/tasks", response_model=AIJobPublic)
async def queue_tasks(
    employee_id: int,
    meeting_id: int,
    params: AIGenParams,
    session: SessionDep,
    current_user: MutatorUser,
):
    emp, meeting = await _load_meeting(session, employee_id, meeting_id, current_user)
    return await _enqueue_job(
        session,
        kind="meeting_tasks",
        employee_id=emp.id,
        target_kind="meeting",
        target_id=meeting.id,
        payload=params.model_dump(mode="json"),
        created_by=current_user.id,
        function_name="run_meeting_tasks",
    )


@router.post("/summary", response_model=AIJobPublic)
async def queue_summary(
    employee_id: int,
    meeting_id: int,
    payload: AISummaryRequest,
    session: SessionDep,
    current_user: MutatorUser,
):
    emp, meeting = await _load_meeting(session, employee_id, meeting_id, current_user)
    return await _enqueue_job(
        session,
        kind="meeting_summary",
        employee_id=emp.id,
        target_kind="meeting",
        target_id=meeting.id,
        payload={"notes": payload.notes},
        created_by=current_user.id,
        function_name="run_meeting_summary",
    )
