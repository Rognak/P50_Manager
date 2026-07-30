"""Ранжирование кандидатов на ротацию для проекта.

Чистая функция от состояния БД: возвращает список кандидатов с разложенным
score'ом. AI-обоснование к этому не относится — оно живёт в RotationSuggestion
и подмешивается выше по стеку.

Алгоритм:
  • кандидат — активный membership (left_at IS NULL) активного проекта
    (status='active'), tenure ≥ 18 мес;
  • исключаются: rotation_locked=true; есть незакрытая Rotation
    (status in {proposed, accepted}) для этой пары (employee, from_project);
  • score = tenure_score + 2 * bus_factor_score:
      tenure_score    = (tenure_months − 18) // 3   (каждый квартал сверху +1)
      bus_factor_score = число ★-компетенций стека проекта,
                         для которых сотрудник — единственный носитель
                         требуемого уровня среди ★-релевантных коллег.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.mpk import (
    Assessment,
    AssessmentScore,
    RoleProfile,
    role_key_competencies,
)
from app.models.project import (
    Product,
    ProductCompetency,
    ProductMember,
    Project,
    ProjectCompetency,
    ProjectMember,
)
from app.models.rotation import Rotation

TENURE_THRESHOLD_MONTHS = 18


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month) + (1 if b.day >= a.day else 0)


@dataclass
class CandidateRow:
    employee_id: int
    member_id: int
    full_name: str
    role_id: int | None
    role_name: str | None
    grade_id: int | None
    grade_code: str | None
    owner_id: int
    joined_at: date | None
    tenure_months: int
    rotation_locked: bool
    rotation_lock_note: str | None
    pending_rotation_id: int | None  # есть незакрытая ротация → действие недоступно
    tenure_score: int
    bus_factor_score: int
    score: int
    bus_factor_competencies: list[tuple[int, str]]  # (comp_id, comp_name)


async def compute_candidates(
    session: AsyncSession, project_id: int, *, today: date | None = None
) -> list[CandidateRow]:
    today = today or date.today()

    proj = await session.get(Project, project_id)
    if proj is None or proj.status != "active":
        return []

    pmq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.left_at.is_(None),
        )
    )
    members = list(pmq.scalars())
    if not members:
        return []

    emp_ids = [m.employee_id for m in members]
    eq = await session.execute(
        select(Employee).where(Employee.id.in_(emp_ids))
    )
    employees = {e.id: e for e in eq.scalars()}

    # справочники для имён роли/грейда
    from app.models.mpk import Grade, Role  # локальный импорт во избежание циклов
    role_ids = {e.role_id for e in employees.values() if e.role_id}
    grade_ids = {e.grade_id for e in employees.values() if e.grade_id}
    role_name_by_id: dict[int, str] = {}
    grade_code_by_id: dict[int, str] = {}
    if role_ids:
        rq = await session.execute(select(Role.id, Role.name).where(Role.id.in_(role_ids)))
        role_name_by_id = {rid: name for rid, name in rq.all()}
    if grade_ids:
        gq = await session.execute(select(Grade.id, Grade.code).where(Grade.id.in_(grade_ids)))
        grade_code_by_id = {gid: code for gid, code in gq.all()}

    # стек проекта
    pcq = await session.execute(
        select(ProjectCompetency).where(ProjectCompetency.project_id == project_id)
    )
    stack = list(pcq.scalars())

    # ★-компетенции по ролям членов
    key_set: set[tuple[int, int]] = set()
    if role_ids:
        kq = await session.execute(
            select(
                role_key_competencies.c.role_id,
                role_key_competencies.c.competency_id,
            ).where(role_key_competencies.c.role_id.in_(role_ids))
        )
        key_set = {(rid, cid) for rid, cid in kq.all()}

    # required_level по ролям/грейдам участников
    rg_pairs = {
        (e.role_id, e.grade_id) for e in employees.values() if e.role_id and e.grade_id
    }
    required_map: dict[tuple[int, int, int], int] = {}
    if rg_pairs:
        conds = [
            and_(RoleProfile.role_id == rid, RoleProfile.grade_id == gid)
            for rid, gid in rg_pairs
        ]
        rpq = await session.execute(select(RoleProfile).where(or_(*conds)))
        for rp in rpq.scalars():
            if rp.required_level > 0:
                required_map[(rp.role_id, rp.grade_id, rp.competency_id)] = rp.required_level

    # latest level по (employee, competency)
    levels: dict[tuple[int, int], int] = {}
    if emp_ids:
        lq = await session.execute(
            select(
                Assessment.employee_id,
                AssessmentScore.competency_id,
                AssessmentScore.level,
            )
            .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
            .where(Assessment.employee_id.in_(emp_ids))
            .order_by(
                Assessment.employee_id,
                AssessmentScore.competency_id,
                Assessment.assessed_at.desc(),
                Assessment.id.desc(),
            )
            .distinct(Assessment.employee_id, AssessmentScore.competency_id)
        )
        levels = {(eid, cid): lvl for eid, cid, lvl in lq.all()}

    # для bus-factor: для каждой компетенции стека — список носителей
    # «носитель ★-уровня» = ★ для роли участника И level >= target_level
    holders_by_comp: dict[int, list[int]] = {}
    for pc in stack:
        for eid in emp_ids:
            emp = employees.get(eid)
            if emp is None or emp.role_id is None:
                continue
            if (emp.role_id, pc.competency_id) not in key_set:
                continue
            lvl = levels.get((eid, pc.competency_id))
            if lvl is None or lvl < pc.target_level:
                continue
            holders_by_comp.setdefault(pc.competency_id, []).append(eid)

    name_by_comp: dict[int, str] = {pc.competency_id: "" for pc in stack}
    if name_by_comp:
        from app.models.mpk import Competency
        cq = await session.execute(
            select(Competency.id, Competency.name).where(
                Competency.id.in_(name_by_comp.keys())
            )
        )
        name_by_comp = {cid: name for cid, name in cq.all()}

    # незакрытые ротации (proposed | accepted) для этой пары
    pending_q = await session.execute(
        select(Rotation.id, Rotation.employee_id).where(
            Rotation.from_project_id == project_id,
            Rotation.status.in_(("proposed", "accepted")),
        )
    )
    pending_by_emp: dict[int, int] = {eid: rid for rid, eid in pending_q.all()}

    rows: list[CandidateRow] = []
    for m in members:
        emp = employees.get(m.employee_id)
        if emp is None:
            continue
        if m.joined_at is None:
            continue
        tenure = _months_between(m.joined_at, today)
        if tenure < TENURE_THRESHOLD_MONTHS:
            continue

        bus_comps: list[tuple[int, str]] = []
        for pc in stack:
            holders = holders_by_comp.get(pc.competency_id, [])
            if len(holders) == 1 and holders[0] == m.employee_id:
                bus_comps.append((pc.competency_id, name_by_comp.get(pc.competency_id, "")))

        tenure_score = max(0, (tenure - TENURE_THRESHOLD_MONTHS) // 3)
        bus_factor_score = len(bus_comps)
        total = tenure_score + 2 * bus_factor_score

        rows.append(
            CandidateRow(
                employee_id=emp.id,
                member_id=m.id,
                full_name=emp.full_name,
                role_id=emp.role_id,
                role_name=role_name_by_id.get(emp.role_id) if emp.role_id else None,
                grade_id=emp.grade_id,
                grade_code=grade_code_by_id.get(emp.grade_id) if emp.grade_id else None,
                owner_id=emp.owner_id,
                joined_at=m.joined_at,
                tenure_months=tenure,
                rotation_locked=m.rotation_locked,
                rotation_lock_note=m.rotation_lock_note,
                pending_rotation_id=pending_by_emp.get(m.employee_id),
                tenure_score=tenure_score,
                bus_factor_score=bus_factor_score,
                score=total,
                bus_factor_competencies=bus_comps,
            )
        )

    rows.sort(key=lambda r: (-r.score, -r.tenure_months, r.full_name))
    return rows


async def compute_candidates_for_product(
    session: AsyncSession, product_id: int, *, today: date | None = None
) -> list[CandidateRow]:
    """Ранжирование кандидатов на ротацию на уровне Product.

    Логика идентична compute_candidates, но опирается на ProductMember/
    ProductCompetency и Rotation.from_product_id. После этапа 5 cleanup
    эта функция станет основной, а старая будет удалена.
    """
    today = today or date.today()

    prod = await session.get(Product, product_id)
    if prod is None or prod.status != "active":
        return []

    pmq = await session.execute(
        select(ProductMember).where(
            ProductMember.product_id == product_id,
            ProductMember.left_at.is_(None),
        )
    )
    members = list(pmq.scalars())
    if not members:
        return []

    emp_ids = [m.employee_id for m in members]
    eq = await session.execute(
        select(Employee).where(Employee.id.in_(emp_ids))
    )
    employees = {e.id: e for e in eq.scalars()}

    from app.models.mpk import Grade, Role
    role_ids = {e.role_id for e in employees.values() if e.role_id}
    grade_ids = {e.grade_id for e in employees.values() if e.grade_id}
    role_name_by_id: dict[int, str] = {}
    grade_code_by_id: dict[int, str] = {}
    if role_ids:
        rq = await session.execute(select(Role.id, Role.name).where(Role.id.in_(role_ids)))
        role_name_by_id = {rid: name for rid, name in rq.all()}
    if grade_ids:
        gq = await session.execute(select(Grade.id, Grade.code).where(Grade.id.in_(grade_ids)))
        grade_code_by_id = {gid: code for gid, code in gq.all()}

    pcq = await session.execute(
        select(ProductCompetency).where(ProductCompetency.product_id == product_id)
    )
    stack = list(pcq.scalars())

    key_set: set[tuple[int, int]] = set()
    if role_ids:
        kq = await session.execute(
            select(
                role_key_competencies.c.role_id,
                role_key_competencies.c.competency_id,
            ).where(role_key_competencies.c.role_id.in_(role_ids))
        )
        key_set = {(rid, cid) for rid, cid in kq.all()}

    rg_pairs = {
        (e.role_id, e.grade_id)
        for e in employees.values()
        if e.role_id and e.grade_id
    }
    required_map: dict[tuple[int, int, int], int] = {}
    if rg_pairs:
        conds = [
            and_(RoleProfile.role_id == rid, RoleProfile.grade_id == gid)
            for rid, gid in rg_pairs
        ]
        rpq = await session.execute(select(RoleProfile).where(or_(*conds)))
        for rp in rpq.scalars():
            if rp.required_level > 0:
                required_map[(rp.role_id, rp.grade_id, rp.competency_id)] = rp.required_level

    levels: dict[tuple[int, int], int] = {}
    if emp_ids:
        lq = await session.execute(
            select(
                Assessment.employee_id,
                AssessmentScore.competency_id,
                AssessmentScore.level,
            )
            .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
            .where(Assessment.employee_id.in_(emp_ids))
            .order_by(
                Assessment.employee_id,
                AssessmentScore.competency_id,
                Assessment.assessed_at.desc(),
                Assessment.id.desc(),
            )
            .distinct(Assessment.employee_id, AssessmentScore.competency_id)
        )
        levels = {(eid, cid): lvl for eid, cid, lvl in lq.all()}

    holders_by_comp: dict[int, list[int]] = {}
    for pc in stack:
        for eid in emp_ids:
            emp = employees.get(eid)
            if emp is None or emp.role_id is None:
                continue
            if (emp.role_id, pc.competency_id) not in key_set:
                continue
            lvl = levels.get((eid, pc.competency_id))
            if lvl is None or lvl < pc.target_level:
                continue
            holders_by_comp.setdefault(pc.competency_id, []).append(eid)

    name_by_comp: dict[int, str] = {pc.competency_id: "" for pc in stack}
    if name_by_comp:
        from app.models.mpk import Competency
        cq = await session.execute(
            select(Competency.id, Competency.name).where(
                Competency.id.in_(name_by_comp.keys())
            )
        )
        name_by_comp = {cid: name for cid, name in cq.all()}

    # Незакрытые ротации (proposed | accepted) для этого продукта
    pending_q = await session.execute(
        select(Rotation.id, Rotation.employee_id).where(
            Rotation.from_product_id == product_id,
            Rotation.status.in_(("proposed", "accepted")),
        )
    )
    pending_by_emp: dict[int, int] = {eid: rid for rid, eid in pending_q.all()}

    rows: list[CandidateRow] = []
    for m in members:
        emp = employees.get(m.employee_id)
        if emp is None:
            continue
        if m.joined_at is None:
            continue
        tenure = _months_between(m.joined_at, today)
        if tenure < TENURE_THRESHOLD_MONTHS:
            continue

        bus_comps: list[tuple[int, str]] = []
        for pc in stack:
            holders = holders_by_comp.get(pc.competency_id, [])
            if len(holders) == 1 and holders[0] == m.employee_id:
                bus_comps.append((pc.competency_id, name_by_comp.get(pc.competency_id, "")))

        tenure_score = max(0, (tenure - TENURE_THRESHOLD_MONTHS) // 3)
        bus_factor_score = len(bus_comps)
        total = tenure_score + 2 * bus_factor_score

        rows.append(
            CandidateRow(
                employee_id=emp.id,
                member_id=m.id,
                full_name=emp.full_name,
                role_id=emp.role_id,
                role_name=role_name_by_id.get(emp.role_id) if emp.role_id else None,
                grade_id=emp.grade_id,
                grade_code=grade_code_by_id.get(emp.grade_id) if emp.grade_id else None,
                owner_id=emp.owner_id,
                joined_at=m.joined_at,
                tenure_months=tenure,
                rotation_locked=m.rotation_locked,
                rotation_lock_note=m.rotation_lock_note,
                pending_rotation_id=pending_by_emp.get(m.employee_id),
                tenure_score=tenure_score,
                bus_factor_score=bus_factor_score,
                score=total,
                bus_factor_competencies=bus_comps,
            )
        )

    rows.sort(key=lambda r: (-r.score, -r.tenure_months, r.full_name))
    return rows


@dataclass
class ReplacementsResult:
    """Результат поиска замен.

    needed=False означает, что уходящий не закрывает ★-слотов на проекте —
    замена не критична (neutral state, не warning). В этом случае viable/blocked
    пусты, empty_reason = None.

    needed=True + viable пусто → реальная проблема (warning), причина в empty_reason."""

    viable: list["ReplacementCandidate"]
    blocked: list["ReplacementCandidate"]
    needed: bool
    empty_reason: str | None


@dataclass
class ReplacementCandidate:
    """Кандидат на замену уходящего сотрудника: человек из другого проекта,
    у которого ★-компетенции покрывают слот."""

    employee_id: int
    full_name: str
    role_name: str | None
    grade_code: str | None
    owner_id: int

    # текущий «домашний» проект (тот, откуда его придётся забирать)
    current_project_id: int | None
    current_project_name: str | None
    tenure_months: int  # на current_project

    overlap_competencies: list[tuple[int, str]]  # (id, name) — слоты, которые он закрывает
    fit_score: float  # overlap / |slot|, 0..1
    readiness_score: float  # min(1, tenure/18)
    total_score: float  # 2*fit + readiness, 0..3

    status: str  # "ready" | "approachable" | "early" | "free"
    blocker: str | None  # "locked" | "pending" | None


@dataclass
class ReplacementNeedAssessment:
    """Структурированная диагностика «нужна ли замена и почему»."""

    needed: bool
    project_name: str
    # ★-компетенции роли уходящего, которые входят в стек проекта
    role_keys_in_stack: list[tuple[int, str]]
    # ★ из стека, которые уходящий реально закрывает на целевом уровне
    closed_at_target: list[tuple[int, str]]


async def assess_replacement_need(
    session: AsyncSession, employee_id: int, from_project_id: int
) -> ReplacementNeedAssessment:
    """Структурированная диагностика. needed = непустой closed_at_target."""
    proj = await session.get(Project, from_project_id)
    project_name = proj.name if proj else ""

    emp = await session.get(Employee, employee_id)
    if emp is None or emp.role_id is None or proj is None:
        return ReplacementNeedAssessment(False, project_name, [], [])

    pcq = await session.execute(
        select(ProjectCompetency).where(ProjectCompetency.project_id == from_project_id)
    )
    stack = list(pcq.scalars())
    if not stack:
        return ReplacementNeedAssessment(False, project_name, [], [])

    kq = await session.execute(
        select(role_key_competencies.c.competency_id).where(
            role_key_competencies.c.role_id == emp.role_id
        )
    )
    key_ids = {cid for (cid,) in kq.all()}

    overlap_ids = [pc.competency_id for pc in stack if pc.competency_id in key_ids]
    if not overlap_ids:
        return ReplacementNeedAssessment(False, project_name, [], [])

    from app.models.mpk import Competency

    cq = await session.execute(
        select(Competency.id, Competency.name).where(Competency.id.in_(overlap_ids))
    )
    name_by_id = {cid: name for cid, name in cq.all()}
    role_keys_in_stack = [(cid, name_by_id.get(cid, "")) for cid in overlap_ids]

    lvl_q = await session.execute(
        select(AssessmentScore.competency_id, AssessmentScore.level)
        .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
        .where(Assessment.employee_id == employee_id)
        .order_by(
            AssessmentScore.competency_id,
            Assessment.assessed_at.desc(),
            Assessment.id.desc(),
        )
        .distinct(AssessmentScore.competency_id)
    )
    levels = {cid: lvl for cid, lvl in lvl_q.all()}

    closed_at_target: list[tuple[int, str]] = []
    for pc in stack:
        if pc.competency_id not in key_ids:
            continue
        if levels.get(pc.competency_id, 0) >= pc.target_level:
            closed_at_target.append((pc.competency_id, name_by_id.get(pc.competency_id, "")))

    return ReplacementNeedAssessment(
        needed=bool(closed_at_target),
        project_name=project_name,
        role_keys_in_stack=role_keys_in_stack,
        closed_at_target=closed_at_target,
    )


async def suggest_replacements(
    session: AsyncSession,
    employee_id: int,
    from_project_id: int,
    to_project_id: int,
    *,
    limit: int = 3,
    today: date | None = None,
) -> ReplacementsResult:
    """Подобрать кандидатов на замену из целевого проекта (паттерн «обмен»):
    кто-то из to_project приходит на освобождающееся место в from_project.

    «Слот» = ★-компетенции уходящего, которые он действительно закрывает на
    исходном проекте. Если строгого слота нет — soft-режим, слотом служит весь
    стек from-проекта."""
    today = today or date.today()

    emp_out = await session.get(Employee, employee_id)
    if emp_out is None or emp_out.role_id is None:
        return ReplacementsResult(
            viable=[], blocked=[], needed=False, empty_reason=None
        )

    proj = await session.get(Project, from_project_id)
    if proj is None:
        return ReplacementsResult(
            viable=[], blocked=[], needed=False, empty_reason=None
        )

    # стек проекта
    pcq = await session.execute(
        select(ProjectCompetency).where(ProjectCompetency.project_id == from_project_id)
    )
    stack = list(pcq.scalars())
    if not stack:
        return ReplacementsResult(
            viable=[], blocked=[], needed=False, empty_reason=None
        )

    # ★ для роли уходящего
    out_key_q = await session.execute(
        select(role_key_competencies.c.competency_id).where(
            role_key_competencies.c.role_id == emp_out.role_id
        )
    )
    out_key_ids = {cid for (cid,) in out_key_q.all()}

    # уровни уходящего
    out_levels_q = await session.execute(
        select(AssessmentScore.competency_id, AssessmentScore.level)
        .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
        .where(Assessment.employee_id == employee_id)
        .order_by(
            AssessmentScore.competency_id,
            Assessment.assessed_at.desc(),
            Assessment.id.desc(),
        )
        .distinct(AssessmentScore.competency_id)
    )
    out_levels = {cid: lvl for cid, lvl in out_levels_q.all()}

    slot: dict[int, int] = {}  # competency_id -> target_level
    for pc in stack:
        if pc.competency_id not in out_key_ids:
            continue
        lvl = out_levels.get(pc.competency_id)
        if lvl is None or lvl < pc.target_level:
            continue
        slot[pc.competency_id] = pc.target_level

    needed = bool(slot)
    if not slot:
        # «строгий» слот пуст — уход не критичен по компетенциям. Но кандидатов
        # всё равно покажем (soft-режим): в качестве слота — весь стек проекта,
        # без требования к уровню кандидата ≥ target.
        slot = {pc.competency_id: pc.target_level for pc in stack}

    # участники целевого проекта (исключая самого уходящего, если он там есть)
    other_pm_q = await session.execute(
        select(ProjectMember, Project)
        .join(Project, Project.id == ProjectMember.project_id)
        .where(
            ProjectMember.left_at.is_(None),
            ProjectMember.project_id == to_project_id,
            ProjectMember.employee_id != employee_id,
            Project.status == "active",
        )
    )
    other_members = list(other_pm_q.all())
    if not other_members:
        return ReplacementsResult(
            viable=[],
            blocked=[],
            needed=needed,
            empty_reason="В целевом проекте нет других участников",
        )

    # сгруппируем по сотруднику, оставим самое старое membership (longest tenure)
    by_emp: dict[int, tuple[ProjectMember, Project, int]] = {}
    for pm, p in other_members:
        if pm.joined_at is None:
            tenure = 0
        else:
            tenure = _months_between(pm.joined_at, today)
        prev = by_emp.get(pm.employee_id)
        if prev is None or tenure > prev[2]:
            by_emp[pm.employee_id] = (pm, p, tenure)

    cand_emp_ids = list(by_emp.keys())
    if not cand_emp_ids:
        return ReplacementsResult(
            viable=[],
            blocked=[],
            needed=needed,
            empty_reason="В целевом проекте нет других участников",
        )

    # роли/грейды кандидатов
    eq = await session.execute(
        select(Employee).where(Employee.id.in_(cand_emp_ids))
    )
    emp_by_id = {e.id: e for e in eq.scalars()}

    role_ids = {e.role_id for e in emp_by_id.values() if e.role_id}
    if not role_ids:
        return ReplacementsResult(
            viable=[],
            blocked=[],
            needed=needed,
            empty_reason="У участников целевого проекта не назначены роли",
        )

    from app.models.mpk import Grade, Role

    rq = await session.execute(
        select(Role.id, Role.name).where(Role.id.in_(role_ids))
    )
    role_name_by_id = {rid: name for rid, name in rq.all()}
    grade_ids = {e.grade_id for e in emp_by_id.values() if e.grade_id}
    grade_code_by_id: dict[int, str] = {}
    if grade_ids:
        gq = await session.execute(
            select(Grade.id, Grade.code).where(Grade.id.in_(grade_ids))
        )
        grade_code_by_id = {gid: code for gid, code in gq.all()}

    # ★ для ролей кандидатов
    rkq = await session.execute(
        select(role_key_competencies.c.role_id, role_key_competencies.c.competency_id).where(
            role_key_competencies.c.role_id.in_(role_ids)
        )
    )
    role_key_set: set[tuple[int, int]] = {(rid, cid) for rid, cid in rkq.all()}

    # latest levels кандидатов по компетенциям из slot
    slot_ids = list(slot.keys())
    levels_q = await session.execute(
        select(
            Assessment.employee_id,
            AssessmentScore.competency_id,
            AssessmentScore.level,
        )
        .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
        .where(
            Assessment.employee_id.in_(cand_emp_ids),
            AssessmentScore.competency_id.in_(slot_ids),
        )
        .order_by(
            Assessment.employee_id,
            AssessmentScore.competency_id,
            Assessment.assessed_at.desc(),
            Assessment.id.desc(),
        )
        .distinct(Assessment.employee_id, AssessmentScore.competency_id)
    )
    cand_levels: dict[tuple[int, int], int] = {
        (eid, cid): lvl for eid, cid, lvl in levels_q.all()
    }

    # имена компетенций slot'а
    from app.models.mpk import Competency

    cq = await session.execute(
        select(Competency.id, Competency.name).where(Competency.id.in_(slot_ids))
    )
    comp_name_by_id = {cid: name for cid, name in cq.all()}

    # активные ротации (proposed/accepted) по этим employee'ам — для blocker='pending'
    pending_q = await session.execute(
        select(Rotation.employee_id).where(
            Rotation.employee_id.in_(cand_emp_ids),
            Rotation.status.in_(("proposed", "accepted")),
        )
    )
    pending_set = {eid for (eid,) in pending_q.all()}

    slot_size = len(slot)
    viable: list[ReplacementCandidate] = []
    blocked: list[ReplacementCandidate] = []

    for eid, (pm, p, tenure) in by_emp.items():
        emp = emp_by_id.get(eid)
        if emp is None or emp.role_id is None:
            continue

        # подходящие компетенции: ★ для роли кандидата
        # в strict-режиме (needed=True) — также проверяем уровень ≥ target;
        # в soft-режиме (needed=False) — достаточно совпадения ★ с слотом
        overlap: list[tuple[int, str]] = []
        for cid, target in slot.items():
            if (emp.role_id, cid) not in role_key_set:
                continue
            if needed:
                lvl = cand_levels.get((eid, cid))
                if lvl is None or lvl < target:
                    continue
            overlap.append((cid, comp_name_by_id.get(cid, "")))
        if not overlap:
            continue

        fit = len(overlap) / slot_size
        readiness = min(1.0, tenure / 18.0)
        total = round(2 * fit + readiness, 2)

        if tenure >= 18:
            status = "ready"
        elif tenure >= 12:
            status = "approachable"
        else:
            status = "early"

        blocker: str | None = None
        if pm.rotation_locked:
            blocker = "locked"
        elif eid in pending_set:
            blocker = "pending"

        rc = ReplacementCandidate(
            employee_id=eid,
            full_name=emp.full_name,
            role_name=role_name_by_id.get(emp.role_id),
            grade_code=grade_code_by_id.get(emp.grade_id) if emp.grade_id else None,
            owner_id=emp.owner_id,
            current_project_id=p.id,
            current_project_name=p.name,
            tenure_months=tenure,
            overlap_competencies=overlap,
            fit_score=round(fit, 2),
            readiness_score=round(readiness, 2),
            total_score=total,
            status=status,
            blocker=blocker,
        )
        if blocker is None:
            viable.append(rc)
        else:
            blocked.append(rc)

    viable.sort(key=lambda r: (-r.total_score, -r.tenure_months, r.full_name))
    blocked.sort(key=lambda r: (-r.total_score, r.full_name))

    if not viable:
        if blocked:
            reason = (
                "В целевом проекте есть подходящие, но все заморожены или в активной ротации"
            )
        else:
            reason = "В целевом проекте нет подходящих кандидатов"
        return ReplacementsResult(
            viable=[],
            blocked=blocked[:limit],
            needed=needed,
            empty_reason=reason,
        )

    return ReplacementsResult(
        viable=viable[:limit],
        blocked=blocked[:limit],
        needed=needed,
        empty_reason=None,
    )


async def suggest_target_projects(
    session: AsyncSession,
    employee_id: int,
    from_project_id: int,
    *,
    limit: int = 5,
) -> list[tuple[int, str, int]]:
    """Подобрать целевые проекты, куда было бы полезно ротировать сотрудника.

    Критерий: пересечение ★-компетенций сотрудника со стеком кандидата-проекта,
    при условии, что кандидат:
      • активен;
      • не совпадает с from_project;
      • сотрудник в нём ещё не состоит (или только бывший участник).
    Балл — число пересечений; tie-break по убыванию суммы target_level.

    Возвращает: [(project_id, project_name, overlap_count), ...]
    """
    emp = await session.get(Employee, employee_id)
    if emp is None or emp.role_id is None:
        return []

    kq = await session.execute(
        select(role_key_competencies.c.competency_id).where(
            role_key_competencies.c.role_id == emp.role_id
        )
    )
    key_ids = {cid for (cid,) in kq.all()}
    if not key_ids:
        return []

    active_q = await session.execute(
        select(Project).where(Project.status == "active", Project.id != from_project_id)
    )
    candidates = list(active_q.scalars())
    if not candidates:
        return []

    cand_ids = [p.id for p in candidates]

    member_q = await session.execute(
        select(ProjectMember.project_id).where(
            ProjectMember.employee_id == employee_id,
            ProjectMember.project_id.in_(cand_ids),
            ProjectMember.left_at.is_(None),
        )
    )
    already_in = {pid for (pid,) in member_q.all()}

    pcq = await session.execute(
        select(ProjectCompetency).where(ProjectCompetency.project_id.in_(cand_ids))
    )
    stack_by_proj: dict[int, list[ProjectCompetency]] = {}
    for pc in pcq.scalars():
        stack_by_proj.setdefault(pc.project_id, []).append(pc)

    scored: list[tuple[int, str, int, int]] = []  # (proj_id, name, overlap, target_sum)
    for p in candidates:
        if p.id in already_in:
            continue
        stack = stack_by_proj.get(p.id, [])
        overlap = [pc for pc in stack if pc.competency_id in key_ids]
        if not overlap:
            continue
        scored.append((p.id, p.name, len(overlap), sum(pc.target_level for pc in overlap)))

    scored.sort(key=lambda x: (-x[2], -x[3], x[1]))
    return [(pid, name, ov) for pid, name, ov, _ in scored[:limit]]
