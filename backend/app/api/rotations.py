"""Эндпоинты ротаций: вкладка по проекту (просмотр + refresh) и lifecycle ротации."""
from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
)
from app.models.employee import Employee
from app.models.mpk import AIJob
from app.models.project import Project, ProjectMember
from app.models.rotation import Rotation, RotationApproval, RotationSuggestion
from app.notifications.service import publish_pending, record_notifications
from app.models.user import User
from app.redis_pool import get_pool
from app.rotations.ranking import (
    _months_between,
    assess_replacement_need,
    compute_candidates,
    suggest_replacements,
)
from app.schemas.rotation import (
    ApprovalDecision,
    GlobalRotationCandidate,
    JobAccepted,
    LockedMemberPublic,
    ReplacementCandidatePublic,
    ReplacementsResponse,
    RotationApprovalPublic,
    RotationApproverPreview,
    RotationCandidatePublic,
    RotationCreate,
    RotationListItem,
    RotationPublic,
    RotationsPanel,
)

router = APIRouter(prefix="/projects/{project_id}/rotations", tags=["rotations"])
lifecycle = APIRouter(prefix="/rotations", tags=["rotations"])


@router.get("", response_model=RotationsPanel)
async def get_project_rotations(
    project_id: int, session: SessionDep, _current_user: CurrentUser
):
    proj = await session.get(Project, project_id)
    if proj is None:
        raise HTTPException(status_code=404, detail="Проект не найден")

    candidates = await compute_candidates(session, project_id)
    if not candidates:
        return RotationsPanel(candidates=[], no_candidates=True)

    emp_ids = [c.employee_id for c in candidates]

    # owner_name — у каждого кандидата
    owner_ids = {c.owner_id for c in candidates}
    if owner_ids:
        uq = await session.execute(
            select(User.id, User.full_name).where(User.id.in_(owner_ids))
        )
        owner_name_by_id = {uid: name for uid, name in uq.all()}
    else:
        owner_name_by_id = {}

    # уже сгенерированные suggestions для этой пары
    sq = await session.execute(
        select(RotationSuggestion).where(
            RotationSuggestion.from_project_id == project_id,
            RotationSuggestion.employee_id.in_(emp_ids),
        )
    )
    sug_by_emp: dict[int, RotationSuggestion] = {
        s.employee_id: s for s in sq.scalars()
    }

    # активные (queued/running) AIJob'ы по тем же парам
    aq = await session.execute(
        select(AIJob.employee_id).where(
            AIJob.kind == "rotation_suggestion",
            AIJob.target_id == project_id,
            AIJob.employee_id.in_(emp_ids),
            AIJob.status.in_(("queued", "running")),
        )
    )
    running_emps = {eid for (eid,) in aq.all()}

    # имена целевых проектов
    target_ids: set[int] = set()
    for s in sug_by_emp.values():
        for tid in (s.target_project_ids or []):
            target_ids.add(tid)
    target_info: dict[int, tuple[str, str | None]] = {}
    if target_ids:
        pq = await session.execute(
            select(Project.id, Project.name, Project.code).where(
                Project.id.in_(target_ids)
            )
        )
        target_info = {pid: (name, code) for pid, name, code in pq.all()}

    items: list[RotationCandidatePublic] = []
    for c in candidates:
        s = sug_by_emp.get(c.employee_id)
        targets = []
        if s:
            for tid in (s.target_project_ids or []):
                name_code = target_info.get(tid)
                if name_code is None:
                    continue
                targets.append(
                    {"project_id": tid, "project_name": name_code[0], "code": name_code[1]}
                )

        repl_assess = await assess_replacement_need(
            session, c.employee_id, project_id
        )

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
                suggestion_running=c.employee_id in running_emps,
                replacement_needed=repl_assess.needed,
                replacement_project_name=repl_assess.project_name,
                replacement_role_keys_in_stack=[
                    {"competency_id": cid, "competency_name": name}
                    for cid, name in repl_assess.role_keys_in_stack
                ],
            )
        )

    return RotationsPanel(candidates=items, no_candidates=False)


