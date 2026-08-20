"""API продуктов (логической единицы из 1+ GitLab-репозиториев).

Зеркалит /projects API, но оперирует на уровне продукта:
  • ProductMember вместо ProjectMember (агрегат по всем репо).
  • ProductCompetency вместо ProjectCompetency (общий стек для всех репо).
  • Ротации, vacancy, AI-suggestions — на уровне продукта.

Карточка отдельного репо живёт на старом `/projects/{id}` и содержит
только dev-метрики + PR-ы этого репо.
"""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import and_, or_

from app.admin.settings import is_codebuddy_live
from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    is_product_manager,
)
from app.codebuddy.client import CodeBuddyAPIError
from app.codebuddy.competency_matching import (
    build_catalog_index,
    pr_matches_signals,
)
from app.codebuddy.projects_sync import sync_projects_from_codebuddy
from app.codebuddy.service import codebuddy_service
from app.models.employee import Employee
from app.models.mpk import (
    Assessment,
    AssessmentScore,
    Competency,
    Grade,
    RoleProfile,
    role_key_competencies,
)
from app.models.project import (
    Product,
    ProductCompetency,
    ProductMember,
    Project,
)
from app.models.performance import ProductPerformanceReview
from app.models.rotation import RotationSuggestion
from app.models.user import User
from app.schemas.dev_metrics import (
    DevMetricsSnapshotPublic,
    ProjectExtractedCompetenciesResponse,
    ProjectExtractedCompetencyItem,
    PullRequestPublic,
)
from app.schemas.project import (
    CoverageItem,
    GradeCount,
    MatrixCell,
    MatrixCompetencyRef,
    MatrixEmployeeRef,
    ProjectCoverage,
    ProjectGradeDistribution,
    ProjectMatrix,
)
from app.schemas.product import (
    ProductCompetencyPublic,
    ProductCreate,
    ProductListItem,
    ProductMemberAdd,
    ProductMemberPublic,
    ProductMemberUpdate,
    ProductPublic,
    ProductRepoRef,
    ProductStackBulkUpdate,
    ProductUpdate,
)
from app.products.performance import (
    aggregate_for_deltas,
    build_developers,
    build_health,
    build_signals,
    gather_prs_only,
    gather_raw_devs,
)
from app.rotations.ranking import compute_candidates_for_product
from app.redis_pool import get_pool as get_arq_pool
from app.schemas.performance import (
    PerformanceReviewPublic,
    ProductPerformanceResponse,
    ProductTrendsResponse,
    TrendBucket,
)
from app.schemas.rotation import (
    MemberLockBody,
    RotationCandidatePublic,
    RotationsPanel,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/products", tags=["products"])


# ----- helpers ----------------------------------------------------------


async def _load_product(session, product_id: int) -> Product:
    q = await session.execute(select(Product).where(Product.id == product_id))
    prod = q.scalar_one_or_none()
    if prod is None:
        raise HTTPException(status_code=404, detail="Продукт не найден")
    return prod


def _can_access_product(user, prod: Product) -> bool:
    if is_product_manager(user):
        return prod.product_manager_id == user.id
    return True


async def _load_product_for(session, product_id: int, current_user) -> Product:
    prod = await _load_product(session, product_id)
    if not _can_access_product(current_user, prod):
        raise HTTPException(status_code=404, detail="Продукт не найден")
    return prod


async def _build_member_publics(
    session,
    product_id: int,
    current_user_id: int,
    only_member_ids: list[int] | None = None,
) -> list[ProductMemberPublic]:
    stmt = (
        select(ProductMember)
        .where(ProductMember.product_id == product_id)
        .order_by(ProductMember.id)
    )
    if only_member_ids is not None:
        if not only_member_ids:
            return []
        stmt = stmt.where(ProductMember.id.in_(only_member_ids))
    mq = await session.execute(stmt)
    members = list(mq.scalars())
    if not members:
        return []
    emp_ids = [m.employee_id for m in members]
    eq = await session.execute(
        select(Employee, User.full_name)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .join(User, User.id == Employee.owner_id)
        .where(Employee.id.in_(emp_ids))
    )
    by_id: dict[int, tuple[Employee, str]] = {
        emp.id: (emp, owner_name) for emp, owner_name in eq.all()
    }
    out: list[ProductMemberPublic] = []
    for m in members:
        if m.employee_id not in by_id:
            continue
        emp, owner_name = by_id[m.employee_id]
        out.append(
            ProductMemberPublic(
                id=m.id,
                employee_id=emp.id,
                full_name=emp.full_name,
                role_name=emp.role.name if emp.role else None,
                grade_code=emp.grade.code if emp.grade else None,
                owner_id=emp.owner_id,
                owner_name=owner_name,
                role_in_project=m.role_in_project,
                joined_at=m.joined_at,
                left_at=m.left_at,
                rotation_locked=m.rotation_locked,
                rotation_lock_note=m.rotation_lock_note,
                is_yours=emp.owner_id == current_user_id,
            )
        )
    return out


async def _build_competency_publics(session, product_id: int) -> list[ProductCompetencyPublic]:
    cq = await session.execute(
        select(ProductCompetency, Competency.name)
        .join(Competency, Competency.id == ProductCompetency.competency_id)
        .where(ProductCompetency.product_id == product_id)
        .order_by(Competency.name)
    )
    return [
        ProductCompetencyPublic(
            competency_id=pc.competency_id,
            competency_name=name,
            target_level=pc.target_level,
        )
        for pc, name in cq.all()
    ]


async def _build_repos(session, product_id: int) -> list[ProductRepoRef]:
    rq = await session.execute(
        select(Project).where(Project.product_id == product_id).order_by(Project.name)
    )
    return [ProductRepoRef.model_validate(p) for p in rq.scalars()]


async def _to_public(session, prod: Product, current_user_id: int) -> ProductPublic:
    return ProductPublic(
        id=prod.id,
        name=prod.name,
        description=prod.description,
        status=prod.status,
        started_at=prod.started_at,
        finished_at=prod.finished_at,
        gitlab_group=prod.gitlab_group,
        created_by=prod.created_by,
        created_at=prod.created_at,
        members=await _build_member_publics(session, prod.id, current_user_id),
        competencies=await _build_competency_publics(session, prod.id),
        repos=await _build_repos(session, prod.id),
    )


# ----- list / CRUD -------------------------------------------------------


@router.get("", response_model=list[ProductListItem])
async def list_products(session: SessionDep, current_user: CurrentUser):
    stmt = (
        select(
            Product,
            func.count(ProductMember.id.distinct()).label("members_count"),
        )
        .outerjoin(ProductMember, ProductMember.product_id == Product.id)
        .group_by(Product.id)
        .order_by(Product.name)
    )
    if is_product_manager(current_user):
        stmt = stmt.where(Product.product_manager_id == current_user.id)
    rows = (await session.execute(stmt)).all()
    if not rows:
        return []
    pids = [p.id for p, _ in rows]
    # competencies count
    cc_q = await session.execute(
        select(ProductCompetency.product_id, func.count())
        .where(ProductCompetency.product_id.in_(pids))
        .group_by(ProductCompetency.product_id)
    )
    comp_count = {pid: c for pid, c in cc_q.all()}
    # repos count
    rc_q = await session.execute(
        select(Project.product_id, func.count())
        .where(Project.product_id.in_(pids))
        .group_by(Project.product_id)
    )
    repos_count = {pid: c for pid, c in rc_q.all()}

    return [
        ProductListItem(
            id=p.id,
            name=p.name,
            status=p.status,
            started_at=p.started_at,
            finished_at=p.finished_at,
            gitlab_group=p.gitlab_group,
            created_by=p.created_by,
            members_count=members_count,
            competencies_count=comp_count.get(p.id, 0),
            repos_count=repos_count.get(p.id, 0),
        )
        for p, members_count in rows
    ]


@router.post("", response_model=ProductPublic, status_code=status.HTTP_201_CREATED)
async def create_product(payload: ProductCreate, session: SessionDep, current_user: MutatorUser):
    prod = Product(
        name=payload.name.strip(),
        description=payload.description,
        status=payload.status,
        started_at=payload.started_at,
        finished_at=payload.finished_at,
        gitlab_group=(payload.gitlab_group or None) or None,
        created_by=current_user.id,
        product_manager_id=(current_user.id if is_product_manager(current_user) else None),
    )
    session.add(prod)
    try:
        await session.commit()
    except Exception as e:  # IntegrityError по UNIQUE gitlab_group
        await session.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Не удалось создать продукт: {e}",
        ) from e
    await session.refresh(prod)
    return await _to_public(session, prod, current_user.id)


