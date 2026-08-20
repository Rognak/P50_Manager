from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

import asyncio
import logging
from datetime import date, timedelta

from app.admin.settings import is_codebuddy_live
from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    is_product_manager,
)
from app.codebuddy.client import CodeBuddyAPIError
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
    ProductMember,
    Project,
    ProjectCompetency,
    ProjectMember,
)
from app.models.user import User
from app.schemas.dev_metrics import PullRequestPublic
from app.schemas.project import (
    CoverageItem,
    GradeCount,
    MatrixCell,
    MatrixCompetencyRef,
    MatrixEmployeeRef,
    ProjectCompetencyPublic,
    ProjectCoverage,
    ProjectCreate,
    ProjectGradeDistribution,
    ProjectListItem,
    ProjectMatrix,
    ProjectMemberAdd,
    ProjectMemberPublic,
    ProjectMemberUpdate,
    ProjectPublic,
    ProjectStackBulkUpdate,
    ProjectUpdate,
)
from app.schemas.rotation import MemberLockBody

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/projects", tags=["projects"])


async def _load_project(session, project_id: int) -> Project:
    q = await session.execute(
        select(Project)
        .options(
            selectinload(Project.members),
            selectinload(Project.competencies),
        )
        .where(Project.id == project_id)
    )
    proj = q.scalar_one_or_none()
    if proj is None:
        raise HTTPException(status_code=404, detail="Проект не найден")
    return proj


def _can_access_project(user, proj: Project) -> bool:
    """Менеджер продукта видит только проекты, где он PM. Остальные — все."""
    if is_product_manager(user):
        return proj.product_manager_id == user.id
    return True


async def _load_project_for(session, project_id: int, current_user) -> Project:
    proj = await _load_project(session, project_id)
    if not _can_access_project(current_user, proj):
        raise HTTPException(status_code=404, detail="Проект не найден")
    return proj


async def _build_member_publics(
    session, members: list[ProjectMember], current_user_id: int
) -> list[ProjectMemberPublic]:
    if not members:
        return []
    emp_ids = [m.employee_id for m in members]
    eq = await session.execute(
        select(Employee, User.full_name)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .join(User, User.id == Employee.owner_id)
        .where(Employee.id.in_(emp_ids))
    )
    by_id: dict[int, tuple[Employee, str]] = {}
    for emp, owner_name in eq.all():
        by_id[emp.id] = (emp, owner_name)

    result: list[ProjectMemberPublic] = []
    for m in members:
        if m.employee_id not in by_id:
            continue
        emp, owner_name = by_id[m.employee_id]
        result.append(
            ProjectMemberPublic(
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
    return result


async def _build_competency_publics(
    session, comps: list[ProjectCompetency]
) -> list[ProjectCompetencyPublic]:
    if not comps:
        return []
    cq = await session.execute(
        select(Competency).where(Competency.id.in_([c.competency_id for c in comps]))
    )
    name_by_id = {c.id: c.name for c in cq.scalars()}
    result = []
    for pc in comps:
        result.append(
            ProjectCompetencyPublic(
                competency_id=pc.competency_id,
                competency_name=name_by_id.get(pc.competency_id, f"#{pc.competency_id}"),
                target_level=pc.target_level,
            )
        )
    # стабильная сортировка по имени
    result.sort(key=lambda x: x.competency_name)
    return result


async def _to_public(session, proj: Project, current_user_id: int) -> ProjectPublic:
    members = await _build_member_publics(session, proj.members, current_user_id)
    competencies = await _build_competency_publics(session, proj.competencies)
    return ProjectPublic(
        id=proj.id,
        code=proj.code,
        name=proj.name,
        description=proj.description,
        status=proj.status,
        started_at=proj.started_at,
        finished_at=proj.finished_at,
        created_by=proj.created_by,
        created_at=proj.created_at,
        members=members,
        competencies=competencies,
        gitlab_group=proj.gitlab_group,
        gitlab_project_id=proj.gitlab_project_id,
        product_id=proj.product_id,
    )


@router.get("", response_model=list[ProjectListItem])
async def list_projects(session: SessionDep, current_user: CurrentUser):
    stmt = (
        select(
            Project,
            func.count(ProjectMember.id).label("members_count"),
        )
        .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
        .group_by(Project.id)
        .order_by(Project.created_at.desc())
    )
    if is_product_manager(current_user):
        stmt = stmt.where(Project.product_manager_id == current_user.id)
    q = await session.execute(stmt)
    rows = q.all()
    result: list[ProjectListItem] = []
    if not rows:
        return result
    project_ids = [p.id for p, _ in rows]
    cc_q = await session.execute(
        select(ProjectCompetency.project_id, func.count())
        .where(ProjectCompetency.project_id.in_(project_ids))
        .group_by(ProjectCompetency.project_id)
    )
    comp_count = {pid: c for pid, c in cc_q.all()}
    for p, members_count in rows:
        result.append(
            ProjectListItem(
                id=p.id,
                code=p.code,
                name=p.name,
                status=p.status,
                started_at=p.started_at,
                finished_at=p.finished_at,
                members_count=members_count,
                competencies_count=comp_count.get(p.id, 0),
                created_by=p.created_by,
                gitlab_group=p.gitlab_group,
                gitlab_project_id=p.gitlab_project_id,
            )
        )
    return result


@router.post("", response_model=ProjectPublic, status_code=status.HTTP_201_CREATED)
async def create_project(payload: ProjectCreate, session: SessionDep, current_user: MutatorUser):
    proj = Project(
        code=payload.code,
        name=payload.name.strip(),
        description=payload.description,
        status=payload.status,
        started_at=payload.started_at,
        finished_at=payload.finished_at,
        created_by=current_user.id,
        # PM создаёт проект — автоматически становится его PM
        product_manager_id=(current_user.id if is_product_manager(current_user) else None),
    )
    session.add(proj)
    await session.commit()
    await session.refresh(proj, attribute_names=["members", "competencies"])
    return await _to_public(session, proj, current_user.id)


@router.get("/{project_id}", response_model=ProjectPublic)
async def get_project(project_id: int, session: SessionDep, current_user: CurrentUser):
    proj = await _load_project_for(session, project_id, current_user)
    return await _to_public(session, proj, current_user.id)


@router.patch("/{project_id}", response_model=ProjectPublic)
async def update_project(
    project_id: int,
    payload: ProjectUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    proj = await _load_project_for(session, project_id, current_user)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(proj, k, v)
    await session.commit()
    await session.refresh(proj, attribute_names=["members", "competencies"])
    return await _to_public(session, proj, current_user.id)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: int, session: SessionDep, current_user: MutatorUser):
    proj = await _load_project_for(session, project_id, current_user)
    await session.delete(proj)
    await session.commit()


@router.post("/{project_id}/members", response_model=ProjectMemberPublic)
async def add_member(
    project_id: int,
    payload: ProjectMemberAdd,
    session: SessionDep,
    current_user: MutatorUser,
):
    proj = await _load_project_for(session, project_id, current_user)
    eq = await session.execute(select(Employee).where(Employee.id == payload.employee_id))
    if eq.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    # дубликат
    dup_q = await session.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.employee_id == payload.employee_id,
        )
    )
    if dup_q.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="Сотрудник уже в проекте")
    member = ProjectMember(
        project_id=project_id,
        employee_id=payload.employee_id,
        role_in_project=payload.role_in_project,
        joined_at=payload.joined_at,
    )
    session.add(member)
    await session.commit()
    await session.refresh(proj, attribute_names=["members"])
    publics = await _build_member_publics(session, [member], current_user.id)
    return publics[0]