@router.post("/refresh/{employee_id}", response_model=JobAccepted, status_code=202)
async def refresh_candidate_suggestion(
    project_id: int,
    employee_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    """Поставить в очередь перегенерацию AI-обоснования для конкретного кандидата."""
    proj = await session.get(Project, project_id)
    if proj is None:
        raise HTTPException(status_code=404, detail="Проект не найден")

    pmq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.employee_id == employee_id,
            ProjectMember.left_at.is_(None),
        )
    )
    if pmq.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=404, detail="Сотрудник не в активном составе проекта"
        )

    # не плодим параллельно
    aq = await session.execute(
        select(AIJob.id).where(
            AIJob.kind == "rotation_suggestion",
            AIJob.target_id == project_id,
            AIJob.employee_id == employee_id,
            AIJob.status.in_(("queued", "running")),
        )
    )
    existing = aq.scalar_one_or_none()
    if existing is not None:
        return JobAccepted(
            job_id=existing, employee_id=employee_id, from_project_id=project_id
        )

    job = AIJob(
        kind="rotation_suggestion",
        status="queued",
        employee_id=employee_id,
        target_kind="rotation_suggestion",
        target_id=project_id,
        payload={"reason": "manual_refresh"},
        created_by=current_user.id,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    pool = get_pool()
    await pool.enqueue_job("run_rotation_suggestion", job.id)

    return JobAccepted(
        job_id=job.id, employee_id=employee_id, from_project_id=project_id
    )


@router.get("/{employee_id}/replacements", response_model=ReplacementsResponse)
async def get_replacement_candidates(
    project_id: int,
    employee_id: int,
    to_project_id: int,
    session: SessionDep,
    _current_user: CurrentUser,
):
    """Кандидаты на замену для конкретной пары (employee, from_project=project_id, to_project_id).

    Кандидаты — участники целевого проекта, чьи ★-компетенции пересекаются
    со «слотом» уходящего на исходном проекте."""
    res = await suggest_replacements(
        session, employee_id, project_id, to_project_id, limit=5
    )

    def _pub(rc) -> ReplacementCandidatePublic:
        return ReplacementCandidatePublic(
            employee_id=rc.employee_id,
            full_name=rc.full_name,
            role_name=rc.role_name,
            grade_code=rc.grade_code,
            owner_id=rc.owner_id,
            current_project_id=rc.current_project_id,
            current_project_name=rc.current_project_name,
            tenure_months=rc.tenure_months,
            overlap_competencies=[
                {"competency_id": cid, "competency_name": name}
                for cid, name in rc.overlap_competencies
            ],
            fit_score=rc.fit_score,
            readiness_score=rc.readiness_score,
            total_score=rc.total_score,
            status=rc.status,
            blocker=rc.blocker,
        )

    return ReplacementsResponse(
        needed=res.needed,
        viable=[_pub(r) for r in res.viable],
        blocked=[_pub(r) for r in res.blocked],
        empty_reason=res.empty_reason,
    )


# ---------- lifecycle helpers ----------


async def _required_approvers(
    session, employee_id: int, from_project_id: int, to_project_id: int
) -> set[int]:
    """Авто-вычисляемые согласующие (set дедуплицирует, если роли совпадают):

      1) менеджер исходного проекта (from_project.created_by)
      2) менеджер целевого проекта (to_project.created_by)
      3) руководитель сотрудника (employee.owner)
      4) PM-продукта исходного проекта (from_project.product_manager_id), если задан
      5) PM-продукта целевого проекта (to_project.product_manager_id), если задан

    Инициатор не исключается. Если он совпадает с одним из авто-approver'ов —
    его голос фиксируется как 'approve' автоматически в propose_rotation."""
    emp = await session.get(Employee, employee_id)
    if emp is None:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    fp = await session.get(Project, from_project_id)
    if fp is None:
        raise HTTPException(status_code=404, detail="Исходный проект не найден")
    tp = await session.get(Project, to_project_id)
    if tp is None:
        raise HTTPException(status_code=404, detail="Целевой проект не найден")
    approvers: set[int] = {fp.created_by, tp.created_by, emp.owner_id}
    if fp.product_manager_id is not None:
        approvers.add(fp.product_manager_id)
    if tp.product_manager_id is not None:
        approvers.add(tp.product_manager_id)
    return approvers


async def _to_rotation_public(session, rot: Rotation) -> RotationPublic:
    emp = await session.get(Employee, rot.employee_id)
    fp = (
        await session.get(Project, rot.from_project_id)
        if rot.from_project_id
        else None
    )
    tp = (
        await session.get(Project, rot.to_project_id)
        if rot.to_project_id
        else None
    )
    from app.models.project import Product  # локально, чтобы избежать циклов
    f_prod = (
        await session.get(Product, rot.from_product_id)
        if rot.from_product_id
        else None
    )
    t_prod = (
        await session.get(Product, rot.to_product_id)
        if rot.to_product_id
        else None
    )
    repl = (
        await session.get(Employee, rot.replacement_employee_id)
        if rot.replacement_employee_id
        else None
    )

    user_ids = {rot.initiated_by_id}
    aq = await session.execute(
        select(RotationApproval).where(RotationApproval.rotation_id == rot.id)
    )
    approvals = list(aq.scalars())
    user_ids.update(a.user_id for a in approvals)
    uq = await session.execute(
        select(User.id, User.full_name).where(User.id.in_(user_ids))
    )
    name_by_id = {uid: name for uid, name in uq.all()}

    return RotationPublic(
        id=rot.id,
        employee_id=rot.employee_id,
        employee_name=emp.full_name if emp else "",
        from_project_id=rot.from_project_id,
        from_project_name=fp.name if fp else None,
        from_project_code=fp.code if fp else None,
        to_project_id=rot.to_project_id,
        to_project_name=tp.name if tp else None,
        to_project_code=tp.code if tp else None,
        from_product_id=rot.from_product_id,
        from_product_name=f_prod.name if f_prod else None,
        to_product_id=rot.to_product_id,
        to_product_name=t_prod.name if t_prod else None,
        status=rot.status,
        reason_md=rot.reason_md,
        initiated_by_id=rot.initiated_by_id,
        initiated_by_name=name_by_id.get(rot.initiated_by_id),
        proposed_at=rot.proposed_at,
        planned_start_at=rot.planned_start_at,
        accepted_at=rot.accepted_at,
        completed_at=rot.completed_at,
        cancelled_at=rot.cancelled_at,
        reverted_at=rot.reverted_at,
        reverted_by_id=rot.reverted_by_id,
        replacement_employee_id=rot.replacement_employee_id,
        replacement_full_name=repl.full_name if repl else None,
        approvals=[
            RotationApprovalPublic(
                user_id=a.user_id,
                user_name=name_by_id.get(a.user_id),
                decision=a.decision,
                decided_at=a.decided_at,
                comment=a.comment,
            )
            for a in approvals
        ],
    )


# ---------- lifecycle endpoints ----------


@lifecycle.get("/locked", response_model=list[LockedMemberPublic])
async def list_locked_members(session: SessionDep, _current_user: CurrentUser):
    """Заморожённые от ротации участники по всем активным проектам."""
    from datetime import date

    q = await session.execute(
        select(ProjectMember, Project, Employee, User)
        .join(Project, Project.id == ProjectMember.project_id)
        .join(Employee, Employee.id == ProjectMember.employee_id)
        .join(User, User.id == Employee.owner_id)
        .where(
            ProjectMember.rotation_locked.is_(True),
            ProjectMember.left_at.is_(None),
            Project.status == "active",
        )
    )
    rows = list(q.all())

    role_ids: set[int] = set()
    grade_ids: set[int] = set()
    for _pm, _proj, emp, _u in rows:
        if emp.role_id:
            role_ids.add(emp.role_id)
        if emp.grade_id:
            grade_ids.add(emp.grade_id)

    from app.models.mpk import Grade, Role

    role_name_by_id: dict[int, str] = {}
    grade_code_by_id: dict[int, str] = {}
    if role_ids:
        rq = await session.execute(select(Role.id, Role.name).where(Role.id.in_(role_ids)))
        role_name_by_id = {rid: name for rid, name in rq.all()}
    if grade_ids:
        gq = await session.execute(select(Grade.id, Grade.code).where(Grade.id.in_(grade_ids)))
        grade_code_by_id = {gid: code for gid, code in gq.all()}

    today = date.today()
    items: list[LockedMemberPublic] = []
    for pm, proj, emp, owner in rows:
        tenure = _months_between(pm.joined_at, today) if pm.joined_at else 0
        items.append(
            LockedMemberPublic(
                employee_id=emp.id,
                member_id=pm.id,
                full_name=emp.full_name,
                role_name=role_name_by_id.get(emp.role_id) if emp.role_id else None,
                grade_code=grade_code_by_id.get(emp.grade_id) if emp.grade_id else None,
                owner_id=emp.owner_id,
                owner_name=owner.full_name,
                project_id=proj.id,
                project_name=proj.name,
                project_code=proj.code,
                joined_at=pm.joined_at,
                tenure_months=tenure,
                rotation_lock_note=pm.rotation_lock_note,
            )
        )
    items.sort(key=lambda x: (x.project_name, x.full_name))
    return items


@lifecycle.get("/candidates", response_model=list[GlobalRotationCandidate])
async def list_all_candidates(session: SessionDep, _current_user: CurrentUser):
    """Кандидаты на ротацию по всем активным проектам — для глобальной вкладки.

    Внутри использует тот же `compute_candidates` + расчёт замен/AI-обоснований
    как и проектная панель, но возвращает плоский список с `from_project_*` полями."""
    pq = await session.execute(
        select(Project.id, Project.code, Project.name).where(Project.status == "active")
    )
    projects = list(pq.all())
    if not projects:
        return []

    items: list[GlobalRotationCandidate] = []

    # подгружаем имена пользователей-owner'ов для отображения
    all_owner_ids: set[int] = set()
    for pid, _code, _name in projects:
        candidates = await compute_candidates(session, pid)
        for c in candidates:
            all_owner_ids.add(c.owner_id)
    owner_name_by_id: dict[int, str] = {}
    if all_owner_ids:
        uq = await session.execute(
            select(User.id, User.full_name).where(User.id.in_(all_owner_ids))
        )
        owner_name_by_id = {uid: name for uid, name in uq.all()}

    for pid, code, name in projects:
        candidates = await compute_candidates(session, pid)
        if not candidates:
            continue

        emp_ids = [c.employee_id for c in candidates]

        sq = await session.execute(
            select(RotationSuggestion).where(
                RotationSuggestion.from_project_id == pid,
                RotationSuggestion.employee_id.in_(emp_ids),
            )
        )
        sug_by_emp: dict[int, RotationSuggestion] = {
            s.employee_id: s for s in sq.scalars()
        }

        aq = await session.execute(
            select(AIJob.employee_id).where(
                AIJob.kind == "rotation_suggestion",
                AIJob.target_id == pid,
                AIJob.employee_id.in_(emp_ids),
                AIJob.status.in_(("queued", "running")),
            )
        )
        running_emps = {eid for (eid,) in aq.all()}

        target_ids: set[int] = set()
        for s in sug_by_emp.values():
            for tid in (s.target_project_ids or []):
                target_ids.add(tid)
        target_info: dict[int, tuple[str, str | None]] = {}
        if target_ids:
            tpq = await session.execute(
                select(Project.id, Project.name, Project.code).where(
                    Project.id.in_(target_ids)
                )
            )
            target_info = {tid: (n, c) for tid, n, c in tpq.all()}

        for c in candidates:
            s = sug_by_emp.get(c.employee_id)
            targets = []
            if s:
                for tid in (s.target_project_ids or []):
                    nc = target_info.get(tid)
                    if nc is None:
                        continue
                    targets.append(
                        {"project_id": tid, "project_name": nc[0], "code": nc[1]}
                    )

            repl_assess = await assess_replacement_need(session, c.employee_id, pid)

            items.append(
                GlobalRotationCandidate(
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
                        {"competency_id": cid, "competency_name": cname}
                        for cid, cname in c.bus_factor_competencies
                    ],
                    rationale_md=s.rationale_md if s else None,
                    target_projects=targets,
                    suggestion_generated_at=s.generated_at if s else None,
                    suggestion_running=c.employee_id in running_emps,
                    replacement_needed=repl_assess.needed,
                    replacement_project_name=repl_assess.project_name,
                    replacement_role_keys_in_stack=[
                        {"competency_id": cid, "competency_name": cname}
                        for cid, cname in repl_assess.role_keys_in_stack
                    ],
                    from_project_id=pid,
                    from_project_code=code,
                    from_project_name=name,
                )
            )

    items.sort(key=lambda x: (-x.score, -x.tenure_months, x.full_name))
    return items


