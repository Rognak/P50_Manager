from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from urllib.parse import quote

from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    can_view_employee_owned_by,
)
from app.config import settings
from app.exporters import markdown_to_docx, markdown_to_print_html
from app.models.employee import Employee
from app.models.mpk import (
    AIJob,
    Assessment,
    AssessmentScore,
    Competency,
    LearningResource,
    Meeting,
    MpkProcedure,
    RoleProfile,
    assessment_meetings,
    role_key_competencies,
)
from app.redis_pool import get_pool
from app.schemas.ai_job import AIJobPublic
from app.schemas.procedure import (
    ProcedureCreate,
    ProcedureListItem,
    ProcedurePublic,
    ProcedureSnapshot,
    ProcedureSnapshotItem,
    ProcedureUpdate,
)

router = APIRouter(prefix="/employees/{employee_id}/procedures", tags=["procedures"])


def _docx_disposition(filename: str) -> str:
    fallback = filename.encode("ascii", "ignore").decode("ascii") or "document.docx"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename)}"


async def _ensure_owner(session, employee_id: int, current_user) -> Employee:
    q = await session.execute(
        select(Employee)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .where(Employee.id == employee_id, Employee.kind == "employee")
    )
    emp = q.scalar_one_or_none()
    if emp is None or not can_view_employee_owned_by(current_user, emp.owner_id):
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return emp


async def _load_procedure(session, employee_id: int, procedure_id: int) -> MpkProcedure:
    q = await session.execute(
        select(MpkProcedure)
        .options(selectinload(MpkProcedure.meetings).selectinload(Meeting.assessments))
        .where(
            MpkProcedure.id == procedure_id,
            MpkProcedure.employee_id == employee_id,
        )
    )
    proc = q.scalar_one_or_none()
    if proc is None:
        raise HTTPException(status_code=404, detail="Процедура не найдена")
    return proc


def _to_public(proc: MpkProcedure) -> dict:
    assessment_ids: set[int] = set()
    meeting_ids: list[int] = []
    for m in proc.meetings:
        meeting_ids.append(m.id)
        for a in m.assessments:
            assessment_ids.add(a.id)
    return {
        "id": proc.id,
        "employee_id": proc.employee_id,
        "title": proc.title,
        "period_start": proc.period_start,
        "period_end": proc.period_end,
        "status": proc.status,
        "summary_md": proc.summary_md,
        "role_snapshot": proc.role_snapshot,
        "grade_snapshot": proc.grade_snapshot,
        "preparation_md": proc.preparation_md,
        "created_by": proc.created_by,
        "created_at": proc.created_at,
        "meeting_ids": meeting_ids,
        "assessment_ids": sorted(assessment_ids),
    }


@router.get("", response_model=list[ProcedureListItem])
async def list_procedures(employee_id: int, session: SessionDep, current_user: CurrentUser):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(MpkProcedure)
        .options(selectinload(MpkProcedure.meetings).selectinload(Meeting.assessments))
        .where(MpkProcedure.employee_id == employee_id)
        .order_by(MpkProcedure.created_at.desc())
    )
    procedures = list(q.scalars())
    result = []
    for proc in procedures:
        aids: set[int] = set()
        for m in proc.meetings:
            for a in m.assessments:
                aids.add(a.id)
        result.append(
            {
                "id": proc.id,
                "title": proc.title,
                "period_start": proc.period_start,
                "period_end": proc.period_end,
                "status": proc.status,
                "role_snapshot": proc.role_snapshot,
                "grade_snapshot": proc.grade_snapshot,
                "meetings_count": len(proc.meetings),
                "assessments_count": len(aids),
                "created_at": proc.created_at,
            }
        )
    return result


@router.post("", response_model=ProcedurePublic, status_code=status.HTTP_201_CREATED)
async def create_procedure(
    employee_id: int,
    payload: ProcedureCreate,
    session: SessionDep,
    current_user: MutatorUser,
):
    emp = await _ensure_owner(session, employee_id, current_user)
    open_q = await session.execute(
        select(MpkProcedure).where(
            MpkProcedure.employee_id == employee_id,
            MpkProcedure.status == "open",
        )
    )
    if open_q.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=400,
            detail="У сотрудника уже есть открытая процедура. Закройте её перед созданием новой.",
        )

    proc = MpkProcedure(
        employee_id=employee_id,
        title=payload.title.strip(),
        period_start=payload.period_start,
        period_end=payload.period_end,
        status="open",
        role_snapshot=emp.role.name if emp.role else None,
        grade_snapshot=emp.grade.code if emp.grade else None,
        created_by=current_user.id,
    )
    session.add(proc)
    await session.commit()
    await session.refresh(proc, attribute_names=["meetings"])
    return _to_public(proc)


