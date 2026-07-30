from datetime import date

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
from app.models.mpk import Assessment, AssessmentScore, Meeting
from app.schemas.assessment import (
    AssessmentCreate,
    AssessmentListItem,
    AssessmentPublic,
)


def _to_public(a: Assessment) -> dict:
    return {
        "id": a.id,
        "employee_id": a.employee_id,
        "assessed_at": a.assessed_at,
        "author_id": a.author_id,
        "source": a.source,
        "notes": a.notes,
        "meeting_ids": [m.id for m in a.meetings],
        "scores": a.scores,
    }


def _to_list_item(a: Assessment) -> dict:
    return {
        "id": a.id,
        "assessed_at": a.assessed_at,
        "source": a.source,
        "notes": a.notes,
        "meeting_ids": [m.id for m in a.meetings],
    }

router = APIRouter(prefix="/employees/{employee_id}/assessments", tags=["assessments"])


async def _ensure_owner(session, employee_id: int, current_user) -> Employee:
    q = await session.execute(select(Employee).where(Employee.id == employee_id))
    emp = q.scalar_one_or_none()
    if emp is None or not can_view_employee_owned_by(current_user, emp.owner_id):
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return emp


@router.get("", response_model=list[AssessmentListItem])
async def list_assessments(employee_id: int, session: SessionDep, current_user: CurrentUser):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Assessment)
        .options(selectinload(Assessment.meetings))
        .where(Assessment.employee_id == employee_id)
        .order_by(Assessment.assessed_at.desc(), Assessment.id.desc())
    )
    return [_to_list_item(a) for a in q.scalars()]


@router.get("/{assessment_id}", response_model=AssessmentPublic)
async def get_assessment(
    employee_id: int,
    assessment_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Assessment)
        .options(selectinload(Assessment.scores), selectinload(Assessment.meetings))
        .where(Assessment.id == assessment_id, Assessment.employee_id == employee_id)
    )
    a = q.scalar_one_or_none()
    if a is None:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    return _to_public(a)


@router.post("", response_model=AssessmentPublic, status_code=status.HTTP_201_CREATED)
async def create_assessment(
    employee_id: int,
    payload: AssessmentCreate,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)

    seen: set[int] = set()
    for s in payload.scores:
        if s.competency_id in seen:
            raise HTTPException(
                status_code=400,
                detail=f"Дубль competency_id={s.competency_id} в scores",
            )
        seen.add(s.competency_id)

    meeting_ids = list({mid for mid in payload.meeting_ids})
    meetings: list[Meeting] = []
    if meeting_ids:
        mq = await session.execute(
            select(Meeting).where(
                Meeting.id.in_(meeting_ids),
                Meeting.employee_id == employee_id,
            )
        )
        meetings = list(mq.scalars())
        if len(meetings) != len(meeting_ids):
            raise HTTPException(
                status_code=400,
                detail="Одна или несколько встреч не найдены или принадлежат другому сотруднику",
            )

    assessment = Assessment(
        employee_id=employee_id,
        author_id=current_user.id,
        assessed_at=payload.assessed_at or date.today(),
        notes=payload.notes,
        source="meeting" if meetings else "manual",
    )
    for s in payload.scores:
        assessment.scores.append(
            AssessmentScore(competency_id=s.competency_id, level=s.level, comment=s.comment)
        )
    assessment.meetings = meetings
    session.add(assessment)
    await session.commit()
    await session.refresh(assessment, attribute_names=["scores", "meetings"])
    return _to_public(assessment)


@router.delete("/{assessment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_assessment(
    employee_id: int,
    assessment_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Assessment).where(
            Assessment.id == assessment_id, Assessment.employee_id == employee_id
        )
    )
    a = q.scalar_one_or_none()
    if a is None:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    await session.delete(a)
    await session.commit()