async def _required_approvers_product(
    session, employee_id: int, from_product_id: int, to_product_id: int
) -> set[int]:
    """Авто-вычисляемые согласующие для product-ротации:

      1) владелец исходного продукта (Product.created_by)
      2) владелец целевого продукта
      3) руководитель сотрудника (employee.owner_id)
      4) PM исходного продукта (Product.product_manager_id), если задан
      5) PM целевого продукта, если задан
    """
    from app.models.project import Product

    emp = await session.get(Employee, employee_id)
    if emp is None:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    fp = await session.get(Product, from_product_id)
    if fp is None:
        raise HTTPException(status_code=404, detail="Исходный продукт не найден")
    tp = await session.get(Product, to_product_id)
    if tp is None:
        raise HTTPException(status_code=404, detail="Целевой продукт не найден")
    approvers: set[int] = {fp.created_by, tp.created_by, emp.owner_id}
    if fp.product_manager_id is not None:
        approvers.add(fp.product_manager_id)
    if tp.product_manager_id is not None:
        approvers.add(tp.product_manager_id)
    return approvers


@lifecycle.get(
    "/approvers-preview", response_model=list[RotationApproverPreview]
)
async def approvers_preview(
    session: SessionDep,
    current_user: CurrentUser,
    employee_id: int = Query(...),
    from_product_id: int = Query(...),
    to_product_id: int = Query(...),
):
    """Предпросмотр авто-согласующих для ротации (до её создания).

    Показывает, кто будет согласовывать, и по какой причине (роль).
    Инициатор (current_user) помечается is_initiator — его голос
    проставится автоматически.
    """
    from app.models.project import Product

    emp = await session.get(Employee, employee_id)
    fp = await session.get(Product, from_product_id)
    tp = await session.get(Product, to_product_id)
    if emp is None or fp is None or tp is None:
        raise HTTPException(
            status_code=404, detail="Сотрудник или продукт не найден"
        )

    # user_id → список причин
    reasons: dict[int, list[str]] = {}

    def _add(uid: int | None, reason: str) -> None:
        if uid is None:
            return
        reasons.setdefault(uid, []).append(reason)

    _add(emp.owner_id, "руководитель сотрудника")
    _add(fp.created_by, "владелец продукта-источника")
    _add(fp.product_manager_id, "PM продукта-источника")
    _add(tp.created_by, "владелец целевого продукта")
    _add(tp.product_manager_id, "PM целевого продукта")

    if not reasons:
        return []

    uq = await session.execute(
        select(User.id, User.full_name).where(User.id.in_(reasons.keys()))
    )
    name_by_id = {uid: name for uid, name in uq.all()}

    return [
        RotationApproverPreview(
            user_id=uid,
            full_name=name_by_id.get(uid),
            reasons=rs,
            is_initiator=(uid == current_user.id),
        )
        for uid, rs in reasons.items()
    ]