@router.get("/{procedure_id}", response_model=ProcedurePublic)
async def get_procedure(
    employee_id: int,
    procedure_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _ensure_owner(session, employee_id, current_user)
    proc = await _load_procedure(session, employee_id, procedure_id)
    return _to_public(proc)


@router.patch("/{procedure_id}", response_model=ProcedurePublic)
async def update_procedure(
    employee_id: int,
    procedure_id: int,
    payload: ProcedureUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)
    proc = await _load_procedure(session, employee_id, procedure_id)

    data = payload.model_dump(exclude_unset=True)
    # переоткрытие закрытой процедуры допускается только если нет другой открытой
    if data.get("status") == "open" and proc.status == "closed":
        open_q = await session.execute(
            select(MpkProcedure).where(
                MpkProcedure.employee_id == employee_id,
                MpkProcedure.status == "open",
                MpkProcedure.id != procedure_id,
            )
        )
        if open_q.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=400,
                detail="Нельзя переоткрыть: уже есть другая открытая процедура.",
            )

    for key, value in data.items():
        setattr(proc, key, value)
    await session.commit()
    await session.refresh(proc, attribute_names=["meetings"])
    return _to_public(proc)


@router.delete("/{procedure_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_procedure(
    employee_id: int,
    procedure_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)
    proc = await _load_procedure(session, employee_id, procedure_id)
    await session.delete(proc)
    await session.commit()


