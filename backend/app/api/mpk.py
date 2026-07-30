from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import selectinload

from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
)
from app.models.mpk import (
    Competency,
    Grade,
    ProficiencyLevel,
    Role,
    RoleProfile,
    role_key_competencies,
)
from app.schemas.mpk import (
    CompetencyPublic,
    GradePublic,
    KeyCompetencyUpdate,
    LevelPublic,
    ProfileCellUpdate,
    RoleProfileCompetency,
    RoleProfileDetail,
    RolePublic,
)

router = APIRouter(prefix="/mpk", tags=["mpk"])


@router.get("/competencies", response_model=list[CompetencyPublic])
async def list_competencies(session: SessionDep, _current_user: CurrentUser):
    q = await session.execute(
        select(Competency)
        .options(selectinload(Competency.criteria))
        .order_by(Competency.sort_order, Competency.id)
    )
    return list(q.scalars())


@router.get("/levels", response_model=list[LevelPublic])
async def list_levels(session: SessionDep, _current_user: CurrentUser):
    q = await session.execute(select(ProficiencyLevel).order_by(ProficiencyLevel.code))
    return list(q.scalars())


@router.get("/roles", response_model=list[RolePublic])
async def list_roles(session: SessionDep, _current_user: CurrentUser):
    q = await session.execute(select(Role).order_by(Role.name))
    return list(q.scalars())


@router.get("/grades", response_model=list[GradePublic])
async def list_grades(session: SessionDep, _current_user: CurrentUser):
    q = await session.execute(select(Grade).order_by(Grade.sort_order))
    return list(q.scalars())


@router.get("/roles/{role_id}/profile", response_model=RoleProfileDetail)
async def get_role_profile(
    role_id: int, session: SessionDep, _current_user: CurrentUser
):
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Роль не найдена")

    grades = list((await session.execute(select(Grade).order_by(Grade.sort_order))).scalars())
    comps = list(
        (
            await session.execute(
                select(Competency).order_by(Competency.sort_order, Competency.id)
            )
        ).scalars()
    )
    profiles = list(
        (
            await session.execute(
                select(RoleProfile).where(RoleProfile.role_id == role_id)
            )
        ).scalars()
    )
    key_ids = set(
        (
            await session.execute(
                select(role_key_competencies.c.competency_id).where(
                    role_key_competencies.c.role_id == role_id
                )
            )
        )
        .scalars()
        .all()
    )

    profile_by_comp: dict[int, dict[int, int]] = {}
    for p in profiles:
        if p.required_level > 0:
            profile_by_comp.setdefault(p.competency_id, {})[p.grade_id] = p.required_level

    competencies = [
        RoleProfileCompetency(
            competency_id=c.id,
            competency_name=c.name,
            sort_order=c.sort_order,
            is_key=c.id in key_ids,
            levels=profile_by_comp.get(c.id, {}),
        )
        for c in comps
    ]

    return RoleProfileDetail(
        role=RolePublic.model_validate(role),
        grades=[GradePublic.model_validate(g) for g in grades],
        competencies=competencies,
    )


@router.patch("/roles/{role_id}/profile-cell", status_code=status.HTTP_204_NO_CONTENT)
async def patch_profile_cell(
    role_id: int,
    payload: ProfileCellUpdate,
    session: SessionDep,
    _current_user: MutatorUser,
):
    if not 0 <= payload.required_level <= 5:
        raise HTTPException(status_code=400, detail="Уровень должен быть 0..5")

    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Роль не найдена")

    comp = await session.get(Competency, payload.competency_id)
    grade = await session.get(Grade, payload.grade_id)
    if comp is None or grade is None:
        raise HTTPException(status_code=404, detail="Компетенция или грейд не найдены")

    existing_q = await session.execute(
        select(RoleProfile).where(
            RoleProfile.role_id == role_id,
            RoleProfile.grade_id == payload.grade_id,
            RoleProfile.competency_id == payload.competency_id,
        )
    )
    existing = existing_q.scalar_one_or_none()

    if payload.required_level == 0:
        if existing is not None:
            await session.delete(existing)
    else:
        if existing is None:
            session.add(
                RoleProfile(
                    role_id=role_id,
                    grade_id=payload.grade_id,
                    competency_id=payload.competency_id,
                    required_level=payload.required_level,
                )
            )
        else:
            existing.required_level = payload.required_level

    await session.commit()


@router.patch("/roles/{role_id}/key-competency", status_code=status.HTTP_204_NO_CONTENT)
async def patch_key_competency(
    role_id: int,
    payload: KeyCompetencyUpdate,
    session: SessionDep,
    _current_user: MutatorUser,
):
    role = await session.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=404, detail="Роль не найдена")
    comp = await session.get(Competency, payload.competency_id)
    if comp is None:
        raise HTTPException(status_code=404, detail="Компетенция не найдена")

    if payload.is_key:
        stmt = pg_insert(role_key_competencies).values(
            role_id=role_id, competency_id=payload.competency_id
        )
        stmt = stmt.on_conflict_do_nothing()
        await session.execute(stmt)
    else:
        await session.execute(
            role_key_competencies.delete().where(
                role_key_competencies.c.role_id == role_id,
                role_key_competencies.c.competency_id == payload.competency_id,
            )
        )

    await session.commit()