async def _propose_rotation_for_product(
    payload: RotationCreate, session, current_user
) -> RotationPublic:
    """Создание ротации на уровне продукта."""
    from app.models.project import Product, ProductMember

    if payload.from_product_id == payload.to_product_id:
        raise HTTPException(
            status_code=400, detail="Целевой продукт совпадает с исходным"
        )

    pmq = await session.execute(
        select(ProductMember).where(
            ProductMember.employee_id == payload.employee_id,
            ProductMember.product_id == payload.from_product_id,
            ProductMember.left_at.is_(None),
        )
    )
    from_member = pmq.scalar_one_or_none()
    if from_member is None:
        raise HTTPException(
            status_code=400,
            detail="Сотрудник не в активном составе исходного продукта",
        )
    if from_member.rotation_locked:
        raise HTTPException(
            status_code=400, detail="Участник заморожен от ротации"
        )

    # Незакрытая ротация для пары (employee, from_product)?
    eq = await session.execute(
        select(Rotation).where(
            Rotation.employee_id == payload.employee_id,
            Rotation.from_product_id == payload.from_product_id,
            Rotation.status.in_(("proposed", "accepted")),
        )
    )
    if eq.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail="Уже есть незакрытая ротация для этой пары",
        )

    auto_approvers = await _required_approvers_product(
        session,
        payload.employee_id,
        payload.from_product_id,
        payload.to_product_id,
    )
    extra = set(payload.extra_approver_ids or [])
    extra.discard(current_user.id)
    extra -= auto_approvers
    if extra:
        valid_q = await session.execute(
            select(User.id).where(User.id.in_(extra), User.is_active.is_(True))
        )
        valid = {uid for (uid,) in valid_q.all()}
        unknown = extra - valid
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Согласующие не найдены: {sorted(unknown)}",
            )

    reason = (payload.reason_md or "").strip()
    if payload.replacement_employee_id:
        repl = await session.get(Employee, payload.replacement_employee_id)
        if repl is None:
            raise HTTPException(status_code=400, detail="Замена-сотрудник не найден")
        auto_approvers.add(repl.owner_id)

    approvers = auto_approvers | extra

    now = datetime.now(UTC)
    rot = Rotation(
        employee_id=payload.employee_id,
        from_project_id=None,  # ротация на уровне продукта
        to_project_id=None,
        from_product_id=payload.from_product_id,
        to_product_id=payload.to_product_id,
        status="proposed",
        reason_md=reason or None,
        initiated_by_id=current_user.id,
        proposed_at=now,
        planned_start_at=payload.planned_start_at,
        replacement_employee_id=payload.replacement_employee_id,
    )
    session.add(rot)
    await session.flush()

    pending = 0
    for uid in approvers:
        appr = RotationApproval(rotation_id=rot.id, user_id=uid)
        if uid == current_user.id:
            appr.decision = "approve"
            appr.decided_at = now
            appr.comment = "автосогласие инициатора"
        else:
            pending += 1
        session.add(appr)

    if pending == 0:
        rot.status = "accepted"
        rot.accepted_at = now

    emp_obj = await session.get(Employee, rot.employee_id)
    fp_obj = await session.get(Product, rot.from_product_id)
    tp_obj = await session.get(Product, rot.to_product_id)
    rot_link = f"/rotations?id={rot.id}"
    notifs = await record_notifications(
        session,
        recipient_user_ids=list(approvers),
        kind="rotation_proposed",
        title=f"Согласование ротации: {emp_obj.full_name if emp_obj else 'сотрудник'}",
        body=(
            f"{fp_obj.name if fp_obj else '?'} → {tp_obj.name if tp_obj else '?'}. "
            f"Инициатор: {current_user.full_name}"
        ),
        link=rot_link,
        payload={"rotation_id": rot.id},
        exclude_user_ids=[current_user.id],
    )

    await session.commit()
    await session.refresh(rot)
    await publish_pending(notifs)
    return await _to_rotation_public(session, rot)