@router.get("/{procedure_id}/snapshot", response_model=ProcedureSnapshot)
async def procedure_snapshot(
    employee_id: int,
    procedure_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    """Срез профиля в рамках процедуры: latest-per-competency по assessments,
    привязанным через её встречи. Плюс required_level по текущему role/grade для гэпов."""
    emp = await _ensure_owner(session, employee_id, current_user)
    proc = await _load_procedure(session, employee_id, procedure_id)

    meeting_ids = [m.id for m in proc.meetings]

    proc_by_comp: dict[int, int] = {}
    if meeting_ids:
        # latest-per-competency только среди scores тех assessments,
        # что связаны с встречами данной процедуры
        q = await session.execute(
            select(AssessmentScore.competency_id, AssessmentScore.level)
            .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
            .join(assessment_meetings, assessment_meetings.c.assessment_id == Assessment.id)
            .where(
                Assessment.employee_id == employee_id,
                assessment_meetings.c.meeting_id.in_(meeting_ids),
            )
            .order_by(
                AssessmentScore.competency_id,
                Assessment.assessed_at.desc(),
                Assessment.id.desc(),
            )
            .distinct(AssessmentScore.competency_id)
        )
        proc_by_comp = {cid: lvl for cid, lvl in q.all()}

    required_by_comp: dict[int, int] = {}
    if emp.role_id and emp.grade_id:
        pq = await session.execute(
            select(RoleProfile).where(
                RoleProfile.role_id == emp.role_id,
                RoleProfile.grade_id == emp.grade_id,
            )
        )
        for p in pq.scalars():
            required_by_comp[p.competency_id] = p.required_level

    comps_q = await session.execute(
        select(Competency).order_by(Competency.sort_order, Competency.id)
    )
    items: list[ProcedureSnapshotItem] = []
    for c in comps_q.scalars():
        proc_lvl = proc_by_comp.get(c.id)
        req = required_by_comp.get(c.id)
        gap = (
            (req - (proc_lvl if proc_lvl is not None else 0))
            if req is not None and proc_lvl is not None
            else None
        )
        items.append(
            ProcedureSnapshotItem(
                competency_id=c.id,
                competency_name=c.name,
                sort_order=c.sort_order,
                procedure_level=proc_lvl,
                required_level=req,
                gap=gap,
            )
        )

    return ProcedureSnapshot(items=items)


async def _build_preparation_context(session, employee: Employee, procedure: MpkProcedure) -> str:
    """Короткий контекст для материалов подготовки: компетенции процедуры с требуемыми
    уровнями и индикаторами + ресурсы обучения. Без истории оценок."""
    comps_q = await session.execute(
        select(Competency)
        .options(selectinload(Competency.criteria))
        .order_by(Competency.sort_order)
    )
    all_comps = list(comps_q.scalars())
    by_id = {c.id: c for c in all_comps}

    required_by_comp: dict[int, int] = {}
    if employee.role_id and employee.grade_id:
        pq = await session.execute(
            select(RoleProfile).where(
                RoleProfile.role_id == employee.role_id,
                RoleProfile.grade_id == employee.grade_id,
            )
        )
        for p in pq.scalars():
            required_by_comp[p.competency_id] = p.required_level

    key_ids: set[int] = set()
    if employee.role_id:
        kq = await session.execute(
            select(role_key_competencies.c.competency_id).where(
                role_key_competencies.c.role_id == employee.role_id
            )
        )
        key_ids = set(kq.scalars().all())

    # фокус: ключевые + те у кого required > 0
    focus_ids: list[int] = []
    for cid, req in required_by_comp.items():
        if req > 0:
            focus_ids.append(cid)

    # ресурсы по focus
    learning_by_comp: dict[int, list[LearningResource]] = {}
    if focus_ids:
        lr_q = await session.execute(
            select(LearningResource).where(LearningResource.competency_id.in_(focus_ids))
        )
        for lr in lr_q.scalars():
            learning_by_comp.setdefault(lr.competency_id, []).append(lr)

    role_name = procedure.role_snapshot or (employee.role.name if employee.role else "—")
    grade_code = procedure.grade_snapshot or (employee.grade.code if employee.grade else "—")

    lines: list[str] = [
        f"Сотрудник: {employee.full_name}",
        f"Роль: {role_name} / грейд: {grade_code}",
        f"Процедура МПК: «{procedure.title}»",
    ]
    if procedure.period_start or procedure.period_end:
        period = f"{procedure.period_start or '?'} — {procedure.period_end or '?'}"
        lines.append(f"Период: {period}")
    lines += [
        "",
        "Шкала уровней: 0 не требуется, 1 начальный, 2 базовый, 3 продвинутый, 4 экспертный, 5 выдающийся.",
        "",
        "КОМПЕТЕНЦИИ К ПРОВЕРКЕ (с индикаторами уровня):",
    ]
    for cid in focus_ids:
        c = by_id.get(cid)
        if c is None:
            continue
        req = required_by_comp.get(cid, 0)
        is_key = cid in key_ids
        prefix = "★ " if is_key else ""
        lines.append(f"\n[{c.id}] {prefix}{c.name} — целевой уровень {req}")
        if c.description:
            lines.append(f"  {c.description[:300]}")
        for cr in list(c.criteria)[:6]:
            lines.append(f"    {cr.order_num}. {cr.description[:250]}")

    if learning_by_comp:
        lines.append("")
        lines.append("ДОСТУПНЫЕ РЕСУРСЫ ОБУЧЕНИЯ:")
        for cid, resources in learning_by_comp.items():
            comp_name = by_id[cid].name if cid in by_id else f"#{cid}"
            lines.append(f"  {comp_name}:")
            for r in resources[:8]:
                lvls = ",".join(str(lv) for lv in (r.levels or []))
                lines.append(
                    f"    — {r.name} [{r.format or '—'}, {r.provider or '—'}, уровни: {lvls}]"
                    + (f" → {r.url}" if r.url else "")
                )

    return "\n".join(lines)


@router.post("/{procedure_id}/preparation/generate", response_model=AIJobPublic)
async def queue_preparation(
    employee_id: int,
    procedure_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)
    proc = await _load_procedure(session, employee_id, procedure_id)

    job = AIJob(
        kind="procedure_preparation",
        status="queued",
        employee_id=employee_id,
        target_kind="procedure",
        target_id=proc.id,
        payload={},
        created_by=current_user.id,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    pool = get_pool()
    await pool.enqueue_job("run_procedure_preparation", job.id)
    return job


@router.get("/{procedure_id}/preparation/export.docx")
async def export_preparation_docx(
    employee_id: int,
    procedure_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _ensure_owner(session, employee_id, current_user)
    proc = await _load_procedure(session, employee_id, procedure_id)
    if not proc.preparation_md:
        raise HTTPException(
            status_code=404, detail="Материалы не сгенерированы"
        )
    title = f"Материалы к процедуре «{proc.title}»"
    data = markdown_to_docx(proc.preparation_md, title)
    filename = f"{title[:80].replace('/', '_')}.docx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": _docx_disposition(filename)},
    )


@router.get("/{procedure_id}/preparation/print")
async def print_preparation(
    employee_id: int,
    procedure_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _ensure_owner(session, employee_id, current_user)
    proc = await _load_procedure(session, employee_id, procedure_id)
    if not proc.preparation_md:
        raise HTTPException(status_code=404, detail="Материалы не сгенерированы")
    title = f"Материалы к процедуре «{proc.title}»"
    meta = "Для самоподготовки сотрудника"
    html = markdown_to_print_html(proc.preparation_md, title, meta=meta)
    # используем сам settings для подавления warn
    _ = settings
    return HTMLResponse(html)
