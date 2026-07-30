from urllib.parse import quote

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.ai.client import get_client
from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    can_view_employee_owned_by,
)
from app.exporters import markdown_to_docx, markdown_to_print_html
from app.models.employee import Employee
from app.models.mpk import (
    AIJob,
    Assessment,
    AssessmentScore,
    Competency,
    LearningResource,
    Meeting,
    MeetingArtifact,
    MpkProcedure,
    Recommendation,
    RoleProfile,
)
from app.redis_pool import get_pool
from app.schemas.ai_job import AIJobPublic
from app.schemas.recommendation import (
    RecommendationGenerateRequest,
    RecommendationListItem,
    RecommendationPublic,
)

router = APIRouter(
    prefix="/employees/{employee_id}/recommendations", tags=["recommendations"]
)


def _docx_disposition(filename: str) -> str:
    """RFC 5987 encoding для не-latin1 имён файлов."""
    fallback = filename.encode("ascii", "ignore").decode("ascii") or "document.docx"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename)}"


def _format_artifact_kind(kind: str) -> str:
    """Человекочитаемое название материала встречи."""
    return {
        "note": "Заметка",
        "decision": "Решение",
        "action_item": "Действие",
    }.get(kind, kind.replace("_", " ").capitalize())


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


async def _legacy_unused_build_context(
    session, employee: Employee
) -> tuple[str, dict]:
    """Собирает богатый контекст для генерации рекомендаций + сводку для хранения."""
    # current (latest per competency)
    cur_q = await session.execute(
        select(AssessmentScore.competency_id, AssessmentScore.level)
        .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
        .where(Assessment.employee_id == employee.id)
        .order_by(
            AssessmentScore.competency_id,
            Assessment.assessed_at.desc(),
            Assessment.id.desc(),
        )
        .distinct(AssessmentScore.competency_id)
    )
    current_by_comp: dict[int, int] = {cid: lvl for cid, lvl in cur_q.all()}

    # required
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

    # comps
    comps_q = await session.execute(
        select(Competency)
        .options(selectinload(Competency.criteria))
        .order_by(Competency.sort_order)
    )
    all_comps = list(comps_q.scalars())
    by_id = {c.id: c for c in all_comps}

    # assessments history (дата + сколько оценено)
    hist_q = await session.execute(
        select(Assessment)
        .options(selectinload(Assessment.scores))
        .where(Assessment.employee_id == employee.id)
        .order_by(Assessment.assessed_at.desc())
        .limit(10)
    )
    history = list(hist_q.scalars())

    # последние 3 завершённые встречи с артефактами и транскриптами
    meet_q = await session.execute(
        select(Meeting)
        .options(selectinload(Meeting.procedure))
        .where(Meeting.employee_id == employee.id, Meeting.status == "done")
        .order_by(Meeting.scheduled_at.desc())
        .limit(3)
    )
    meetings = list(meet_q.scalars())
    meeting_ids = [m.id for m in meetings]

    artifacts_by_meeting: dict[int, list[MeetingArtifact]] = {}
    if meeting_ids:
        art_q = await session.execute(
            select(MeetingArtifact).where(MeetingArtifact.meeting_id.in_(meeting_ids))
        )
        for a in art_q.scalars():
            artifacts_by_meeting.setdefault(a.meeting_id, []).append(a)

    # learning resources для компетенций с gap > 0
    gap_comp_ids: list[int] = []
    for cid, req in required_by_comp.items():
        cur = current_by_comp.get(cid, 0)
        if req - cur > 0:
            gap_comp_ids.append(cid)
    learning_by_comp: dict[int, list[LearningResource]] = {}
    if gap_comp_ids:
        lr_q = await session.execute(
            select(LearningResource)
            .where(LearningResource.competency_id.in_(gap_comp_ids))
            .limit(60)
        )
        for lr in lr_q.scalars():
            learning_by_comp.setdefault(lr.competency_id, []).append(lr)

    # build context text
    role_name = employee.role.name if employee.role else "—"
    grade_code = employee.grade.code if employee.grade else "—"
    lines: list[str] = [
        f"Сотрудник: {employee.full_name}",
        f"Должность: {employee.position or '—'}",
        f"Роль: {role_name} / грейд: {grade_code}",
        "",
        "Шкала уровней: 0 не требуется, 1 начальный, 2 базовый, 3 продвинутый, 4 экспертный, 5 выдающийся.",
        "",
        "ПРОФИЛЬ МПК (текущий / требуемый / гэп):",
    ]
    # сортируем: сначала gap > 0 по убыванию, потом остальные
    rows: list[tuple[int, int | None, int | None, int | None, Competency]] = []
    for c in all_comps:
        cur = current_by_comp.get(c.id)
        req = required_by_comp.get(c.id)
        gap = (
            (req - (cur if cur is not None else 0))
            if req is not None
            else None
        )
        rows.append((c.sort_order, cur, req, gap, c))
    rows.sort(key=lambda r: (-(r[3] if r[3] and r[3] > 0 else 0), r[0]))
    for _, cur, req, gap, c in rows:
        cur_s = cur if cur is not None else "—"
        req_s = req if req is not None else "—"
        gap_s = f"{gap:+d}" if gap is not None else "—"
        lines.append(f"  • {c.name}: {cur_s} / {req_s} / {gap_s}")

    if history:
        lines.append("")
        lines.append("ИСТОРИЯ ОЦЕНОК (последние 10):")
        for a in history:
            lines.append(
                f"  — {a.assessed_at}: оценено {len(a.scores)} компетенций "
                f"(источник: {a.source}, заметки: {a.notes or '—'})"
            )

    if meetings:
        lines.append("")
        lines.append("ПОСЛЕДНИЕ ЗАВЕРШЁННЫЕ ВСТРЕЧИ:")
        for m in meetings:
            lines.append(
                f"\n— Встреча {m.scheduled_at.date()} "
                f"({m.duration_min} мин, процедура: "
                f"{m.procedure.title if m.procedure else '—'}):"
            )
            if m.agenda_md:
                lines.append(f"  Повестка: {m.agenda_md[:400]}")
            if m.summary_md:
                lines.append(f"  Итоги: {m.summary_md[:600]}")
            if m.transcript_md:
                lines.append(f"  Транскрипт (обрезан): {m.transcript_md[:1500]}")
            arts = artifacts_by_meeting.get(m.id, [])
            if arts:
                lines.append("  Материалы встречи:")
                for a in arts[:20]:
                    comp_name = by_id[a.competency_id].name if a.competency_id and a.competency_id in by_id else ""
                    lines.append(
                        f"    [{_format_artifact_kind(a.kind)}"
                        f"{' · ' + comp_name if comp_name else ''}]: {a.content[:400]}"
                    )

    if learning_by_comp:
        lines.append("")
        lines.append("ДОСТУПНЫЕ РЕСУРСЫ ОБУЧЕНИЯ (из МПК, только по компетенциям с гэпом):")
        for cid, resources in learning_by_comp.items():
            comp_name = by_id[cid].name if cid in by_id else f"#{cid}"
            lines.append(f"  {comp_name}:")
            for r in resources[:8]:
                lvls = ",".join(str(lv) for lv in (r.levels or []))
                lines.append(
                    f"    — {r.name} [{r.format or '—'}, {r.provider or '—'}, уровни: {lvls}]"
                    + (f" → {r.url}" if r.url else "")
                )

    context = "\n".join(lines)

    # сводка для хранения
    summary = {
        "competencies_count": len(all_comps),
        "measured_count": len(current_by_comp),
        "gaps_count": len(gap_comp_ids),
        "history_count": len(history),
        "meetings_used": len(meetings),
        "artifacts_used": sum(len(v) for v in artifacts_by_meeting.values()),
        "resources_used": sum(len(v) for v in learning_by_comp.values()),
    }

    return context, summary