@lifecycle.post("", response_model=RotationPublic, status_code=201)
async def propose_rotation(
    payload: RotationCreate, session: SessionDep, current_user: MutatorUser
):
    """Создать запрос на ротацию. Если согласований не требуется — сразу status='accepted'.

    Новый формат: payload.from_product_id + to_product_id (ротация между продуктами).
    Старый формат (deprecated после этапа 5): from_project_id + to_project_id.
    """
    # Ветка на уровне продукта.
    if payload.from_product_id is not None and payload.to_product_id is not None:
        return await _propose_rotation_for_product(payload, session, current_user)

    # Старая ветка (на уровне репо) — оставлена до полной миграции UI.
    if payload.from_project_id is None or payload.to_project_id is None:
        raise HTTPException(
            status_code=400,
            detail="Нужно указать либо (from_product_id, to_product_id), либо (from_project_id, to_project_id)",
        )
    if payload.from_project_id == payload.to_project_id:
        raise HTTPException(
            status_code=400, detail="Целевой проект совпадает с исходным"
        )

    pmq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.employee_id == payload.employee_id,
            ProjectMember.project_id == payload.from_project_id,
            ProjectMember.left_at.is_(None),
        )
    )
    from_member = pmq.scalar_one_or_none()
    if from_member is None:
        raise HTTPException(
            status_code=400, detail="Сотрудник не в активном составе исходного проекта"
        )
    if from_member.rotation_locked:
        raise HTTPException(
            status_code=400, detail="Участник заморожен от ротации"
        )

    # уже есть незакрытая ротация для этой пары?
    eq = await session.execute(
        select(Rotation).where(
            Rotation.employee_id == payload.employee_id,
            Rotation.from_project_id == payload.from_project_id,
            Rotation.status.in_(("proposed", "accepted")),
        )
    )
    if eq.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409, detail="Уже есть незакрытая ротация для этой пары"
        )

    auto_approvers = await _required_approvers(
        session,
        payload.employee_id,
        payload.from_project_id,
        payload.to_project_id,
    )
    extra = set(payload.extra_approver_ids or [])
    extra.discard(current_user.id)
    # extra не должен дублировать auto
    extra -= auto_approvers
    if extra:
        # проверим, что доп. согласующие — реальные активные юзеры
        valid_q = await session.execute(
            select(User.id).where(User.id.in_(extra), User.is_active.is_(True))
        )
        valid = {uid for (uid,) in valid_q.all()}
        unknown = extra - valid
        if unknown:
            raise HTTPException(
                status_code=400,
                detail=f"Согласующие не найдены: {sorted(unknown)}",
            )
    # Если выбрана замена — её руководитель тоже approver
    # (его сотрудника заберут на другой проект)
    reason = (payload.reason_md or "").strip()
    if payload.replacement_employee_id:
        repl = await session.get(Employee, payload.replacement_employee_id)
        if repl is None:
            raise HTTPException(status_code=400, detail="Замена-сотрудник не найден")
        auto_approvers.add(repl.owner_id)

    approvers = auto_approvers | extra

    now = datetime.now(UTC)
    rot = Rotation(
        employee_id=payload.employee_id,
        from_project_id=payload.from_project_id,
        to_project_id=payload.to_project_id,
        status="proposed",
        reason_md=reason or None,
        initiated_by_id=current_user.id,
        proposed_at=now,
        planned_start_at=payload.planned_start_at,
        replacement_employee_id=payload.replacement_employee_id,
    )
    session.add(rot)
    await session.flush()

    # Создаём строки согласований. Если approver == инициатор — авто-голос 'approve'.
    pending = 0
    for uid in approvers:
        appr = RotationApproval(rotation_id=rot.id, user_id=uid)
        if uid == current_user.id:
            appr.decision = "approve"
            appr.decided_at = now
            appr.comment = "автосогласие инициатора"
        else:
            pending += 1
        session.add(appr)

    # accepted, если все голоса уже approve (включая авто-голос инициатора)
    if pending == 0:
        rot.status = "accepted"
        rot.accepted_at = now

    # уведомление approver'ам (кроме инициатора)
    emp_obj = await session.get(Employee, rot.employee_id)
    fp_obj = await session.get(Project, rot.from_project_id)
    tp_obj = await session.get(Project, rot.to_project_id)
    rot_link = f"/rotations?id={rot.id}"
    notifs = await record_notifications(
        session,
        recipient_user_ids=list(approvers),
        kind="rotation_proposed",
        title=f"Согласование ротации: {emp_obj.full_name if emp_obj else 'сотрудник'}",
        body=(
            f"{fp_obj.name if fp_obj else '?'} → {tp_obj.name if tp_obj else '?'}. "
            f"Инициатор: {current_user.full_name}"
        ),
        link=rot_link,
        payload={"rotation_id": rot.id},
        exclude_user_ids=[current_user.id],
    )

    await session.commit()
    await session.refresh(rot)
    await publish_pending(notifs)
    return await _to_rotation_public(session, rot)


