"""Self-Review API: CRUD карточки, загрузка/скачивание DOCX, HTML-viewer, lifecycle."""

from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, UploadFile, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import select, update

from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    is_core_team,
)
from app.exporters import markdown_to_docx, markdown_to_print_html
from app.models.employee import Employee
from app.models.mpk import AIJob
from app.models.self_review import SelfReview
from app.models.user import User
from app.redis_pool import get_pool
from app.schemas.ai_job import AIJobPublic
from app.schemas.self_review import (
    SelfReviewCreate,
    SelfReviewListItem,
    SelfReviewPublic,
    SelfReviewUpdate,
)
from app.self_review.docx_render import extract_docx_text, render_docx_to_html

router = APIRouter(prefix="/employees/{employee_id}/self-reviews", tags=["self-review"])
global_router = APIRouter(prefix="/self-reviews", tags=["self-review"])

DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _docx_disposition(filename: str) -> str:
    fallback = filename.encode("ascii", "ignore").decode("ascii") or "self-review.docx"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename)}"


async def _load_employee(session, employee_id: int) -> Employee:
    emp = await session.get(Employee, employee_id)
    if emp is None:
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return emp


async def _load_review(session, employee_id: int, review_id: int) -> SelfReview:
    rv = await session.get(SelfReview, review_id)
    if rv is None or rv.employee_id != employee_id:
        raise HTTPException(status_code=404, detail="Self-Review не найден")
    return rv


def _to_public(rv: SelfReview, employee_name: str) -> SelfReviewPublic:
    return SelfReviewPublic(
        id=rv.id,
        employee_id=rv.employee_id,
        employee_name=employee_name,
        year=rv.year,
        status=rv.status,
        has_source=rv.source_data is not None,
        source_filename=rv.source_filename,
        source_size_bytes=rv.source_size_bytes,
        source_uploaded_at=rv.source_uploaded_at,
        project_score=rv.project_score,
        company_score=rv.company_score,
        manager_notes_md=rv.manager_notes_md,
        ai_topics_md=rv.ai_topics_md,
        ai_comparison_md=rv.ai_comparison_md,
        ai_burnout_md=rv.ai_burnout_md,
        ai_calibration_md=rv.ai_calibration_md,
        ai_drafting_md=rv.ai_drafting_md,
        submitted_at=rv.submitted_at,
        closed_at=rv.closed_at,
        scheduled_1on1_at=rv.scheduled_1on1_at,
        created_by=rv.created_by,
        created_at=rv.created_at,
    )


# ---------- CRUD ----------


