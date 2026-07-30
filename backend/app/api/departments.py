"""Departments + their tech maturity surveys."""
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, MutatorUser, SessionDep
from app.department.scoring import calc_marks, load_template
from app.models.department import Department, DeptMaturitySurvey
from app.models.user import User
from app.notifications.service import publish_pending, record_notifications
from app.schemas.department import (
    DepartmentCreate,
    DepartmentPublic,
    DepartmentUpdate,
    DeptMaturityMarks,
    DeptMaturityOverviewItem,
    DeptMaturitySurveyCreate,
    DeptMaturitySurveyListItem,
    DeptMaturitySurveyPublic,
    DeptMaturitySurveyUpdate,
    DeptMaturityTemplate,
)

router = APIRouter(prefix="/departments", tags=["departments"])


# ---------- departments ----------


async def _to_dept(
    session, d: Department, current_user_id: int
) -> DepartmentPublic:
    owner = await session.get(User, d.owner_id)
    return DepartmentPublic(
        id=d.id,
        name=d.name,
        description=d.description,
        owner_id=d.owner_id,
        owner_name=owner.full_name if owner else None,
        is_owner=d.owner_id == current_user_id,
        created_at=d.created_at,
    )


def _ensure_owner(d: Department, user: User) -> None:
    if d.owner_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Редактировать отдел может только его руководитель",
        )


@router.get("", response_model=list[DepartmentPublic])
async def list_departments(session: SessionDep, current_user: CurrentUser):
    """Все отделы (видны всем — для общего отчёта)."""
    q = await session.execute(
        select(Department, User.full_name)
        .join(User, User.id == Department.owner_id)
        .order_by(Department.name)
    )
    return [
        DepartmentPublic(
            id=d.id,
            name=d.name,
            description=d.description,
            owner_id=d.owner_id,
            owner_name=name,
            is_owner=d.owner_id == current_user.id,
            created_at=d.created_at,
        )
        for d, name in q.all()
    ]


@router.post(
    "", response_model=DepartmentPublic, status_code=status.HTTP_201_CREATED
)
async def create_department(
    payload: DepartmentCreate, session: SessionDep, current_user: MutatorUser
):
    d = Department(
        name=payload.name.strip(),
        description=payload.description,
        owner_id=current_user.id,
    )
    session.add(d)
    await session.commit()
    await session.refresh(d)
    return await _to_dept(session, d, current_user.id)


