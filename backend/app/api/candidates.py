"""Hiring API: кандидаты, резюме, lifecycle (hire/reject), AI-задачи."""

from datetime import UTC, date, datetime
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, UploadFile, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    can_view_employee_owned_by,
)
from app.candidates.resume import extract_resume_text
from app.self_review.docx_render import render_docx_to_html
from app.models.candidate import CandidateProfile
from app.models.employee import Employee
from app.models.mpk import AIJob, Grade, Role
from app.models.project import Project
from app.models.vacancy import Vacancy
from app.redis_pool import get_pool
from app.schemas.ai_job import AIJobPublic
from app.schemas.candidate import (
    CandidateCreate,
    CandidateDecisionUpdate,
    CandidateListItem,
    CandidatePublic,
    CandidateRejectBody,
    CandidateUpdate,
)

router = APIRouter(prefix="/candidates", tags=["candidates"])

DEFAULT_RESUME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _disposition(filename: str) -> str:
    fallback = filename.encode("ascii", "ignore").decode("ascii") or "resume"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename)}"


async def _load_owned(
    session, candidate_id: int, current_user
) -> tuple[Employee, CandidateProfile]:
    """Кандидата можно открыть и после найма — для просмотра истории.
    Изменять stage нельзя (UI запрещает), но детали остаются доступны."""
    q = await session.execute(
        select(Employee, CandidateProfile)
        .join(CandidateProfile, CandidateProfile.employee_id == Employee.id)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .where(Employee.id == candidate_id)
    )
    row = q.first()
    if row is None:
        raise HTTPException(status_code=404, detail="Кандидат не найден")
    emp, prof = row
    if not can_view_employee_owned_by(current_user, emp.owner_id):
        raise HTTPException(status_code=404, detail="Кандидат не найден")
    return emp, prof


async def _to_public(session, emp: Employee, prof: CandidateProfile) -> CandidatePublic:
    expected_role = None
    if prof.expected_role_id:
        r = await session.get(Role, prof.expected_role_id)
        if r is not None:
            expected_role = r
    expected_grade = None
    if prof.expected_grade_id:
        g = await session.get(Grade, prof.expected_grade_id)
        if g is not None:
            expected_grade = g

    vacancy_ref = None
    if prof.vacancy_id:
        v = await session.get(Vacancy, prof.vacancy_id)
        if v is not None:
            project_name = None
            if v.project_id:
                pr = await session.get(Project, v.project_id)
                project_name = pr.name if pr else None
            vacancy_ref = {
                "id": v.id,
                "title": v.title,
                "status": v.status,
                "project_id": v.project_id,
                "project_name": project_name,
            }

    return CandidatePublic.model_validate(
        {
            "id": emp.id,
            "employee_id": emp.id,
            "full_name": emp.full_name,
            "email": emp.email,
            "position": emp.position,
            "owner_id": emp.owner_id,
            "stage": prof.stage,
            "source": prof.source,
            "vacancy": vacancy_ref,
            "expected_role": expected_role,
            "expected_grade": expected_grade,
            "has_resume": prof.resume_data is not None,
            "resume_filename": prof.resume_filename,
            "resume_size_bytes": prof.resume_size_bytes,
            "resume_uploaded_at": prof.resume_uploaded_at,
            "ai_screening_recommended": prof.ai_screening_recommended,
            "ai_screening_reasoning_md": prof.ai_screening_reasoning_md,
            "ai_screening_at": prof.ai_screening_at,
            "feedback_decision": prof.feedback_decision,
            "rejection_reason_md": prof.rejection_reason_md,
            "hired_at": emp.hired_at,
            "created_at": emp.created_at,
        }
    )


# ---------- CRUD ----------


@router.get("", response_model=list[CandidateListItem])
async def list_candidates(
    session: SessionDep,
    current_user: CurrentUser,
    stage: str | None = None,
    manager_id: int | None = None,
):
    """Кандидаты руководителя. Для core_team — выбранного manager_id; иначе пусто."""
    from app.api.deps import effective_owner_id, is_core_team

    owner_id = effective_owner_id(current_user, manager_id)
    if owner_id is None and is_core_team(current_user):
        return []
    q = (
        select(Employee, CandidateProfile, Role.name, Grade.code, Vacancy.title)
        .join(CandidateProfile, CandidateProfile.employee_id == Employee.id)
        .outerjoin(Role, Role.id == CandidateProfile.expected_role_id)
        .outerjoin(Grade, Grade.id == CandidateProfile.expected_grade_id)
        .outerjoin(Vacancy, Vacancy.id == CandidateProfile.vacancy_id)
    )
    if owner_id is not None:
        q = q.where(Employee.owner_id == owner_id)
    if stage:
        q = q.where(CandidateProfile.stage == stage)
    q = q.order_by(Employee.created_at.desc())
    rows = (await session.execute(q)).all()
    return [
        CandidateListItem(
            id=emp.id,
            full_name=emp.full_name,
            email=emp.email,
            position=emp.position,
            stage=prof.stage,
            source=prof.source,
            vacancy_id=prof.vacancy_id,
            vacancy_title=vac_title,
            expected_role_name=role_name,
            expected_grade_code=grade_code,
            has_resume=prof.resume_data is not None,
            ai_screening_recommended=prof.ai_screening_recommended,
            feedback_decision=prof.feedback_decision,
            created_at=emp.created_at,
        )
        for emp, prof, role_name, grade_code, vac_title in rows
    ]