@lifecycle.get("/{rotation_id}", response_model=RotationPublic)
async def get_rotation(
    rotation_id: int, session: SessionDep, current_user: CurrentUser
):
    from app.api.deps import is_product_manager

    rot = await session.get(Rotation, rotation_id)
    if rot is None:
        raise HTTPException(status_code=404, detail="Ротация не найдена")
    if is_product_manager(current_user):
        appr_q = await session.execute(
            select(RotationApproval).where(
                RotationApproval.rotation_id == rotation_id,
                RotationApproval.user_id == current_user.id,
            )
        )
        if appr_q.scalar_one_or_none() is None:
            raise HTTPException(status_code=404, detail="Ротация не найдена")
    return await _to_rotation_public(session, rot)


@lifecycle.get("", response_model=list[RotationListItem])
async def list_rotations(
    session: SessionDep,
    current_user: CurrentUser,
    status: str | None = Query(default=None),
    employee_id: int | None = Query(default=None),
    project_id: int | None = Query(default=None),
):
    """Список ротаций. project_id фильтрует по from_project ИЛИ to_project.
    PM-продукт видит только те, где он числится в согласующих."""
    from app.api.deps import is_product_manager

    q = select(Rotation).order_by(Rotation.proposed_at.desc())
    if status:
        q = q.where(Rotation.status == status)
    if employee_id:
        q = q.where(Rotation.employee_id == employee_id)
    if project_id:
        from sqlalchemy import or_
        q = q.where(
            or_(Rotation.from_project_id == project_id, Rotation.to_project_id == project_id)
        )
    if is_product_manager(current_user):
        # ограничиваемся ротациями, где PM числится в согласующих
        q = q.where(
            Rotation.id.in_(
                select(RotationApproval.rotation_id).where(
                    RotationApproval.user_id == current_user.id
                )
            )
        )
    rq = await session.execute(q)
    rows = list(rq.scalars())
    if not rows:
        return []

    from app.models.project import Product

    emp_ids = {r.employee_id for r in rows}
    proj_ids = {r.from_project_id for r in rows if r.from_project_id} | {
        r.to_project_id for r in rows if r.to_project_id
    }
    prod_ids = {r.from_product_id for r in rows if r.from_product_id} | {
        r.to_product_id for r in rows if r.to_product_id
    }
    eq = await session.execute(
        select(Employee.id, Employee.full_name).where(Employee.id.in_(emp_ids))
    )
    emp_name = {eid: name for eid, name in eq.all()}
    pname: dict[int, str] = {}
    if proj_ids:
        pq = await session.execute(
            select(Project.id, Project.name).where(Project.id.in_(proj_ids))
        )
        pname = {pid: name for pid, name in pq.all()}
    prodname: dict[int, str] = {}
    if prod_ids:
        prq = await session.execute(
            select(Product.id, Product.name).where(Product.id.in_(prod_ids))
        )
        prodname = {pid: name for pid, name in prq.all()}

    return [
        RotationListItem(
            id=r.id,
            employee_id=r.employee_id,
            employee_name=emp_name.get(r.employee_id, ""),
            from_project_id=r.from_project_id,
            from_project_name=(
                pname.get(r.from_project_id) if r.from_project_id else None
            ),
            to_project_id=r.to_project_id,
            to_project_name=pname.get(r.to_project_id) if r.to_project_id else None,
            from_product_id=r.from_product_id,
            from_product_name=(
                prodname.get(r.from_product_id) if r.from_product_id else None
            ),
            to_product_id=r.to_product_id,
            to_product_name=(
                prodname.get(r.to_product_id) if r.to_product_id else None
            ),
            status=r.status,
            proposed_at=r.proposed_at,
            completed_at=r.completed_at,
        )
        for r in rows
    ]