async def _client_or_503():
    client = await get_client()
    if client is None:
        raise HTTPException(
            status_code=503,
            detail="AI не настроен. Задайте AI_API_KEY в backend/.env",
        )
    return client


@router.get("", response_model=list[RecommendationListItem])
async def list_recommendations(
    employee_id: int, session: SessionDep, current_user: CurrentUser
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Recommendation)
        .where(Recommendation.employee_id == employee_id)
        .order_by(Recommendation.created_at.desc())
    )
    return list(q.scalars())


@router.get("/{recommendation_id}", response_model=RecommendationPublic)
async def get_recommendation(
    employee_id: int,
    recommendation_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Recommendation).where(
            Recommendation.id == recommendation_id,
            Recommendation.employee_id == employee_id,
        )
    )
    rec = q.scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Рекомендация не найдена")
    return rec


@router.post("/generate", response_model=AIJobPublic)
async def queue_recommendation(
    employee_id: int,
    payload: RecommendationGenerateRequest,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)

    if payload.procedure_id is not None:
        pq = await session.execute(
            select(MpkProcedure).where(
                MpkProcedure.id == payload.procedure_id,
                MpkProcedure.employee_id == employee_id,
            )
        )
        if pq.scalar_one_or_none() is None:
            raise HTTPException(status_code=400, detail="Процедура не найдена")

    job = AIJob(
        kind="employee_recommendation",
        status="queued",
        employee_id=employee_id,
        target_kind="employee",
        target_id=employee_id,
        payload={
            "procedure_id": payload.procedure_id,
            "title": payload.title or None,
        },
        created_by=current_user.id,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)

    pool = get_pool()
    await pool.enqueue_job("run_employee_recommendation", job.id)
    return job


@router.delete("/{recommendation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recommendation(
    employee_id: int,
    recommendation_id: int,
    session: SessionDep,
    current_user: MutatorUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Recommendation).where(
            Recommendation.id == recommendation_id,
            Recommendation.employee_id == employee_id,
        )
    )
    rec = q.scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Рекомендация не найдена")
    await session.delete(rec)
    await session.commit()


@router.get("/{recommendation_id}/export.docx")
async def export_docx(
    employee_id: int,
    recommendation_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Recommendation).where(
            Recommendation.id == recommendation_id,
            Recommendation.employee_id == employee_id,
        )
    )
    rec = q.scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Рекомендация не найдена")
    data = markdown_to_docx(rec.content_md, rec.title)
    filename = f"{rec.title[:80].replace('/', '_')}.docx"
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": _docx_disposition(filename)},
    )


@router.get("/{recommendation_id}/print")
async def print_view(
    employee_id: int,
    recommendation_id: int,
    session: SessionDep,
    current_user: CurrentUser,
):
    """HTML с auto-print — открывается в новой вкладке, сразу появляется диалог печати
    (→ Save as PDF в браузере)."""
    await _ensure_owner(session, employee_id, current_user)
    q = await session.execute(
        select(Recommendation).where(
            Recommendation.id == recommendation_id,
            Recommendation.employee_id == employee_id,
        )
    )
    rec = q.scalar_one_or_none()
    if rec is None:
        raise HTTPException(status_code=404, detail="Рекомендация не найдена")
    meta = f"Создано {rec.created_at.strftime('%d.%m.%Y')} · модель: {rec.model}"
    html = markdown_to_print_html(rec.content_md, rec.title, meta=meta)
    return HTMLResponse(html)