@router.get("/{department_id}", response_model=DepartmentPublic)
async def get_department(
    department_id: int, session: SessionDep, current_user: CurrentUser
):
    d = await session.get(Department, department_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Отдел не найден")
    return await _to_dept(session, d, current_user.id)


@router.patch("/{department_id}", response_model=DepartmentPublic)
async def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    d = await session.get(Department, department_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Отдел не найден")
    _ensure_owner(d, current_user)
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        if isinstance(v, str):
            v = v.strip() or None
        setattr(d, k, v)
    await session.commit()
    await session.refresh(d)
    return await _to_dept(session, d, current_user.id)


@router.delete("/{department_id}", status_code=204)
async def delete_department(
    department_id: int, session: SessionDep, current_user: MutatorUser
):
    d = await session.get(Department, department_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Отдел не найден")
    _ensure_owner(d, current_user)
    await session.delete(d)
    await session.commit()


# ---------- maturity surveys ----------


@router.get(
    "/{department_id}/maturity/template", response_model=DeptMaturityTemplate
)
async def get_template(
    department_id: int, session: SessionDep, _current_user: CurrentUser
):
    d = await session.get(Department, department_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Отдел не найден")
    return load_template()


@router.get(
    "/{department_id}/maturity",
    response_model=list[DeptMaturitySurveyListItem],
)
async def list_surveys(
    department_id: int, session: SessionDep, _current_user: CurrentUser
):
    d = await session.get(Department, department_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Отдел не найден")
    q = await session.execute(
        select(DeptMaturitySurvey, User.full_name)
        .join(User, User.id == DeptMaturitySurvey.created_by)
        .where(DeptMaturitySurvey.department_id == department_id)
        .order_by(DeptMaturitySurvey.period.desc())
    )
    template = load_template()
    out: list[DeptMaturitySurveyListItem] = []
    for r, author in q.all():
        m = calc_marks(template, r.answers or {})
        out.append(
            DeptMaturitySurveyListItem(
                id=r.id,
                department_id=r.department_id,
                period=r.period,
                status=r.status,
                completed_at=r.completed_at,
                created_at=r.created_at,
                created_by=r.created_by,
                created_by_name=author,
                overall_level=m["overall_level"],
                total_rating=m["total_rating"],
                rating_by_direction={
                    dc: d["rating"] for dc, d in m["by_direction"].items()
                },
            )
        )
    return out


@router.post(
    "/{department_id}/maturity",
    response_model=DeptMaturitySurveyPublic,
    status_code=status.HTTP_201_CREATED,
)
async def create_survey(
    department_id: int,
    payload: DeptMaturitySurveyCreate,
    session: SessionDep,
    current_user: MutatorUser,
):
    d = await session.get(Department, department_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Отдел не найден")
    _ensure_owner(d, current_user)
    existing = await session.execute(
        select(DeptMaturitySurvey).where(
            DeptMaturitySurvey.department_id == department_id,
            DeptMaturitySurvey.period == payload.period,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409, detail=f"Опросник за {payload.period} уже создан"
        )
    template = load_template()
    rv = DeptMaturitySurvey(
        department_id=department_id,
        period=payload.period,
        status="draft",
        template_version=template["version"],
        info={
            "department_name": d.name,
            "period": payload.period,
            "version": template["version"],
        },
        answers={},
        created_by=current_user.id,
    )
    session.add(rv)
    await session.flush()

    # Уведомляем CoreTeam — у них надзорная функция за процессами
    ct_q = await session.execute(
        select(User.id).where(
            User.role == "core_team", User.is_active.is_(True)
        )
    )
    ct_ids = [uid for (uid,) in ct_q.all()]
    notifs = await record_notifications(
        session,
        recipient_user_ids=ct_ids,
        kind="dept_maturity_started",
        title=f"Новый опросник тех.зрелости: «{d.name}»",
        body=f"Период: {payload.period}. Создал: {current_user.full_name}",
        link=f"/departments/{d.id}",
        payload={"department_id": d.id, "survey_id": rv.id, "period": payload.period},
        exclude_user_ids=[current_user.id],
    )
    await session.commit()
    await session.refresh(rv)
    await publish_pending(notifs)
    return await _to_survey_public(session, rv)


@router.get(
    "/{department_id}/maturity/{survey_id}",
    response_model=DeptMaturitySurveyPublic,
)
async def get_survey(
    department_id: int,
    survey_id: int,
    session: SessionDep,
    _current_user: CurrentUser,
):
    rv = await _load_survey(session, department_id, survey_id)
    return await _to_survey_public(session, rv)


@router.patch(
    "/{department_id}/maturity/{survey_id}",
    response_model=DeptMaturitySurveyPublic,
)
async def update_survey(
    department_id: int,
    survey_id: int,
    payload: DeptMaturitySurveyUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    d = await session.get(Department, department_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Отдел не найден")
    _ensure_owner(d, current_user)
    rv = await _load_survey(session, department_id, survey_id)
    if payload.info is not None:
        rv.info = {**(rv.info or {}), **payload.info}
    if payload.answers is not None:
        merged = dict(rv.answers or {})
        merged.update(payload.answers)
        rv.answers = merged
    completed_now = False
    if payload.status is not None and payload.status != rv.status:
        if payload.status == "done" and rv.completed_at is None:
            rv.completed_at = datetime.now(UTC)
            completed_now = True
        if payload.status == "draft":
            rv.completed_at = None
        rv.status = payload.status

    notifs: list = []
    if completed_now:
        ct_q = await session.execute(
            select(User.id).where(
                User.role == "core_team", User.is_active.is_(True)
            )
        )
        ct_ids = [uid for (uid,) in ct_q.all()]
        notifs = await record_notifications(
            session,
            recipient_user_ids=ct_ids,
            kind="dept_maturity_done",
            title=f"Опросник завершён: «{d.name}»",
            body=f"Период {rv.period}. Завершил {current_user.full_name}.",
            link=f"/departments/{d.id}",
            payload={"department_id": d.id, "survey_id": rv.id},
            exclude_user_ids=[current_user.id],
        )

    await session.commit()
    await session.refresh(rv)
    await publish_pending(notifs)
    return await _to_survey_public(session, rv)


@router.delete("/{department_id}/maturity/{survey_id}", status_code=204)
async def delete_survey(
    department_id: int,
    survey_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    d = await session.get(Department, department_id)
    if d is None:
        raise HTTPException(status_code=404, detail="Отдел не найден")
    _ensure_owner(d, current_user)
    rv = await _load_survey(session, department_id, survey_id)
    await session.delete(rv)
    await session.commit()


# ---------- cross-departments overview ----------


overview_router = APIRouter(prefix="/dept-maturity", tags=["departments"])


@overview_router.get("/overview", response_model=list[DeptMaturityOverviewItem])
async def overview(
    session: SessionDep,
    _current_user: CurrentUser,
    period: str | None = None,
):
    """Сводный отчёт по последнему опроснику каждого отдела (или за конкретный период)."""
    template = load_template()
    # подгружаем отделы + последний/нужный опросник на каждый
    dq = await session.execute(
        select(Department, User.full_name).join(User, User.id == Department.owner_id)
    )
    rows = list(dq.all())
    items: list[DeptMaturityOverviewItem] = []
    for d, owner_name in rows:
        sq = select(DeptMaturitySurvey).where(
            DeptMaturitySurvey.department_id == d.id
        )
        if period:
            sq = sq.where(DeptMaturitySurvey.period == period)
        sq = sq.order_by(DeptMaturitySurvey.period.desc()).limit(1)
        rv = (await session.execute(sq)).scalar_one_or_none()
        if rv is None:
            continue
        m = calc_marks(template, rv.answers or {})
        items.append(
            DeptMaturityOverviewItem(
                department_id=d.id,
                department_name=d.name,
                owner_name=owner_name,
                period=rv.period,
                overall_level=m["overall_level"],
                total_rating=m["total_rating"],
                rating_by_direction={
                    dc: x["rating"] for dc, x in m["by_direction"].items()
                },
            )
        )
    items.sort(key=lambda x: -x.total_rating)
    return items


# ---------- helpers ----------


async def _load_survey(
    session, department_id: int, survey_id: int
) -> DeptMaturitySurvey:
    rv = await session.get(DeptMaturitySurvey, survey_id)
    if rv is None or rv.department_id != department_id:
        raise HTTPException(status_code=404, detail="Опросник не найден")
    return rv


async def _to_survey_public(
    session, rv: DeptMaturitySurvey
) -> DeptMaturitySurveyPublic:
    template = load_template()
    m = calc_marks(template, rv.answers or {})
    author = await session.get(User, rv.created_by)
    return DeptMaturitySurveyPublic(
        id=rv.id,
        department_id=rv.department_id,
        period=rv.period,
        status=rv.status,
        template_version=rv.template_version,
        info=rv.info or {},
        answers=rv.answers or {},
        completed_at=rv.completed_at,
        created_by=rv.created_by,
        created_by_name=author.full_name if author else None,
        created_at=rv.created_at,
        marks=DeptMaturityMarks.model_validate(m),
    )