@lifecycle.post("/{rotation_id}/approvals", response_model=RotationPublic)
async def submit_approval(
    rotation_id: int,
    payload: ApprovalDecision,
    session: SessionDep,
    current_user: MutatorUser,
):
    """Согласовать или отклонить ротацию.

    Голосовать может только тот, кто числится в требуемых approver'ах
    (запись в rotation_approvals с decision IS NULL)."""
    rot = await session.get(Rotation, rotation_id)
    if rot is None:
        raise HTTPException(status_code=404, detail="Ротация не найдена")
    if rot.status != "proposed":
        raise HTTPException(
            status_code=400, detail=f"Голосовать можно только в статусе proposed (сейчас {rot.status})"
        )

    aq = await session.execute(
        select(RotationApproval).where(
            RotationApproval.rotation_id == rotation_id,
            RotationApproval.user_id == current_user.id,
        )
    )
    appr = aq.scalar_one_or_none()
    if appr is None:
        raise HTTPException(
            status_code=403, detail="Вы не в списке согласующих этой ротации"
        )
    if appr.decision is not None:
        raise HTTPException(status_code=400, detail="Решение уже принято")

    now = datetime.now(UTC)
    appr.decision = payload.decision
    appr.decided_at = now
    appr.comment = (payload.comment or "").strip() or None

    notifs: list = []
    rot_link = f"/rotations?id={rot.id}"
    emp_obj = await session.get(Employee, rot.employee_id)
    if payload.decision == "reject":
        rot.status = "cancelled"
        rot.cancelled_at = now
        notifs = await record_notifications(
            session,
            recipient_user_ids=[rot.initiated_by_id],
            kind="rotation_rejected",
            title=f"Ротация отклонена: {emp_obj.full_name if emp_obj else 'сотрудник'}",
            body=(
                f"Отклонил: {current_user.full_name}"
                + (f". Причина: {appr.comment}" if appr.comment else "")
            ),
            link=rot_link,
            payload={"rotation_id": rot.id},
            exclude_user_ids=[current_user.id],
        )
    else:
        # все ли approve'нули?
        all_q = await session.execute(
            select(RotationApproval).where(RotationApproval.rotation_id == rotation_id)
        )
        all_appr = list(all_q.scalars())
        if all(a.decision == "approve" for a in all_appr):
            rot.status = "accepted"
            rot.accepted_at = now
            notifs = await record_notifications(
                session,
                recipient_user_ids=[rot.initiated_by_id],
                kind="rotation_accepted",
                title=f"Ротация согласована: {emp_obj.full_name if emp_obj else 'сотрудник'}",
                body="Все согласующие одобрили — можно завершать.",
                link=rot_link,
                payload={"rotation_id": rot.id},
                exclude_user_ids=[current_user.id],
            )

    await session.commit()
    await session.refresh(rot)
    await publish_pending(notifs)
    return await _to_rotation_public(session, rot)


@lifecycle.post("/{rotation_id}/cancel", response_model=RotationPublic)
async def cancel_rotation(
    rotation_id: int, session: SessionDep, current_user: MutatorUser
):
    """Отменить ротацию. Может только инициатор. Доступно в proposed/accepted (до completed)."""
    rot = await session.get(Rotation, rotation_id)
    if rot is None:
        raise HTTPException(status_code=404, detail="Ротация не найдена")
    if rot.status not in ("proposed", "accepted"):
        raise HTTPException(
            status_code=400, detail=f"Отменить можно только до завершения (сейчас {rot.status})"
        )
    if rot.initiated_by_id != current_user.id:
        raise HTTPException(status_code=403, detail="Отменить может только инициатор")

    rot.status = "cancelled"
    rot.cancelled_at = datetime.now(UTC)

    # уведомить approver'ов (кроме инициатора)
    appr_q = await session.execute(
        select(RotationApproval.user_id).where(
            RotationApproval.rotation_id == rotation_id
        )
    )
    approver_ids = [uid for (uid,) in appr_q.all()]
    emp_obj = await session.get(Employee, rot.employee_id)
    notifs = await record_notifications(
        session,
        recipient_user_ids=approver_ids,
        kind="rotation_cancelled",
        title=f"Ротация отменена: {emp_obj.full_name if emp_obj else 'сотрудник'}",
        body=f"Инициатор {current_user.full_name} отменил ротацию.",
        link=f"/rotations?id={rot.id}",
        payload={"rotation_id": rot.id},
        exclude_user_ids=[current_user.id],
    )
    await session.commit()
    await session.refresh(rot)
    await publish_pending(notifs)
    return await _to_rotation_public(session, rot)