@router.get("/{product_id}", response_model=ProductPublic)
async def get_product(product_id: int, session: SessionDep, current_user: CurrentUser):
    prod = await _load_product_for(session, product_id, current_user)
    return await _to_public(session, prod, current_user.id)


@router.patch("/{product_id}", response_model=ProductPublic)
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    prod = await _load_product_for(session, product_id, current_user)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(prod, k, v)
    await session.commit()
    return await _to_public(session, prod, current_user.id)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product(product_id: int, session: SessionDep, current_user: MutatorUser):
    """Удаляет Product и каскадом все его product_members, product_competencies,
    Project'ы (тоже каскадом). PR-ы не каскадятся (FK SET NULL).
    """
    prod = await _load_product_for(session, product_id, current_user)
    await session.delete(prod)
    await session.commit()


# ----- members -----------------------------------------------------------


@router.post("/{product_id}/members", response_model=ProductMemberPublic)
async def add_member(
    product_id: int,
    payload: ProductMemberAdd,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _load_product_for(session, product_id, current_user)
    eq = await session.execute(select(Employee).where(Employee.id == payload.employee_id))
    if eq.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    dup_q = await session.execute(
        select(ProductMember).where(
            ProductMember.product_id == product_id,
            ProductMember.employee_id == payload.employee_id,
        )
    )
    if dup_q.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Сотрудник уже в продукте")
    member = ProductMember(
        product_id=product_id,
        employee_id=payload.employee_id,
        role_in_project=payload.role_in_project,
        joined_at=payload.joined_at,
    )
    session.add(member)
    await session.commit()
    await session.refresh(member)
    publics = await _build_member_publics(
        session, product_id, current_user.id, only_member_ids=[member.id]
    )
    return publics[0]


@router.patch(
    "/{product_id}/members/{member_id}",
    response_model=ProductMemberPublic,
)
async def update_member(
    product_id: int,
    member_id: int,
    payload: ProductMemberUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    mq = await session.execute(
        select(ProductMember).where(
            ProductMember.id == member_id, ProductMember.product_id == product_id
        )
    )
    member = mq.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Участник не найден")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(member, k, v)
    await session.commit()
    publics = await _build_member_publics(
        session, product_id, current_user.id, only_member_ids=[member.id]
    )
    return publics[0]


@router.delete(
    "/{product_id}/members/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_member(
    product_id: int,
    member_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    mq = await session.execute(
        select(ProductMember).where(
            ProductMember.id == member_id, ProductMember.product_id == product_id
        )
    )
    member = mq.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Участник не найден")
    await session.delete(member)
    await session.commit()


@router.put(
    "/{product_id}/members/{member_id}/rotation-lock",
    response_model=ProductMemberPublic,
)
async def lock_member_rotation(
    product_id: int,
    member_id: int,
    payload: MemberLockBody,
    session: SessionDep,
    current_user: MutatorUser,
):
    mq = await session.execute(
        select(ProductMember).where(
            ProductMember.id == member_id, ProductMember.product_id == product_id
        )
    )
    member = mq.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Участник не найден")
    member.rotation_locked = True
    member.rotation_lock_note = (payload.note or "").strip() or None
    await session.commit()
    publics = await _build_member_publics(
        session, product_id, current_user.id, only_member_ids=[member.id]
    )
    return publics[0]


@router.delete(
    "/{product_id}/members/{member_id}/rotation-lock",
    response_model=ProductMemberPublic,
)
async def unlock_member_rotation(
    product_id: int,
    member_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    mq = await session.execute(
        select(ProductMember).where(
            ProductMember.id == member_id, ProductMember.product_id == product_id
        )
    )
    member = mq.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Участник не найден")
    member.rotation_locked = False
    member.rotation_lock_note = None
    await session.commit()
    publics = await _build_member_publics(
        session, product_id, current_user.id, only_member_ids=[member.id]
    )
    return publics[0]


# ----- stack (competencies) ----------------------------------------------


@router.put(
    "/{product_id}/stack",
    response_model=list[ProductCompetencyPublic],
)
async def set_stack(
    product_id: int,
    payload: ProductStackBulkUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    """Полная замена тех. стека продукта."""
    await _load_product_for(session, product_id, current_user)
    # удаляем всё текущее
    cur_q = await session.execute(
        select(ProductCompetency).where(ProductCompetency.product_id == product_id)
    )
    for pc in cur_q.scalars():
        await session.delete(pc)
    await session.flush()
    seen: set[int] = set()
    for item in payload.items:
        if item.competency_id in seen:
            continue
        seen.add(item.competency_id)
        session.add(
            ProductCompetency(
                product_id=product_id,
                competency_id=item.competency_id,
                target_level=item.target_level,
            )
        )
    await session.commit()
    return await _build_competency_publics(session, product_id)


# ----- aggregates: matrix / coverage / grade-distribution ---------------


async def _latest_levels_by_employee(
    session, employee_ids: list[int]
) -> dict[tuple[int, int], int]:
    """{(employee_id, competency_id): latest level} из последних оценок."""
    if not employee_ids:
        return {}
    q = await session.execute(
        select(
            Assessment.employee_id,
            AssessmentScore.competency_id,
            AssessmentScore.level,
        )
        .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
        .where(Assessment.employee_id.in_(employee_ids))
        .order_by(
            Assessment.employee_id,
            AssessmentScore.competency_id,
            Assessment.assessed_at.desc(),
            Assessment.id.desc(),
        )
        .distinct(Assessment.employee_id, AssessmentScore.competency_id)
    )
    return {(eid, cid): lvl for eid, cid, lvl in q.all()}


async def _product_member_employee_ids(session, product_id: int) -> list[int]:
    q = await session.execute(
        select(ProductMember.employee_id).where(ProductMember.product_id == product_id)
    )
    return [eid for (eid,) in q.all()]


@router.get("/{product_id}/matrix", response_model=ProjectMatrix)
async def get_matrix(
    product_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    only_stack: bool = True,
):
    """Матрица участники × компетенции с уровнями оценок.

    only_stack=true (default) — только компетенции из стека продукта.
    only_stack=false — все компетенции МПК.
    """
    await _load_product_for(session, product_id, current_user)
    emp_ids = await _product_member_employee_ids(session, product_id)
    if not emp_ids:
        return ProjectMatrix(employees=[], competencies=[], cells=[])

    eq = await session.execute(
        select(Employee)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .where(Employee.id.in_(emp_ids))
    )
    employees = list(eq.scalars())
    employees.sort(key=lambda e: e.full_name)
    emp_refs = [
        MatrixEmployeeRef(
            employee_id=e.id,
            full_name=e.full_name,
            role_name=e.role.name if e.role else None,
            grade_code=e.grade.code if e.grade else None,
        )
        for e in employees
    ]

    pcq = await session.execute(
        select(ProductCompetency).where(ProductCompetency.product_id == product_id)
    )
    stack = list(pcq.scalars())
    target_by_comp: dict[int, int] = {pc.competency_id: pc.target_level for pc in stack}
    if only_stack and target_by_comp:
        comp_ids = list(target_by_comp.keys())
    else:
        comp_q = await session.execute(select(Competency.id))
        comp_ids = [cid for (cid,) in comp_q.all()]

    cq = await session.execute(
        select(Competency)
        .where(Competency.id.in_(comp_ids))
        .order_by(Competency.sort_order, Competency.id)
    )
    comps = list(cq.scalars())
    comp_refs = [
        MatrixCompetencyRef(
            competency_id=c.id,
            competency_name=c.name,
            target_level=target_by_comp.get(c.id),
        )
        for c in comps
    ]

    levels = await _latest_levels_by_employee(session, emp_ids)
    cells: list[MatrixCell] = []
    for e in employees:
        for c in comps:
            cells.append(
                MatrixCell(
                    employee_id=e.id,
                    competency_id=c.id,
                    level=levels.get((e.id, c.id)),
                )
            )

    return ProjectMatrix(employees=emp_refs, competencies=comp_refs, cells=cells)


@router.get("/{product_id}/coverage", response_model=ProjectCoverage)
async def get_coverage(product_id: int, session: SessionDep, current_user: CurrentUser):
    """Покрытие тех.стека командой продукта (агрегат по всем его репо).

    Логика та же, что и у /projects/{id}/coverage — в знаменателе только
    участники, для роли которых компетенция:
      • required по role_profile (required_level > 0)
      • И ★-ключевая для роли (role_key_competencies).
    """
    await _load_product_for(session, product_id, current_user)
    pcq = await session.execute(
        select(ProductCompetency).where(ProductCompetency.product_id == product_id)
    )
    stack = list(pcq.scalars())
    emp_ids = await _product_member_employee_ids(session, product_id)
    if not stack or not emp_ids:
        return ProjectCoverage(items=[], risk_score=0)

    levels = await _latest_levels_by_employee(session, emp_ids)

    eq = await session.execute(
        select(Employee.id, Employee.role_id, Employee.grade_id).where(Employee.id.in_(emp_ids))
    )
    emp_role: dict[int, tuple[int | None, int | None]] = {
        eid: (rid, gid) for eid, rid, gid in eq.all()
    }

    rg_pairs = {(rid, gid) for rid, gid in emp_role.values() if rid and gid}
    required_map: dict[tuple[int, int, int], int] = {}
    if rg_pairs:
        conditions = [
            and_(RoleProfile.role_id == rid, RoleProfile.grade_id == gid) for rid, gid in rg_pairs
        ]
        rp_q = await session.execute(select(RoleProfile).where(or_(*conditions)))
        for rp in rp_q.scalars():
            if rp.required_level > 0:
                required_map[(rp.role_id, rp.grade_id, rp.competency_id)] = rp.required_level

    role_ids = {rid for rid, _ in emp_role.values() if rid}
    key_set: set[tuple[int, int]] = set()
    if role_ids:
        kq = await session.execute(
            select(
                role_key_competencies.c.role_id,
                role_key_competencies.c.competency_id,
            ).where(role_key_competencies.c.role_id.in_(role_ids))
        )
        key_set = {(rid, cid) for rid, cid in kq.all()}

    cq = await session.execute(
        select(Competency).where(Competency.id.in_([pc.competency_id for pc in stack]))
    )
    name_by_id = {c.id: c.name for c in cq.scalars()}

    items: list[CoverageItem] = []
    risk_score = 0.0
    for pc in stack:
        relevant_ids: list[int] = []
        for eid in emp_ids:
            rid, gid = emp_role.get(eid, (None, None))
            if rid is None or gid is None:
                continue
            if (rid, gid, pc.competency_id) not in required_map:
                continue
            if (rid, pc.competency_id) not in key_set:
                continue
            relevant_ids.append(eid)

        relevant_levels = [levels.get((eid, pc.competency_id)) for eid in relevant_ids]
        assessed = [lvl for lvl in relevant_levels if lvl is not None]
        meeting = sum(1 for lvl in assessed if lvl >= pc.target_level)
        below = sum(1 for lvl in assessed if lvl < pc.target_level)
        avg = round(sum(assessed) / len(assessed), 2) if assessed else None
        items.append(
            CoverageItem(
                competency_id=pc.competency_id,
                competency_name=name_by_id.get(pc.competency_id, f"#{pc.competency_id}"),
                target_level=pc.target_level,
                members_total=len(relevant_ids),
                members_assessed=len(assessed),
                members_meeting=meeting,
                members_below=below,
                avg_level=avg,
            )
        )
        if avg is not None and avg < pc.target_level:
            risk_score += pc.target_level - avg
    items.sort(key=lambda x: (-(x.target_level - (x.avg_level or 0)), x.competency_name))
    return ProjectCoverage(items=items, risk_score=round(risk_score))


@router.get(
    "/{product_id}/grade-distribution",
    response_model=ProjectGradeDistribution,
)
async def get_grade_distribution(product_id: int, session: SessionDep, current_user: CurrentUser):
    await _load_product_for(session, product_id, current_user)
    emp_ids = await _product_member_employee_ids(session, product_id)
    if not emp_ids:
        return ProjectGradeDistribution(items=[], no_grade=0)

    eq = await session.execute(select(Employee.grade_id).where(Employee.id.in_(emp_ids)))
    grade_counts: dict[int, int] = {}
    no_grade = 0
    for (gid,) in eq.all():
        if gid is None:
            no_grade += 1
        else:
            grade_counts[gid] = grade_counts.get(gid, 0) + 1

    items = []
    if grade_counts:
        gq = await session.execute(select(Grade).where(Grade.id.in_(grade_counts.keys())))
        grades = list(gq.scalars())
        items = [
            GradeCount(
                grade_code=g.code,
                sort_order=g.sort_order,
                count=grade_counts[g.id],
            )
            for g in grades
        ]
        items.sort(key=lambda x: x.sort_order)
    return ProjectGradeDistribution(items=items, no_grade=no_grade)


# ----- rotations --------------------------------------------------------


@router.get("/{product_id}/rotations", response_model=RotationsPanel)
async def get_product_rotations(
    product_id: int,
    session: SessionDep,
    _current_user: CurrentUser,
):
    """Кандидаты на ротацию из этого продукта + готовые AI-обоснования.

    Упрощённая логика по сравнению с /projects/{id}/rotations: не считает
    «нужна ли замена» (replacement_needed) и не показывает activeAIJob —
    эти поля будут возвращены в этапе 5 после полного переезда логики
    suggestions на product_id.
    """
    prod = await session.get(Product, product_id)
    if prod is None:
        raise HTTPException(status_code=404, detail="Продукт не найден")

    candidates = await compute_candidates_for_product(session, product_id)
    if not candidates:
        return RotationsPanel(candidates=[], no_candidates=True)

    emp_ids = [c.employee_id for c in candidates]
    owner_ids = {c.owner_id for c in candidates}
    owner_name_by_id: dict[int, str] = {}
    if owner_ids:
        uq = await session.execute(select(User.id, User.full_name).where(User.id.in_(owner_ids)))
        owner_name_by_id = {uid: name for uid, name in uq.all()}

    sq = await session.execute(
        select(RotationSuggestion).where(
            RotationSuggestion.from_product_id == product_id,
            RotationSuggestion.employee_id.in_(emp_ids),
        )
    )
    sug_by_emp: dict[int, RotationSuggestion] = {s.employee_id: s for s in sq.scalars()}

    # имена целевых продуктов
    target_ids: set[int] = set()
    for s in sug_by_emp.values():
        for tid in s.target_product_ids or []:
            target_ids.add(tid)
    target_info: dict[int, str] = {}
    if target_ids:
        tq = await session.execute(
            select(Product.id, Product.name).where(Product.id.in_(target_ids))
        )
        target_info = {pid: name for pid, name in tq.all()}

    items: list[RotationCandidatePublic] = []
    for c in candidates:
        suggestion = sug_by_emp.get(c.employee_id)
        targets = []
        if suggestion:
            for tid in suggestion.target_product_ids or []:
                name = target_info.get(tid)
                if name is None:
                    continue
                # схема rotation использует ключ project_id — переиспользуем
                # её как «id-цели» (на следующем этапе переименуем).
                targets.append({"project_id": tid, "project_name": name, "code": None})

        items.append(
            RotationCandidatePublic(
                employee_id=c.employee_id,
                member_id=c.member_id,
                full_name=c.full_name,
                role_id=c.role_id,
                role_name=c.role_name,
                grade_id=c.grade_id,
                grade_code=c.grade_code,
                owner_id=c.owner_id,
                owner_name=owner_name_by_id.get(c.owner_id),
                joined_at=c.joined_at,
                tenure_months=c.tenure_months,
                rotation_locked=c.rotation_locked,
                rotation_lock_note=c.rotation_lock_note,
                pending_rotation_id=c.pending_rotation_id,
                tenure_score=c.tenure_score,
                bus_factor_score=c.bus_factor_score,
                score=c.score,
                bus_factor_competencies=[
                    {"competency_id": cid, "competency_name": name}
                    for cid, name in c.bus_factor_competencies
                ],
                rationale_md=s.rationale_md if s else None,
                target_projects=targets,
                suggestion_generated_at=s.generated_at if s else None,
                suggestion_running=False,
                replacement_needed=False,
                replacement_project_name=prod.name,
                replacement_role_keys_in_stack=[],
            )
        )

    return RotationsPanel(candidates=items, no_candidates=False)


# ----- CodeBuddy aggregates ---------------------------------------------


def _codebuddy_error_to_http(e: CodeBuddyAPIError) -> HTTPException:
    code = e.status_code or 502
    http_code = 429 if code == 429 else 502
    return HTTPException(status_code=http_code, detail=f"CodeBuddy: {e}")


def _resolve_period(from_date: date | None, to_date: date | None) -> tuple[date, date]:
    """По умолчанию — последние 90 дней."""
    to_d = to_date or date.today()
    from_d = from_date or (to_d - timedelta(days=90))
    if from_d > to_d:
        from_d = to_d - timedelta(days=90)
    return from_d, to_d


async def _load_product_members_for_codebuddy(
    session, product_id: int
) -> tuple[list[Employee], list[Project]]:
    """Активные члены + репо продукта с непустым gitlab_project_id.

    role/grade подгружаются сразу (selectinload) — performance-расчёт
    обращается к ним вне async-сессии.
    """
    mq = await session.execute(
        select(Employee)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .join(ProductMember, ProductMember.employee_id == Employee.id)
        .where(
            ProductMember.product_id == product_id,
            ProductMember.left_at.is_(None),
        )
    )
    members = list(mq.scalars())
    rq = await session.execute(
        select(Project).where(
            Project.product_id == product_id,
            Project.gitlab_project_id.is_not(None),
        )
    )
    repos = list(rq.scalars())
    return members, repos


@router.get(
    "/{product_id}/pull-requests",
    response_model=list[PullRequestPublic],
)
async def list_product_pull_requests(
    product_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = 50,
    from_date: date | None = None,
    to_date: date | None = None,
):
    """PR-ы по всем репо продукта от его участников.

    Только PR-ы из репо, принадлежащих этому продукту (фильтр по
    gitlab_project_id). По дате DESC.
    """
    await _load_product_for(session, product_id, current_user)
    if not await is_codebuddy_live(session):
        return []
    period_from, period_to = _resolve_period(from_date, to_date)
    members, repos = await _load_product_members_for_codebuddy(session, product_id)
    if not members or not repos:
        return []
    pids: set[int] = {p.gitlab_project_id for p in repos if p.gitlab_project_id}

    async def _one(emp: Employee):
        try:
            prs = await codebuddy_service.get_pull_requests(emp, period_from, period_to, limit=200)
        except CodeBuddyAPIError as e:
            logger.warning("product/%s PR fetch for emp #%s: %s", product_id, emp.id, e)
            return []
        # Проставляем автора — codebuddy_service не знает employee.
        for p in prs:
            p.author_employee_id = emp.id
            p.author_full_name = emp.full_name
        return prs

    batches = await asyncio.gather(*[_one(m) for m in members])

    # Read-hook: материализуем Project + ProductMember из уже полученных PR.
    # Открытие карточки продукта обновляет команду/проекты без ручного обхода
    # dev-метрик сотрудников. PR-ы уже выгружены (и закэшированы в Redis) —
    # доп. запросов в CodeBuddy нет. Идемпотентно; сбой синка не валит чтение.
    try:
        for emp, batch in zip(members, batches):
            seen = [
                (p.project_id, p.project_name, p.created_at_ext, p.url)
                for p in batch
                if p.project_id
            ]
            if seen:
                await sync_projects_from_codebuddy(session, emp, seen)
    except Exception:  # noqa: BLE001 — синк не должен ронять выдачу PR-ов
        await session.rollback()

    out: list[PullRequestPublic] = []
    for batch in batches:
        for p in batch:
            if p.project_id and p.project_id in pids:
                out.append(p)
    out.sort(key=lambda p: p.created_at_ext, reverse=True)
    return out[: max(1, min(limit, 500))]


@router.get(
    "/{product_id}/dev-metrics",
    response_model=DevMetricsSnapshotPublic | None,
)
async def get_product_dev_metrics(
    product_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    from_date: date | None = None,
    to_date: date | None = None,
):
    """Агрегированные dev-метрики команды продукта.

    Берём snapshot CodeBuddy по каждому члену и суммируем. Замечание:
    CodeBuddy не фильтрует /developers/{username} по projectId, поэтому
    итог включает и работу членов в других продуктах. Для строго-точного
    среза по репо смотрите /products/{id}/pull-requests.
    """
    await _load_product_for(session, product_id, current_user)
    if not await is_codebuddy_live(session):
        return None
    period_from, period_to = _resolve_period(from_date, to_date)
    members, _ = await _load_product_members_for_codebuddy(session, product_id)
    if not members:
        return None

    async def _one(emp: Employee):
        try:
            return await codebuddy_service.get_dev_metrics(emp, period_from, period_to)
        except CodeBuddyAPIError as e:
            logger.warning("product/%s snapshot for emp #%s: %s", product_id, emp.id, e)
            return None

    snaps = [s for s in await asyncio.gather(*[_one(m) for m in members]) if s]
    if not snaps:
        return None

    # Суммируем «прямые» поля; средние — weighted by total_mrs.
    total_mrs = sum(s.total_mrs for s in snaps)
    total_commits = sum(s.total_commits for s in snaps)
    if total_mrs == 0:
        return None
    qratio_w = sum(s.avg_quality_ratio * max(1, s.total_mrs) for s in snaps)
    iters_w = sum(s.avg_iterations * max(1, s.total_mrs) for s in snaps)
    ttm_values = [s.avg_time_to_merge_hours for s in snaps if s.avg_time_to_merge_hours]
    return DevMetricsSnapshotPublic(
        period_start=period_from,
        period_end=period_to,
        total_commits=total_commits,
        total_mrs=total_mrs,
        lines_added=sum(s.lines_added for s in snaps),
        lines_removed=sum(s.lines_removed for s in snaps),
        mr_size_xs=sum(s.mr_size_xs for s in snaps),
        mr_size_s=sum(s.mr_size_s for s in snaps),
        mr_size_m=sum(s.mr_size_m for s in snaps),
        mr_size_l=sum(s.mr_size_l for s in snaps),
        mr_size_xl=sum(s.mr_size_xl for s in snaps),
        mr_with_tests=sum(s.mr_with_tests for s in snaps),
        mr_with_description=sum(s.mr_with_description for s in snaps),
        mr_with_review_discussion=sum(s.mr_with_review_discussion for s in snaps),
        avg_iterations=round(iters_w / total_mrs, 2),
        avg_time_to_merge_hours=(
            round(sum(ttm_values) / len(ttm_values), 1) if ttm_values else None
        ),
        avg_quality_ratio=round(qratio_w / total_mrs, 4),
        comments_given=sum(s.comments_given for s in snaps),
        comments_received=sum(s.comments_received for s in snaps),
        ai_comments_received=sum(s.ai_comments_received for s in snaps),
        wip_count=sum(s.wip_count for s in snaps),
        stale_count=sum(s.stale_count for s in snaps),
        wip_mrs=[w for s in snaps for w in s.wip_mrs],
        stale_threshold_days=next(
            (s.stale_threshold_days for s in snaps if s.stale_threshold_days), None
        ),
        quality_breakdown=None,
    )


@router.get(
    "/{product_id}/competencies/{competency_id}/prs",
    response_model=list[PullRequestPublic],
)
async def get_product_competency_prs(
    product_id: int,
    competency_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    from_date: date | None = None,
    to_date: date | None = None,
):
    """PR-ы продукта, проявившие конкретную компетенцию.

    Подход: для каждой пары `(employee, repo)` дёргаем `/competencies?projectId=`
    точно как при сборке агрегата extracted-competencies, собираем signals
    по этому competency_id, и оставляем PR-ы этого репо у этого employee,
    где `feature_keys` пересекаются с signals (см. `_signal_matches_feature_key`).
    """
    await _load_product_for(session, product_id, current_user)
    if not await is_codebuddy_live(session):
        return []
    period_from, period_to = _resolve_period(from_date, to_date)
    members, repos = await _load_product_members_for_codebuddy(session, product_id)
    if not members or not repos:
        return []
    pids = {p.gitlab_project_id for p in repos if p.gitlab_project_id}

    # Catalog нужен для resolution categorical/language signals → set(featureKey).
    try:
        catalog = await codebuddy_service.get_feature_catalog()
    except CodeBuddyAPIError as e:
        logger.warning("comp/prs: feature-catalog: %s", e)
        catalog = {"features": []}
    catalog_idx = build_catalog_index(catalog)

    async def _signals_for_emp(emp: Employee) -> list[tuple[str, str]]:
        """[(signal_name, signal_type), ...] для competency_id у этого employee."""
        out: list[tuple[str, str]] = []
        seen: set[tuple[str, str]] = set()
        for repo in repos:
            if repo.gitlab_project_id is None:
                continue
            try:
                resp = await codebuddy_service.get_project_extracted_competencies(
                    repo, [emp], period_from, period_to
                )
            except CodeBuddyAPIError as e:
                logger.warning(
                    "comp/prs: /competencies repo=%s emp=%s: %s",
                    repo.id,
                    emp.id,
                    e,
                )
                continue
            for it in resp.items:
                if it.competency_id != competency_id:
                    continue
                for s in it.top_signals or []:
                    if not s.signal:
                        continue
                    key = (s.signal, s.signal_type)
                    if key in seen:
                        continue
                    seen.add(key)
                    out.append(key)
        return out

    async def _one(emp: Employee) -> list[PullRequestPublic]:
        signals = await _signals_for_emp(emp)
        if not signals:
            return []
        try:
            prs = await codebuddy_service.get_pull_requests(emp, period_from, period_to, limit=200)
        except CodeBuddyAPIError as e:
            logger.warning("comp/prs: /mrs for emp %s: %s", emp.id, e)
            return []

        # Если все signals — comment_category, CodeBuddy не даёт связи
        # comment↔PR. Возвращаем пусто, UI покажет соответствующее сообщение.
        feature_signals = [s for s in signals if s[1] != "comment_category"]
        if not feature_signals:
            return []

        matched: list[PullRequestPublic] = []
        for p in prs:
            if p.project_id not in pids:
                continue
            if not p.feature_keys:
                continue
            if pr_matches_signals(p.feature_keys, feature_signals, catalog_idx):
                p.author_employee_id = emp.id
                p.author_full_name = emp.full_name
                matched.append(p)
        logger.info(
            "comp/prs: emp #%s cid=%s signals=%d feat=%d → matched=%d / total=%d",
            emp.id,
            competency_id,
            len(signals),
            len(feature_signals),
            len(matched),
            len(prs),
        )
        return matched

    batches = await asyncio.gather(*[_one(m) for m in members])
    out: list[PullRequestPublic] = []
    for batch in batches:
        out.extend(batch)
    out.sort(key=lambda p: p.created_at_ext, reverse=True)
    return out


@router.get(
    "/{product_id}/extracted-competencies",
    response_model=ProjectExtractedCompetenciesResponse,
)
async def get_product_extracted_competencies(
    product_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    from_date: date | None = None,
    to_date: date | None = None,
):
    """Агрегат extracted-компетенций по продукту: дёргаем
    /competencies?projectId=<repo> для каждой пары (member, repo) и
    объединяем по competency_id.
    """
    prod = await _load_product_for(session, product_id, current_user)
    if not await is_codebuddy_live(session):
        return ProjectExtractedCompetenciesResponse(
            items=[], total_team=0, period_start=None, period_end=None
        )
    period_from, period_to = _resolve_period(from_date, to_date)
    members, repos = await _load_product_members_for_codebuddy(session, product_id)
    if not members:
        return ProjectExtractedCompetenciesResponse(
            items=[], total_team=0, period_start=period_from, period_end=period_to
        )

    # Один Project-«представитель» создаём виртуально для каждого репо, чтобы
    # передать в существующий codebuddy_service.get_project_extracted_competencies.
    if not repos:
        # Без репо — без фильтра projectId. Используем product как proxy.
        try:
            placeholder = Project(name=prod.name, status="active", created_by=prod.created_by)
            placeholder.gitlab_project_id = None
            resp = await codebuddy_service.get_project_extracted_competencies(
                placeholder, members, period_from, period_to
            )
        except CodeBuddyAPIError as e:
            raise _codebuddy_error_to_http(e) from e
        return resp

    # Если репо несколько — собираем итоговый агрегат сами.
    merged: dict[int, ProjectExtractedCompetencyItem] = {}
    for repo in repos:
        try:
            partial = await codebuddy_service.get_project_extracted_competencies(
                repo, members, period_from, period_to
            )
        except CodeBuddyAPIError as e:
            logger.warning("product %s repo %s competencies: %s", product_id, repo.id, e)
            continue
        for it in partial.items:
            cur = merged.get(it.competency_id)
            if cur is None:
                merged[it.competency_id] = it
                continue
            # Объединяем: сливаем employees (UNIQUE по employee_id),
            # суммируем total_frequency, employees_with = len(unique).
            existing_emp_ids = {e.employee_id for e in cur.employees}
            for emp_c in it.employees:
                if emp_c.employee_id in existing_emp_ids:
                    # дублирующийся вклад этого сотрудника по другому репо —
                    # просто суммируем frequency
                    for existing in cur.employees:
                        if existing.employee_id == emp_c.employee_id:
                            existing.frequency += emp_c.frequency
                            break
                else:
                    cur.employees.append(emp_c)
                    existing_emp_ids.add(emp_c.employee_id)
            cur.employees_with = len(cur.employees)
            cur.total_frequency += it.total_frequency

    items = sorted(
        merged.values(),
        key=lambda x: (-x.employees_with, -x.total_frequency),
    )
    for it in items:
        it.employees.sort(key=lambda e: -e.frequency)

    return ProjectExtractedCompetenciesResponse(
        items=items,
        total_team=len(members),
        period_start=period_from,
        period_end=period_to,
    )


# ----- performance-аналитика --------------------------------------------


async def build_product_performance(
    session, product_id: int, access_user, period_days: int = 90
) -> ProductPerformanceResponse:
    """Собрать performance-аналитику продукта. Используется и route'ом, и
    ARQ-задачей AI-обзора. `access_user` нужен для расчёта coverage."""
    period_days = max(7, min(period_days, 365))
    period_to = date.today()
    period_from = period_to - timedelta(days=period_days)
    prev_from = period_from - timedelta(days=period_days)

    members, repos = await _load_product_members_for_codebuddy(session, product_id)
    team_size = len(members)

    if not await is_codebuddy_live(session) or not members or not repos:
        empty_health = build_health([], 0.0, 0, team_size)
        return ProductPerformanceResponse(
            enabled=await is_codebuddy_live(session),
            period_from=period_from,
            period_to=period_to,
            health=empty_health,
            developers=[],
            signals=[],
        )

    repo_pids = {p.gitlab_project_id for p in repos if p.gitlab_project_id}

    raw_now, raw_prev = await asyncio.gather(
        gather_raw_devs(members, repo_pids, period_from, period_to),
        gather_raw_devs(members, repo_pids, prev_from, period_from),
    )

    coverage_gaps: list[tuple[str, int, float | None]] = []
    try:
        cov = await get_coverage(product_id, session, access_user)
        coverage_gap = float(cov.risk_score)
        for it in cov.items:
            if it.avg_level is None or it.avg_level < it.target_level:
                coverage_gaps.append((it.competency_name, it.target_level, it.avg_level))
    except Exception:  # noqa: BLE001
        coverage_gap = 0.0

    # bus-factor с конкретными ★-компетенциями для evidence.
    bus_factor_detail: list[tuple[int, str, list[str]]] = []
    try:
        cands = await compute_candidates_for_product(session, product_id)
        for c in cands:
            if c.bus_factor_score > 0:
                comp_names = [name for _cid, name in c.bus_factor_competencies]
                bus_factor_detail.append((c.employee_id, c.full_name, comp_names))
    except Exception as e:  # noqa: BLE001
        logger.warning("perf: bus-factor calc failed: %s", e)
    bus_factor_count = len(bus_factor_detail)

    prev_aggs, prev_scores = aggregate_for_deltas(raw_prev)
    developers = build_developers(raw_now, prev_aggs, prev_scores)

    prev_health = build_health(raw_prev, coverage_gap, bus_factor_count, team_size)
    health = build_health(
        raw_now,
        coverage_gap,
        bus_factor_count,
        team_size,
        prev_total_prs=prev_health.total_prs,
        prev_avg_quality=prev_health.avg_quality,
    )
    signals = build_signals(developers, health, raw_now, bus_factor_detail, coverage_gaps)

    return ProductPerformanceResponse(
        enabled=True,
        period_from=period_from,
        period_to=period_to,
        health=health,
        developers=developers,
        signals=signals,
    )


@router.get(
    "/{product_id}/performance",
    response_model=ProductPerformanceResponse,
)
async def get_product_performance(
    product_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    period_days: int = 90,
):
    """Performance-аналитика продукта: рейтинг разработчиков, здоровье,
    эвристические сигналы. Сравнение с предыдущим окном того же размера.
    """
    await _load_product_for(session, product_id, current_user)
    return await build_product_performance(session, product_id, current_user, period_days)


@router.get(
    "/{product_id}/performance/trends",
    response_model=ProductTrendsResponse,
)
async def get_product_performance_trends(
    product_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    buckets: int = 6,
    bucket_days: int = 30,
):
    """Динамика метрик продукта по временным окнам (для графиков).

    buckets окон по bucket_days дней, от старого к новому. На каждое окно
    считаются объём PR / merged / quality / тесты / зависшие.
    """
    await _load_product_for(session, product_id, current_user)
    buckets = max(2, min(buckets, 12))
    bucket_days = max(7, min(bucket_days, 90))

    members, repos = await _load_product_members_for_codebuddy(session, product_id)
    if not await is_codebuddy_live(session) or not members or not repos:
        return ProductTrendsResponse(
            enabled=await is_codebuddy_live(session),
            bucket_days=bucket_days,
            buckets=[],
        )
    repo_pids = {p.gitlab_project_id for p in repos if p.gitlab_project_id}
    today = date.today()

    # Окна: i=buckets-1 — самое старое, i=0 — текущее.
    windows = [
        (
            today - timedelta(days=bucket_days * (i + 1)),
            today - timedelta(days=bucket_days * i),
        )
        for i in range(buckets - 1, -1, -1)
    ]
    prs_per_window = await asyncio.gather(
        *[gather_prs_only(members, repo_pids, wf, wt) for wf, wt in windows]
    )

    out: list[TrendBucket] = []
    for (wf, wt), prs in zip(windows, prs_per_window):
        n = len(prs)
        merged = sum(1 for p in prs if p.state == "merged")
        avg_q = round(sum(p.quality_ratio for p in prs) / n, 4) if n else None
        with_tests = (
            round(
                sum(1 for p in prs if (p.signals or {}).get("has_tests")) / n,
                4,
            )
            if n
            else None
        )
        # «зависшие» = open PR старше 14 дней на конец окна.
        stale_cutoff = datetime.combine(wt - timedelta(days=14), datetime.min.time(), tzinfo=UTC)
        stale_open = sum(1 for p in prs if p.state == "open" and p.created_at_ext < stale_cutoff)
        out.append(
            TrendBucket(
                period_from=wf,
                period_to=wt,
                total_prs=n,
                prs_merged=merged,
                avg_quality=avg_q,
                with_tests_pct=with_tests,
                stale_open_count=stale_open,
            )
        )

    return ProductTrendsResponse(enabled=True, bucket_days=bucket_days, buckets=out)


async def _expire_stale_reviews(session, product_id: int) -> None:
    """queued/running AI-обзоры старше 10 минут → error('timeout').

    ARQ job_timeout = 5 мин; если запись висит дольше 10 — worker точно
    не довёл задачу (упал, перегружен, не знал функцию). Чтобы UI не
    крутил «генерация…» вечно — помечаем error.
    """
    cutoff = datetime.now(UTC) - timedelta(minutes=10)
    q = await session.execute(
        select(ProductPerformanceReview).where(
            ProductPerformanceReview.product_id == product_id,
            ProductPerformanceReview.status.in_(("queued", "running")),
            ProductPerformanceReview.created_at < cutoff,
        )
    )
    changed = False
    for rv in q.scalars():
        rv.status = "error"
        rv.error = (
            "Задача не завершилась за отведённое время — "
            "ARQ-worker недоступен или перегружен. Запустите заново."
        )
        rv.finished_at = datetime.now(UTC)
        changed = True
    if changed:
        await session.commit()


@router.get(
    "/{product_id}/performance/ai-review",
    response_model=PerformanceReviewPublic | None,
)
async def get_performance_ai_review(
    product_id: int, session: SessionDep, current_user: CurrentUser
):
    """Последний AI-обзор performance продукта (или null, если ещё не было)."""
    await _load_product_for(session, product_id, current_user)
    await _expire_stale_reviews(session, product_id)
    q = await session.execute(
        select(ProductPerformanceReview)
        .where(ProductPerformanceReview.product_id == product_id)
        .order_by(ProductPerformanceReview.created_at.desc())
        .limit(1)
    )
    rv = q.scalar_one_or_none()
    return PerformanceReviewPublic.model_validate(rv) if rv else None


@router.post(
    "/{product_id}/performance/ai-review",
    response_model=PerformanceReviewPublic,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_performance_ai_review(
    product_id: int, session: SessionDep, current_user: MutatorUser
):
    """Запустить AI-разбор performance продукта (в фоне через ARQ)."""
    await _load_product_for(session, product_id, current_user)
    if not await is_codebuddy_live(session):
        raise HTTPException(
            status_code=400,
            detail="CodeBuddy выключен — performance-данных нет",
        )
    # Сначала гасим протухшие — иначе осиротевший queued заблокирует новый.
    await _expire_stale_reviews(session, product_id)
    # Не плодим параллельные разборы.
    running_q = await session.execute(
        select(ProductPerformanceReview).where(
            ProductPerformanceReview.product_id == product_id,
            ProductPerformanceReview.status.in_(("queued", "running")),
        )
    )
    existing = running_q.scalar_one_or_none()
    if existing is not None:
        return PerformanceReviewPublic.model_validate(existing)

    rv = ProductPerformanceReview(
        product_id=product_id,
        status="queued",
        created_by=current_user.id,
    )
    session.add(rv)
    await session.commit()
    await session.refresh(rv)

    try:
        pool = get_arq_pool()
        await pool.enqueue_job("run_product_performance_review", rv.id)
    except Exception as e:  # noqa: BLE001
        rv.status = "error"
        rv.error = f"Не удалось поставить задачу: {e}"
        await session.commit()
        raise HTTPException(status_code=503, detail=f"Очередь недоступна: {e}") from e

    return PerformanceReviewPublic.model_validate(rv)