@router.patch("/{project_id}/members/{member_id}", response_model=ProjectMemberPublic)
async def update_member(
    project_id: int,
    member_id: int,
    payload: ProjectMemberUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    mq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.id == member_id, ProjectMember.project_id == project_id
        )
    )
    member = mq.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Участник не найден")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(member, k, v)
    await session.commit()
    publics = await _build_member_publics(session, [member], current_user.id)
    return publics[0]


@router.delete("/{project_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    project_id: int,
    member_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    mq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.id == member_id, ProjectMember.project_id == project_id
        )
    )
    member = mq.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Участник не найден")
    await session.delete(member)
    await session.commit()


@router.put("/{project_id}/members/{member_id}/rotation-lock", response_model=ProjectMemberPublic)
async def lock_member_rotation(
    project_id: int,
    member_id: int,
    payload: MemberLockBody,
    session: SessionDep,
    current_user: MutatorUser,
):
    """Запретить «выдёргивать» этого участника из проекта (например, ведёт критичную фазу).
    Кандидат остаётся виден на вкладке «Ротации», но кнопка действия недоступна."""
    mq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.id == member_id, ProjectMember.project_id == project_id
        )
    )
    member = mq.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Участник не найден")
    member.rotation_locked = True
    member.rotation_lock_note = (payload.note or "").strip() or None
    await session.commit()
    publics = await _build_member_publics(session, [member], current_user.id)
    return publics[0]


@router.delete(
    "/{project_id}/members/{member_id}/rotation-lock", response_model=ProjectMemberPublic
)
async def unlock_member_rotation(
    project_id: int,
    member_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    mq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.id == member_id, ProjectMember.project_id == project_id
        )
    )
    member = mq.scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Участник не найден")
    member.rotation_locked = False
    member.rotation_lock_note = None
    await session.commit()
    publics = await _build_member_publics(session, [member], current_user.id)
    return publics[0]