@router.get("", response_model=list[SelfReviewListItem])
async def list_employee_reviews(employee_id: int, session: SessionDep, _current_user: CurrentUser):
    emp = await _load_employee(session, employee_id)
    q = await session.execute(
        select(SelfReview)
        .where(SelfReview.employee_id == employee_id)
        .order_by(SelfReview.year.desc())
    )
    rows = list(q.scalars())
    return [
        SelfReviewListItem(
            id=r.id,
            employee_id=r.employee_id,
            employee_name=emp.full_name,
            year=r.year,
            status=r.status,
            has_source=r.source_data is not None,
            project_score=r.project_score,
            company_score=r.company_score,
            submitted_at=r.submitted_at,
            closed_at=r.closed_at,
            scheduled_1on1_at=r.scheduled_1on1_at,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("", response_model=SelfReviewPublic, status_code=status.HTTP_201_CREATED)
async def create_review(
    employee_id: int,
    payload: SelfReviewCreate,
    session: SessionDep,
    current_user: MutatorUser,
):
    emp = await _load_employee(session, employee_id)
    existing = await session.execute(
        select(SelfReview).where(
            SelfReview.employee_id == employee_id,
            SelfReview.year == payload.year,
        )
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Self-Review за {payload.year} уже существует",
        )
    rv = SelfReview(
        employee_id=employee_id,
        year=payload.year,
        status="draft",
        project_score=payload.project_score,
        company_score=payload.company_score,
        manager_notes_md=payload.manager_notes_md,
        created_by=current_user.id,
    )
    session.add(rv)
    await session.commit()
    await session.refresh(rv)
    return _to_public(rv, emp.full_name)


@router.get("/{review_id}", response_model=SelfReviewPublic)
async def get_review(
    employee_id: int, review_id: int, session: SessionDep, _current_user: CurrentUser
):
    emp = await _load_employee(session, employee_id)
    rv = await _load_review(session, employee_id, review_id)
    return _to_public(rv, emp.full_name)


@router.patch("/{review_id}", response_model=SelfReviewPublic)
async def update_review(
    employee_id: int,
    review_id: int,
    payload: SelfReviewUpdate,
    session: SessionDep,
    _current_user: MutatorUser,
):
    emp = await _load_employee(session, employee_id)
    rv = await _load_review(session, employee_id, review_id)
    now = datetime.now(UTC)
    if payload.project_score is not None:
        rv.project_score = payload.project_score
    if payload.company_score is not None:
        rv.company_score = payload.company_score
    if payload.manager_notes_md is not None:
        rv.manager_notes_md = payload.manager_notes_md.strip() or None
    if "scheduled_1on1_at" in payload.model_fields_set:
        rv.scheduled_1on1_at = payload.scheduled_1on1_at
    if payload.status is not None and payload.status != rv.status:
        # status-переходы: draft → submitted → closed
        # без жёсткой машины состояний — для «своих» хватает свободного выбора,
        # но фиксируем timestamp'ы для аналитики
        if payload.status == "submitted" and rv.submitted_at is None:
            rv.submitted_at = now
        if payload.status == "closed" and rv.closed_at is None:
            rv.closed_at = now
        rv.status = payload.status
    await session.commit()
    await session.refresh(rv)
    return _to_public(rv, emp.full_name)


@router.delete("/{review_id}", status_code=204)
async def delete_review(
    employee_id: int, review_id: int, session: SessionDep, _current_user: MutatorUser
):
    rv = await _load_review(session, employee_id, review_id)
    await session.delete(rv)
    await session.commit()


# ---------- Источник: загрузка / скачивание / viewer ----------


@router.post("/{review_id}/source", response_model=SelfReviewPublic)
async def upload_source(
    employee_id: int,
    review_id: int,
    file: UploadFile,
    session: SessionDep,
    _current_user: MutatorUser,
):
    emp = await _load_employee(session, employee_id)
    rv = await _load_review(session, employee_id, review_id)
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл больше 10 МБ")
    name = (file.filename or "").lower()
    if not name.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Только .docx")
    # Извлекаем текст для AI — заодно валидируем что это docx
    try:
        text = extract_docx_text(raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Не удалось прочесть DOCX: {e}")

    rv.source_data = raw
    rv.source_filename = file.filename
    rv.source_content_type = file.content_type or DOCX_CONTENT_TYPE
    rv.source_size_bytes = len(raw)
    rv.source_uploaded_at = datetime.now(UTC)
    rv.source_text = text
    await session.commit()
    await session.refresh(rv)
    return _to_public(rv, emp.full_name)


@router.delete("/{review_id}/source", response_model=SelfReviewPublic)
async def delete_source(
    employee_id: int, review_id: int, session: SessionDep, _current_user: MutatorUser
):
    emp = await _load_employee(session, employee_id)
    rv = await _load_review(session, employee_id, review_id)
    rv.source_data = None
    rv.source_filename = None
    rv.source_content_type = None
    rv.source_size_bytes = None
    rv.source_uploaded_at = None
    rv.source_text = None
    await session.commit()
    await session.refresh(rv)
    return _to_public(rv, emp.full_name)


@router.get("/{review_id}/source")
async def download_source(
    employee_id: int, review_id: int, session: SessionDep, _current_user: CurrentUser
):
    rv = await _load_review(session, employee_id, review_id)
    if rv.source_data is None:
        raise HTTPException(status_code=404, detail="Файл не приложен")
    filename = rv.source_filename or f"self-review-{rv.year}.docx"
    return Response(
        content=rv.source_data,
        media_type=rv.source_content_type or DOCX_CONTENT_TYPE,
        headers={"Content-Disposition": _docx_disposition(filename)},
    )


@router.get("/{review_id}/viewer", response_class=HTMLResponse)
async def view_source_html(
    employee_id: int, review_id: int, session: SessionDep, _current_user: CurrentUser
):
    """HTML-рендер оригинального DOCX через mammoth — для встраивания во вьюер."""
    rv = await _load_review(session, employee_id, review_id)
    if rv.source_data is None:
        raise HTTPException(status_code=404, detail="Файл не приложен")
    try:
        html = render_docx_to_html(rv.source_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка конвертации: {e}")
    return HTMLResponse(content=html)


# ---------- Экспорт сводки 1:1 ----------


_STATUS_LABEL = {"draft": "черновик", "submitted": "отправлен", "closed": "закрыт"}


def _build_summary_md(rv: SelfReview, emp_name: str) -> tuple[str, str]:
    """Возвращает (markdown_text, заголовок_для_документа)."""
    parts: list[str] = []
    title = f"Self-Review {rv.year} — {emp_name}"
    parts.append(f"# {title}")
    parts.append("")
    parts.append(f"**Статус:** {_STATUS_LABEL.get(rv.status, rv.status)}")
    if rv.submitted_at:
        parts.append(f"**Отправлен:** {rv.submitted_at.strftime('%d.%m.%Y')}")
    if rv.closed_at:
        parts.append(f"**Закрыт:** {rv.closed_at.strftime('%d.%m.%Y')}")
    parts.append("")

    parts.append("## Самооценки 1–10")
    parts.append(
        f"- По проекту: **{rv.project_score if rv.project_score is not None else '—'}** / 10"
    )
    parts.append(
        f"- По компании: **{rv.company_score if rv.company_score is not None else '—'}** / 10"
    )
    parts.append("")

    if rv.manager_notes_md:
        parts.append("## Заметки руководителя")
        parts.append(rv.manager_notes_md)
        parts.append("")

    ai_sections = [
        ("AI: Темы для 1:1", rv.ai_topics_md),
        ("AI: Сравнение с прошлым годом", rv.ai_comparison_md),
        ("AI: Калибровка с МПК", rv.ai_calibration_md),
        ("AI: Анализ выгорания и вовлечённости", rv.ai_burnout_md),
        ("AI: Черновик self-review", rv.ai_drafting_md),
    ]
    for heading, body in ai_sections:
        if body and body.strip():
            parts.append(f"## {heading}")
            parts.append(body)
            parts.append("")

    if rv.source_filename:
        parts.append(f"---\n_Оригинал .docx: **{rv.source_filename}** (хранится в системе)._")

    return "\n".join(parts), title


@router.get("/{review_id}/summary.docx")
async def export_summary_docx(
    employee_id: int, review_id: int, session: SessionDep, _current_user: CurrentUser
):
    """Сводный DOCX по 1:1: scores + заметки + AI-выводы. Для архива/HR."""
    emp = await _load_employee(session, employee_id)
    rv = await _load_review(session, employee_id, review_id)
    md, title = _build_summary_md(rv, emp.full_name)
    blob = markdown_to_docx(md, title)
    filename = f"Self-Review {rv.year} {emp.full_name} — сводка.docx"
    return Response(
        content=blob,
        media_type=DOCX_CONTENT_TYPE,
        headers={"Content-Disposition": _docx_disposition(filename)},
    )


@router.get("/{review_id}/summary/print", response_class=HTMLResponse)
async def export_summary_print_html(
    employee_id: int, review_id: int, session: SessionDep, _current_user: CurrentUser
):
    """Печатная HTML-версия сводки (для PDF через печать браузера)."""
    emp = await _load_employee(session, employee_id)
    rv = await _load_review(session, employee_id, review_id)
    md, title = _build_summary_md(rv, emp.full_name)
    meta = f"Год {rv.year} · статус: {_STATUS_LABEL.get(rv.status, rv.status)}"
    html = markdown_to_print_html(md, title, meta)
    return HTMLResponse(content=html)


# ---------- AI-задачи ----------


_AI_KIND_BY_PATH: dict[str, tuple[str, str]] = {
    # path-suffix : (job_kind, function_name)
    "topics": ("self_review_topics", "run_self_review_topics"),
    "compare": ("self_review_compare", "run_self_review_compare"),
    "burnout": ("self_review_burnout", "run_self_review_burnout"),
    "calibration": ("self_review_calibration", "run_self_review_calibration"),
    "draft": ("self_review_draft", "run_self_review_draft"),
}


async def _enqueue_ai(
    session,
    rv: SelfReview,
    kind_suffix: str,
    current_user_id: int,
) -> AIJob:
    job_kind, func_name = _AI_KIND_BY_PATH[kind_suffix]
    now = datetime.now(UTC)

    # авто-чистка зависших: queued/running старше 15 минут — помечаем error
    # (типичный сценарий: воркер крашнулся/выключен, фронт смотрит в null)
    stale_cutoff = now - timedelta(minutes=15)
    await session.execute(
        update(AIJob)
        .where(
            AIJob.kind == job_kind,
            AIJob.target_kind == "self_review",
            AIJob.target_id == rv.id,
            AIJob.status.in_(("queued", "running")),
            AIJob.created_at < stale_cutoff,
        )
        .values(status="error", error="зависшая задача — таймаут", finished_at=now)
    )
    await session.commit()

    # одной активной задачи (свежей) достаточно
    aq = await session.execute(
        select(AIJob).where(
            AIJob.kind == job_kind,
            AIJob.target_kind == "self_review",
            AIJob.target_id == rv.id,
            AIJob.status.in_(("queued", "running")),
        )
    )
    existing = aq.scalar_one_or_none()
    if existing is not None:
        return existing
    job = AIJob(
        kind=job_kind,
        status="queued",
        employee_id=rv.employee_id,
        target_kind="self_review",
        target_id=rv.id,
        payload={},
        created_by=current_user_id,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    pool = get_pool()
    await pool.enqueue_job(func_name, job.id)
    return job


@router.post("/{review_id}/ai/{kind}", response_model=AIJobPublic, status_code=202)
async def enqueue_ai_task(
    employee_id: int,
    review_id: int,
    kind: str,
    session: SessionDep,
    current_user: MutatorUser,
):
    if kind not in _AI_KIND_BY_PATH:
        raise HTTPException(status_code=404, detail="Неизвестная AI-задача")
    rv = await _load_review(session, employee_id, review_id)
    if kind in ("topics", "compare", "burnout", "calibration") and not rv.source_text:
        raise HTTPException(
            status_code=400,
            detail="Сначала загрузите DOCX-файл Self-Review (вкладка «Файл»).",
        )
    job = await _enqueue_ai(session, rv, kind, current_user.id)
    return AIJobPublic.model_validate(job)


# ---------- Глобальный список ----------


@global_router.get("", response_model=list[SelfReviewListItem])
async def list_all_reviews(
    session: SessionDep,
    current_user: CurrentUser,
    year: int | None = None,
    status: str | None = None,
):
    """Список ревью.
    • Руководитель отдела видит только свои (Employee.owner_id == self).
    • CoreTeam видит все — с указанием руководителя для фильтрации на UI.
    """
    q = (
        select(SelfReview, Employee.full_name, Employee.owner_id, User.full_name)
        .join(Employee, Employee.id == SelfReview.employee_id)
        .join(User, User.id == Employee.owner_id)
        .order_by(SelfReview.year.desc(), Employee.full_name)
    )
    if not is_core_team(current_user):
        q = q.where(Employee.owner_id == current_user.id)
    if year is not None:
        q = q.where(SelfReview.year == year)
    if status:
        q = q.where(SelfReview.status == status)
    rows = (await session.execute(q)).all()
    return [
        SelfReviewListItem(
            id=r.id,
            employee_id=r.employee_id,
            employee_name=emp_name,
            owner_id=owner_id,
            owner_name=owner_name,
            year=r.year,
            status=r.status,
            has_source=r.source_data is not None,
            project_score=r.project_score,
            company_score=r.company_score,
            submitted_at=r.submitted_at,
            closed_at=r.closed_at,
            scheduled_1on1_at=r.scheduled_1on1_at,
            created_at=r.created_at,
        )
        for r, emp_name, owner_id, owner_name in rows
    ]
