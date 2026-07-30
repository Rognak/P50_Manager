from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, SessionDep
from app.models.employee import Employee
from app.models.mpk import (
    Assessment,
    AssessmentScore,
    Competency,
    RoleProfile,
)
from app.models.user import User
from app.schemas.mpk import GradePublic, MpkProfileItem, RolePublic

router = APIRouter(tags=["employee-public"])


class PublicProfile(BaseModel):
    id: int
    full_name: str
    position: str | None
    role: RolePublic | None
    grade: GradePublic | None
    owner_id: int
    owner_name: str | None
    is_owner: bool
    items: list[MpkProfileItem]
    last_assessment_at: str | None


@router.get("/employees/{employee_id}/public-profile", response_model=PublicProfile)
async def get_public_profile(
    employee_id: int, session: SessionDep, current_user: CurrentUser
):
    """Публичная карточка сотрудника: ФИО, роль, грейд, owner + полный МПК-профиль
    (latest-per-comp + required + gap). Без assessments/artifacts/recommendations.
    Доступна любому авторизованному."""
    eq = await session.execute(
        select(Employee, User.full_name)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .join(User, User.id == Employee.owner_id)
        .where(Employee.id == employee_id)
    )
    row = eq.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    emp, owner_name = row

    # latest-per-comp
    cur_q = await session.execute(
        select(AssessmentScore.competency_id, AssessmentScore.level)
        .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
        .where(Assessment.employee_id == emp.id)
        .order_by(
            AssessmentScore.competency_id,
            Assessment.assessed_at.desc(),
            Assessment.id.desc(),
        )
        .distinct(AssessmentScore.competency_id)
    )
    current_by_comp: dict[int, int] = {cid: lvl for cid, lvl in cur_q.all()}

    last_q = await session.execute(
        select(Assessment.assessed_at)
        .where(Assessment.employee_id == emp.id)
        .order_by(Assessment.assessed_at.desc(), Assessment.id.desc())
        .limit(1)
    )
    last_at = last_q.scalar_one_or_none()

    required_by_comp: dict[int, int] = {}
    if emp.role_id and emp.grade_id:
        rq = await session.execute(
            select(RoleProfile).where(
                RoleProfile.role_id == emp.role_id,
                RoleProfile.grade_id == emp.grade_id,
            )
        )
        for p in rq.scalars():
            required_by_comp[p.competency_id] = p.required_level

    cq = await session.execute(
        select(Competency).order_by(Competency.sort_order, Competency.id)
    )
    items: list[MpkProfileItem] = []
    for c in cq.scalars():
        cur = current_by_comp.get(c.id)
        req = required_by_comp.get(c.id)
        # Без оценки фактический уровень неизвестен — gap тоже None,
        # чтобы UI показал «—» вместо ложного «+req».
        gap = (req - cur) if (req is not None and cur is not None) else None
        items.append(
            MpkProfileItem(
                competency_id=c.id,
                competency_name=c.name,
                sort_order=c.sort_order,
                current_level=cur,
                required_level=req,
                gap=gap,
            )
        )

    return PublicProfile(
        id=emp.id,
        full_name=emp.full_name,
        position=emp.position,
        role=RolePublic.model_validate(emp.role) if emp.role else None,
        grade=GradePublic.model_validate(emp.grade) if emp.grade else None,
        owner_id=emp.owner_id,
        owner_name=owner_name,
        is_owner=emp.owner_id == current_user.id,
        items=items,
        last_assessment_at=str(last_at) if last_at else None,
    )