@router.put("/{project_id}/stack", response_model=list[ProjectCompetencyPublic])
async def set_stack(
    project_id: int,
    payload: ProjectStackBulkUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    """Полная замена тех. стека проекта."""
    proj = await _load_project_for(session, project_id, current_user)
    for pc in list(proj.competencies):
        await session.delete(pc)
    await session.flush()
    seen: set[int] = set()
    for item in payload.items:
        if item.competency_id in seen:
            continue
        seen.add(item.competency_id)
        session.add(
            ProjectCompetency(
                project_id=project_id,
                competency_id=item.competency_id,
                target_level=item.target_level,
            )
        )
    await session.commit()
    await session.refresh(proj, attribute_names=["competencies"])
    return await _build_competency_publics(session, proj.competencies)


# ---- агрегации ----


async def _latest_levels_by_employee(
    session, employee_ids: list[int]
) -> dict[tuple[int, int], int]:
    """{(employee_id, competency_id): latest level}"""
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


@router.get("/{project_id}/matrix", response_model=ProjectMatrix)
async def get_matrix(
    project_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    only_stack: bool = True,
):
    """Матрица участники × компетенции с уровнями. Видна всем.
    only_stack=true (default) — только компетенции из стека проекта.
    only_stack=false — все компетенции МПК.
    """
    proj = await _load_project_for(session, project_id, current_user)

    # участники
    emp_ids = [m.employee_id for m in proj.members]
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

    # компетенции
    target_by_comp: dict[int, int] = {pc.competency_id: pc.target_level for pc in proj.competencies}
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

    # значения
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


@router.get("/{project_id}/coverage", response_model=ProjectCoverage)
async def get_coverage(project_id: int, session: SessionDep, current_user: CurrentUser):
    """Покрытие тех.стека командой.

    В знаменателе — только участники, для роли которых компетенция:
      • требуется по role_profile (required_level > 0), И
      • отмечена ★-ключевой для роли (role_key_competencies).
    Идея: считаем носителей компетенции по специализации, а не «должны немного знать».
    """
    from sqlalchemy import and_, or_

    proj = await _load_project_for(session, project_id, current_user)
    if not proj.competencies or not proj.members:
        return ProjectCoverage(items=[], risk_score=0)

    emp_ids = [m.employee_id for m in proj.members]
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

    # ★-ключевые компетенции по ролям (без учёта грейда)
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
        select(Competency).where(Competency.id.in_([pc.competency_id for pc in proj.competencies]))
    )
    name_by_id = {c.id: c.name for c in cq.scalars()}

    items: list[CoverageItem] = []
    risk_score = 0.0
    for pc in proj.competencies:
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


@router.get("/{project_id}/grade-distribution", response_model=ProjectGradeDistribution)
async def get_grade_distribution(project_id: int, session: SessionDep, current_user: CurrentUser):
    proj = await _load_project_for(session, project_id, current_user)
    emp_ids = [m.employee_id for m in proj.members]
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

    if grade_counts:
        gq = await session.execute(select(Grade).where(Grade.id.in_(grade_counts.keys())))
        grades = list(gq.scalars())
        items = [
            GradeCount(grade_code=g.code, sort_order=g.sort_order, count=grade_counts[g.id])
            for g in grades
        ]
        items.sort(key=lambda x: x.sort_order)
    else:
        items = []
    return ProjectGradeDistribution(items=items, no_grade=no_grade)


# ----- repo-level CodeBuddy: pull-requests этого конкретного репо --------


@router.get(
    "/{project_id}/pull-requests",
    response_model=list[PullRequestPublic],
)
async def list_project_pull_requests(
    project_id: int,
    session: SessionDep,
    _current_user: CurrentUser,
    limit: int = 50,
    from_date: date | None = None,
    to_date: date | None = None,
):
    """PR-ы этого конкретного репо.

    Запрашиваем CodeBuddy `/developers/{username}/mrs` по всем членам
    продукта, к которому относится репо, и фильтруем по
    `project.gitlab_project_id`.
    """
    proj = await session.get(Project, project_id)
    if proj is None:
        raise HTTPException(status_code=404, detail="Репо не найдено")
    if not await is_codebuddy_live(session):
        return []
    if proj.gitlab_project_id is None or proj.product_id is None:
        return []

    to_d = to_date or date.today()
    from_d = from_date or (to_d - timedelta(days=90))
    if from_d > to_d:
        from_d = to_d - timedelta(days=90)

    mq = await session.execute(
        select(Employee)
        .join(ProductMember, ProductMember.employee_id == Employee.id)
        .where(
            ProductMember.product_id == proj.product_id,
            ProductMember.left_at.is_(None),
        )
    )
    members = list(mq.scalars())
    if not members:
        return []

    async def _one(emp: Employee):
        try:
            prs = await codebuddy_service.get_pull_requests(emp, from_d, to_d, limit=200)
        except CodeBuddyAPIError as e:
            logger.warning("project %s PR for emp %s: %s", project_id, emp.id, e)
            return []
        for p in prs:
            p.author_employee_id = emp.id
            p.author_full_name = emp.full_name
        return prs

    batches = await asyncio.gather(*[_one(m) for m in members])
    out: list[PullRequestPublic] = []
    for batch in batches:
        for p in batch:
            if p.project_id == proj.gitlab_project_id:
                out.append(p)
    out.sort(key=lambda p: p.created_at_ext, reverse=True)
    return out[: max(1, min(limit, 500))]