@lifecycle.post("/{rotation_id}/complete", response_model=RotationPublic)
async def complete_rotation(
    rotation_id: int, session: SessionDep, current_user: MutatorUser
):
    """Зафиксировать факт ротации. Доступно в accepted.

    Эффект: на исходном membership ставится left_at=today, на целевом проекте
    создаётся (или обновляется) ProjectMember с joined_at=today, left_at=NULL."""
    rot = await session.get(Rotation, rotation_id)
    if rot is None:
        raise HTTPException(status_code=404, detail="Ротация не найдена")
    if rot.status != "accepted":
        raise HTTPException(
            status_code=400, detail=f"Завершить можно только из accepted (сейчас {rot.status})"
        )
    if rot.to_project_id is None:
        raise HTTPException(status_code=400, detail="Не задан целевой проект")

    today = date.today()

    fmq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.employee_id == rot.employee_id,
            ProjectMember.project_id == rot.from_project_id,
        )
    )
    from_pm = fmq.scalar_one_or_none()
    if from_pm is None:
        raise HTTPException(
            status_code=400, detail="Не найден membership в исходном проекте"
        )
    from_pm.left_at = today

    tmq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.employee_id == rot.employee_id,
            ProjectMember.project_id == rot.to_project_id,
        )
    )
    to_pm = tmq.scalar_one_or_none()
    if to_pm is None:
        to_pm = ProjectMember(
            project_id=rot.to_project_id,
            employee_id=rot.employee_id,
            joined_at=today,
            left_at=None,
        )
        session.add(to_pm)
    else:
        to_pm.joined_at = today
        to_pm.left_at = None

    rot.status = "completed"
    rot.completed_at = datetime.now(UTC)

    # уведомить approver'ов + владельца сотрудника
    appr_q = await session.execute(
        select(RotationApproval.user_id).where(
            RotationApproval.rotation_id == rotation_id
        )
    )
    approver_ids = [uid for (uid,) in appr_q.all()]
    emp_obj = await session.get(Employee, rot.employee_id)
    targets = list(set(approver_ids + [rot.initiated_by_id]))
    if emp_obj:
        targets.append(emp_obj.owner_id)
    fp_obj = await session.get(Project, rot.from_project_id)
    tp_obj = await session.get(Project, rot.to_project_id) if rot.to_project_id else None
    notifs = await record_notifications(
        session,
        recipient_user_ids=targets,
        kind="rotation_completed",
        title=f"Ротация завершена: {emp_obj.full_name if emp_obj else 'сотрудник'}",
        body=(
            f"{fp_obj.name if fp_obj else '?'} → {tp_obj.name if tp_obj else '?'}"
        ),
        link=f"/rotations?id={rot.id}",
        payload={"rotation_id": rot.id},
        exclude_user_ids=[current_user.id],
    )
    await session.commit()
    await session.refresh(rot)
    await publish_pending(notifs)
    return await _to_rotation_public(session, rot)


@lifecycle.post("/{rotation_id}/revert", response_model=RotationPublic)
async def revert_rotation(
    rotation_id: int, session: SessionDep, current_user: MutatorUser
):
    """Откатить факт ротации. Доступно в completed.

    Эффект: с исходного membership снимается left_at, целевое membership удаляется.
    Историческое присутствие в целевом проекте до ротации не восстанавливается —
    это сознательное упрощение."""
    rot = await session.get(Rotation, rotation_id)
    if rot is None:
        raise HTTPException(status_code=404, detail="Ротация не найдена")
    if rot.status != "completed":
        raise HTTPException(
            status_code=400, detail=f"Откатить можно только completed (сейчас {rot.status})"
        )

    fmq = await session.execute(
        select(ProjectMember).where(
            ProjectMember.employee_id == rot.employee_id,
            ProjectMember.project_id == rot.from_project_id,
        )
    )
    from_pm = fmq.scalar_one_or_none()
    if from_pm is not None:
        from_pm.left_at = None

    if rot.to_project_id is not None:
        tmq = await session.execute(
            select(ProjectMember).where(
                ProjectMember.employee_id == rot.employee_id,
                ProjectMember.project_id == rot.to_project_id,
            )
        )
        to_pm = tmq.scalar_one_or_none()
        if to_pm is not None:
            await session.delete(to_pm)

    rot.status = "reverted"
    rot.reverted_at = datetime.now(UTC)
    rot.reverted_by_id = current_user.id

    appr_q = await session.execute(
        select(RotationApproval.user_id).where(
            RotationApproval.rotation_id == rotation_id
        )
    )
    approver_ids = [uid for (uid,) in appr_q.all()]
    emp_obj = await session.get(Employee, rot.employee_id)
    targets = list(set(approver_ids + [rot.initiated_by_id]))
    if emp_obj:
        targets.append(emp_obj.owner_id)
    notifs = await record_notifications(
        session,
        recipient_user_ids=targets,
        kind="rotation_reverted",
        title=f"Ротация откачена: {emp_obj.full_name if emp_obj else 'сотрудник'}",
        body=f"Откат выполнил {current_user.full_name}",
        link=f"/rotations?id={rot.id}",
        payload={"rotation_id": rot.id},
        exclude_user_ids=[current_user.id],
    )
    await session.commit()
    await session.refresh(rot)
    await publish_pending(notifs)
    return await _to_rotation_public(session, rot)