@router.post("", response_model=CandidatePublic, status_code=status.HTTP_201_CREATED)
async def create_candidate(
    payload: CandidateCreate, session: SessionDep, current_user: MutatorUser
):
    # Если указана вакансия — валидируем и подтягиваем role/grade как дефолт
    expected_role_id = payload.expected_role_id
    expected_grade_id = payload.expected_grade_id
    if payload.vacancy_id is not None:
        v = await session.get(Vacancy, payload.vacancy_id)
        if v is None:
            raise HTTPException(status_code=400, detail="Вакансия не найдена")
        if expected_role_id is None and v.role_id is not None:
            expected_role_id = v.role_id
        if expected_grade_id is None and v.grade_id is not None:
            expected_grade_id = v.grade_id

    emp = Employee(
        full_name=payload.full_name.strip(),
        email=(payload.email or "").strip() or None,
        position=(payload.position or "").strip() or None,
        owner_id=current_user.id,
        kind="candidate",
    )
    session.add(emp)
    await session.flush()

    prof = CandidateProfile(
        employee_id=emp.id,
        source=(payload.source or "").strip() or None,
        vacancy_id=payload.vacancy_id,
        expected_role_id=expected_role_id,
        expected_grade_id=expected_grade_id,
        stage="new",
    )
    session.add(prof)
    await session.commit()
    await session.refresh(emp)
    await session.refresh(prof)
    return await _to_public(session, emp, prof)


@router.get("/{candidate_id}", response_model=CandidatePublic)
async def get_candidate(candidate_id: int, session: SessionDep, current_user: CurrentUser):
    emp, prof = await _load_owned(session, candidate_id, current_user)
    return await _to_public(session, emp, prof)


