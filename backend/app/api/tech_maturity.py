"""Tech Maturity API: опросник техзрелости продукта по периодам.

С этапа 3+ тех.зрелость живёт на уровне Product (не отдельного репо).
"""

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
)
from app.models.project import Product
from app.models.tech_maturity import TechMaturitySurvey
from app.models.user import User
from app.schemas.tech_maturity import (
    TechMaturityMarks,
    TechMaturitySurveyCreate,
    TechMaturitySurveyListItem,
    TechMaturitySurveyPublic,
    TechMaturitySurveyUpdate,
    TechMaturityTemplate,
)
from app.tech_maturity.scoring import calc_marks, load_template

router = APIRouter(prefix="/products/{product_id}/tech-maturity", tags=["tech-maturity"])


async def _check_product_access(session, product_id: int, current_user) -> Product:
    from app.api.deps import is_product_manager

    prod = await session.get(Product, product_id)
    if prod is None:
        raise HTTPException(status_code=404, detail="Продукт не найден")
    if is_product_manager(current_user) and prod.product_manager_id != current_user.id:
        raise HTTPException(status_code=404, detail="Продукт не найден")
    return prod


@router.get("/template", response_model=TechMaturityTemplate)
async def get_template(product_id: int, session: SessionDep, current_user: CurrentUser):
    """Шаблон опросника. Не зависит от продукта, но эндпоинт под префиксом
    продукта — проще на клиенте."""
    await _check_product_access(session, product_id, current_user)
    return load_template()


@router.get("", response_model=list[TechMaturitySurveyListItem])
async def list_surveys(product_id: int, session: SessionDep, current_user: CurrentUser):
    await _check_product_access(session, product_id, current_user)
    q = await session.execute(
        select(TechMaturitySurvey, User.full_name)
        .join(User, User.id == TechMaturitySurvey.created_by)
        .where(TechMaturitySurvey.product_id == product_id)
        .order_by(TechMaturitySurvey.period.desc())
    )
    rows = list(q.all())
    template = load_template()
    out: list[TechMaturitySurveyListItem] = []
    for r, author_name in rows:
        m = calc_marks(template, r.answers or {})
        out.append(
            TechMaturitySurveyListItem(
                id=r.id,
                product_id=r.product_id,
                period=r.period,
                status=r.status,
                completed_at=r.completed_at,
                created_at=r.created_at,
                created_by=r.created_by,
                created_by_name=author_name,
                overall_level=m["overall_level"],
                total_rating=m["total_rating"],
                rating_by_direction={dc: d["rating"] for dc, d in m["by_direction"].items()},
            )
        )
    return out


@router.post("", response_model=TechMaturitySurveyPublic, status_code=status.HTTP_201_CREATED)
async def create_survey(
    product_id: int,
    payload: TechMaturitySurveyCreate,
    session: SessionDep,
    current_user: MutatorUser,
):
    prod = await _check_product_access(session, product_id, current_user)
    existing = await session.execute(
        select(TechMaturitySurvey).where(
            TechMaturitySurvey.product_id == product_id,
            TechMaturitySurvey.period == payload.period,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Опросник за {payload.period} уже создан",
        )
    template = load_template()
    rv = TechMaturitySurvey(
        product_id=product_id,
        period=payload.period,
        status="draft",
        template_version=template["version"],
        info={
            "code": "",
            "team": prod.name,
            "owner": "",
            "manager": "",
            "version": template["version"],
            "period": payload.period,
        },
        answers={},
        created_by=current_user.id,
    )
    session.add(rv)
    await session.commit()
    await session.refresh(rv)
    return await _to_public(session, rv)


@router.get("/{survey_id}", response_model=TechMaturitySurveyPublic)
async def get_survey(
    product_id: int,
    survey_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _check_product_access(session, product_id, current_user)
    rv = await _load(session, product_id, survey_id)
    return await _to_public(session, rv)


@router.patch("/{survey_id}", response_model=TechMaturitySurveyPublic)
async def update_survey(
    product_id: int,
    survey_id: int,
    payload: TechMaturitySurveyUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _check_product_access(session, product_id, current_user)
    rv = await _load(session, product_id, survey_id)
    if payload.info is not None:
        rv.info = {**(rv.info or {}), **payload.info}
    if payload.answers is not None:
        merged = dict(rv.answers or {})
        merged.update(payload.answers)
        rv.answers = merged
    if payload.status is not None and payload.status != rv.status:
        if payload.status == "done" and rv.completed_at is None:
            rv.completed_at = datetime.now(UTC)
        if payload.status == "draft":
            rv.completed_at = None
        rv.status = payload.status
    await session.commit()
    await session.refresh(rv)
    return await _to_public(session, rv)


@router.delete("/{survey_id}", status_code=204)
async def delete_survey(
    product_id: int,
    survey_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _check_product_access(session, product_id, current_user)
    rv = await _load(session, product_id, survey_id)
    await session.delete(rv)
    await session.commit()


# ---------- helpers ----------


async def _load(session, product_id: int, survey_id: int) -> TechMaturitySurvey:
    rv = await session.get(TechMaturitySurvey, survey_id)
    if rv is None or rv.product_id != product_id:
        raise HTTPException(status_code=404, detail="Опросник не найден")
    return rv


async def _to_public(session, rv: TechMaturitySurvey) -> TechMaturitySurveyPublic:
    template = load_template()
    m = calc_marks(template, rv.answers or {})
    author = await session.get(User, rv.created_by)
    return TechMaturitySurveyPublic(
        id=rv.id,
        product_id=rv.product_id,
        period=rv.period,
        status=rv.status,
        template_version=rv.template_version,
        info=rv.info or {},
        answers=rv.answers or {},
        completed_at=rv.completed_at,
        created_by=rv.created_by,
        created_by_name=author.full_name if author else None,
        created_at=rv.created_at,
        marks=TechMaturityMarks.model_validate(m),
    )