@router.patch("/{candidate_id}", response_model=CandidatePublic)
async def update_candidate(
    candidate_id: int,
    payload: CandidateUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    emp, prof = await _load_owned(session, candidate_id, current_user)
    data = payload.model_dump(exclude_unset=True)
    # employee-поля
    for f in ("full_name", "email", "position"):
        if f in data:
            v = data[f]
            if isinstance(v, str):
                v = v.strip() or None
            setattr(emp, f, v)
    # vacancy_id: валидируем существование, если задано
    if "vacancy_id" in data:
        new_vid = data["vacancy_id"]
        if new_vid is not None:
            v = await session.get(Vacancy, new_vid)
            if v is None:
                raise HTTPException(status_code=400, detail="Вакансия не найдена")
        prof.vacancy_id = new_vid
    # profile-поля
    for f in ("stage", "source", "expected_role_id", "expected_grade_id"):
        if f in data:
            setattr(prof, f, data[f])
    await session.commit()
    await session.refresh(emp)
    await session.refresh(prof)
    return await _to_public(session, emp, prof)


@router.delete("/{candidate_id}", status_code=204)
async def delete_candidate(candidate_id: int, session: SessionDep, current_user: MutatorUser):
    emp, _ = await _load_owned(session, candidate_id, current_user)
    await session.delete(emp)
    await session.commit()


# ---------- Резюме ----------


@router.post("/{candidate_id}/resume", response_model=CandidatePublic)
async def upload_resume(
    candidate_id: int,
    file: UploadFile,
    session: SessionDep,
    current_user: MutatorUser,
):
    emp, prof = await _load_owned(session, candidate_id, current_user)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл больше 10 МБ")
    fname = file.filename or "resume"
    try:
        text = extract_resume_text(raw, file.content_type, fname)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    prof.resume_data = raw
    prof.resume_filename = fname
    prof.resume_content_type = file.content_type
    prof.resume_size_bytes = len(raw)
    prof.resume_uploaded_at = datetime.now(UTC)
    prof.resume_text = text
    await session.commit()
    await session.refresh(prof)
    return await _to_public(session, emp, prof)


@router.delete("/{candidate_id}/resume", response_model=CandidatePublic)
async def delete_resume(candidate_id: int, session: SessionDep, current_user: MutatorUser):
    emp, prof = await _load_owned(session, candidate_id, current_user)
    prof.resume_data = None
    prof.resume_filename = None
    prof.resume_content_type = None
    prof.resume_size_bytes = None
    prof.resume_uploaded_at = None
    prof.resume_text = None
    await session.commit()
    await session.refresh(prof)
    return await _to_public(session, emp, prof)


@router.get("/{candidate_id}/resume")
async def download_resume(candidate_id: int, session: SessionDep, current_user: CurrentUser):
    _, prof = await _load_owned(session, candidate_id, current_user)
    if prof.resume_data is None:
        raise HTTPException(status_code=404, detail="Резюме не приложено")
    filename = prof.resume_filename or "resume"
    return Response(
        content=prof.resume_data,
        media_type=prof.resume_content_type or DEFAULT_RESUME_TYPE,
        headers={"Content-Disposition": _disposition(filename)},
    )


@router.get("/{candidate_id}/resume/viewer", response_class=HTMLResponse)
async def view_resume_html(candidate_id: int, session: SessionDep, _current_user: CurrentUser):
    """HTML-рендер DOCX-резюме через mammoth. Для PDF клиент использует
    `/resume` напрямую (blob → iframe)."""
    _, prof = await _load_owned(session, candidate_id, _current_user)
    if prof.resume_data is None:
        raise HTTPException(status_code=404, detail="Резюме не приложено")
    name = (prof.resume_filename or "").lower()
    if not name.endswith(".docx"):
        raise HTTPException(
            status_code=400,
            detail="HTML-рендер только для .docx. Для PDF — встраивайте напрямую через /resume.",
        )
    try:
        html = render_docx_to_html(prof.resume_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка конвертации: {e}")
    return HTMLResponse(content=html)


# ---------- Lifecycle: hire / reject / feedback ----------


@router.post("/{candidate_id}/hire", response_model=CandidatePublic)
async def hire_candidate(candidate_id: int, session: SessionDep, current_user: MutatorUser):
    """Превращает кандидата в действующего сотрудника.

    kind='employee', hired_at=today, role_id/grade_id берутся из expected_*,
    стадия профиля → 'hired'. Сам профиль остаётся как исторический след."""
    emp, prof = await _load_owned(session, candidate_id, current_user)
    emp.kind = "employee"
    emp.hired_at = date.today()
    if emp.role_id is None and prof.expected_role_id is not None:
        emp.role_id = prof.expected_role_id
    if emp.grade_id is None and prof.expected_grade_id is not None:
        emp.grade_id = prof.expected_grade_id
    prof.stage = "hired"
    if prof.feedback_decision is None:
        prof.feedback_decision = "positive"
    await session.commit()
    await session.refresh(emp)
    await session.refresh(prof)
    return await _to_public(session, emp, prof)


@router.post("/{candidate_id}/reject", response_model=CandidatePublic)
async def reject_candidate(
    candidate_id: int,
    payload: CandidateRejectBody,
    session: SessionDep,
    current_user: MutatorUser,
):
    emp, prof = await _load_owned(session, candidate_id, current_user)
    prof.stage = "rejected"
    prof.rejection_reason_md = (payload.reason_md or "").strip() or None
    if prof.feedback_decision is None:
        prof.feedback_decision = "negative"
    await session.commit()
    await session.refresh(prof)
    return await _to_public(session, emp, prof)


@router.patch("/{candidate_id}/decision", response_model=CandidatePublic)
async def update_decision(
    candidate_id: int,
    payload: CandidateDecisionUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    """Ручная правка финального решения по кандидату (positive/negative + причина)."""
    emp, prof = await _load_owned(session, candidate_id, current_user)
    data = payload.model_dump(exclude_unset=True)
    if "feedback_decision" in data:
        prof.feedback_decision = data["feedback_decision"]
    if "rejection_reason_md" in data:
        prof.rejection_reason_md = (data["rejection_reason_md"] or "").strip() or None
    await session.commit()
    await session.refresh(prof)
    return await _to_public(session, emp, prof)


# ---------- AI ----------


_AI_KIND: dict[str, tuple[str, str, bool]] = {
    # path: (job_kind, function_name, requires_resume_text)
    "screening": ("candidate_screening", "run_candidate_screening", True),
}


@router.post("/{candidate_id}/ai/{kind}", response_model=AIJobPublic, status_code=202)
async def enqueue_ai(
    candidate_id: int,
    kind: str,
    session: SessionDep,
    current_user: MutatorUser,
):
    if kind not in _AI_KIND:
        raise HTTPException(status_code=404, detail="Неизвестная AI-задача")
    emp, prof = await _load_owned(session, candidate_id, current_user)
    job_kind, func_name, needs_resume = _AI_KIND[kind]
    if needs_resume and not prof.resume_text:
        raise HTTPException(
            status_code=400,
            detail="Сначала загрузите резюме (.docx или .pdf)",
        )
    # дедуп
    aq = await session.execute(
        select(AIJob).where(
            AIJob.kind == job_kind,
            AIJob.target_kind == "candidate",
            AIJob.target_id == emp.id,
            AIJob.status.in_(("queued", "running")),
        )
    )
    existing = aq.scalar_one_or_none()
    if existing is not None:
        return AIJobPublic.model_validate(existing)
    job = AIJob(
        kind=job_kind,
        status="queued",
        employee_id=emp.id,
        target_kind="candidate",
        target_id=emp.id,
        payload={},
        created_by=current_user.id,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    pool = get_pool()
    await pool.enqueue_job(func_name, job.id)
    return AIJobPublic.model_validate(job)
