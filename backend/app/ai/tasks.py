"""ARQ-задачи: оборачивают AI-вызовы, обновляют ai_jobs, пишут результат в целевые сущности."""
import asyncio
from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import selectinload

from app.ai.client import get_client, model_of
from app.ai.service import (
    build_employee_context,
    generate_candidate_screening,
    generate_digital_profile,
    generate_preparation_md,
    generate_questions,
    generate_recommendations_md,
    generate_rotation_rationale,
    generate_self_review_burnout,
    generate_self_review_calibration,
    generate_self_review_comparison,
    generate_self_review_draft,
    generate_self_review_topics,
    generate_summary,
    generate_tasks,
)
from app.db import SessionLocal
from app.models.employee import Employee
from app.models.mpk import (
    AIJob,
    AssessmentScore,
    Assessment,
    Competency,
    LearningResource,
    Meeting,
    MeetingArtifact,
    MpkProcedure,
    Recommendation,
    RoleProfile,
    role_key_competencies,
)
from app.models.candidate import CandidateProfile
from app.models.project import Project
from app.models.rotation import RotationSuggestion
from app.models.self_review import SelfReview
from app.notifications.service import publish_pending, record_notifications
from app.candidates.context import build_screening_context
from app.self_review.context import (
    build_burnout_context,
    build_calibration_context,
    build_compare_context,
    build_drafting_context,
    build_topics_context,
)
from app.rotations.ranking import (
    TENURE_THRESHOLD_MONTHS,
    compute_candidates,
    suggest_target_projects,
)
from app.schemas.ai import (
    AIGenParams,
    AIQuestionsStored,
    AITasksStored,
)


# ---------- helpers ----------


async def _set_running(session, job_id: int) -> AIJob:
    job = await session.get(AIJob, job_id)
    if job is None:
        raise RuntimeError(f"AIJob {job_id} not found")
    job.status = "running"
    job.started_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(job)
    return job


_AI_KIND_LABEL: dict[str, str] = {
    "meeting_questions": "Вопросы для встречи готовы",
    "meeting_tasks": "Задания для встречи готовы",
    "meeting_summary": "Сводка по встрече готова",
    "procedure_preparation": "Памятка к процедуре МПК готова",
    "employee_recommendation": "Рекомендация по сотруднику готова",
    "rotation_suggestion": "Кандидат на ротацию подобран",
    "self_review_topics": "Темы для 1:1 (Self-Review) готовы",
    "self_review_compare": "Сравнение Self-Review готово",
    "self_review_burnout": "Анализ выгорания готов",
    "self_review_calibration": "Калибровка Self-Review готова",
    "self_review_draft": "Черновик Self-Review готов",
    "candidate_screening": "Скрининг резюме готов",
    "digital_profile": "Цифровой профиль сотрудника готов",
}


def _ai_link(job: AIJob) -> str:
    """Куда отправлять пользователя по клику."""
    if job.kind.startswith("self_review_"):
        # target_id — review id (для большинства self_review-задач)
        if job.target_kind == "self_review" and job.target_id:
            return f"/self-review/{job.employee_id}/{job.target_id}"
        return f"/employees/{job.employee_id}"
    if job.kind.startswith("candidate_"):
        return f"/hiring/{job.employee_id}"
    if job.kind == "rotation_suggestion":
        return "/rotations"
    return f"/employees/{job.employee_id}"


async def _notify_ai_job(session, job: AIJob, *, ok: bool, error_msg: str | None = None):
    label = _AI_KIND_LABEL.get(job.kind, job.kind)
    if ok:
        title = label
        body = None
        kind = "ai_job_done"
    else:
        title = f"AI-задача завершилась с ошибкой: {label}"
        body = error_msg[:200] if error_msg else None
        kind = "ai_job_error"
    notifs = await record_notifications(
        session,
        recipient_user_ids=[job.created_by],
        kind=kind,
        title=title,
        body=body,
        link=_ai_link(job),
        payload={"ai_job_id": job.id, "ai_kind": job.kind, "employee_id": job.employee_id},
    )
    return notifs


async def _set_done(session, job: AIJob, result: dict | None) -> None:
    job.status = "done"
    job.result = result
    job.finished_at = datetime.now(UTC)
    notifs = await _notify_ai_job(session, job, ok=True)
    await session.commit()
    await publish_pending(notifs)


async def _set_error(session, job: AIJob, message: str) -> None:
    job.status = "error"
    job.error = message[:4000]
    job.finished_at = datetime.now(UTC)
    notifs = await _notify_ai_job(session, job, ok=False, error_msg=message)
    await session.commit()
    await publish_pending(notifs)


async def _load_employee(session, eid: int) -> Employee:
    q = await session.execute(
        select(Employee)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .where(Employee.id == eid)
    )
    emp = q.scalar_one_or_none()
    if emp is None:
        raise RuntimeError(f"Employee {eid} not found")
    return emp


# Контексты — упрощённые версии того, что было в эндпоинтах.
# Не дублируем логику с api/, потому что она частично использовала FastAPI deps.
# Тут чистые функции на сессии.


async def _build_questions_context(
    session, employee: Employee, params: AIGenParams
):
    last_q = await session.execute(
        select(Assessment)
        .where(Assessment.employee_id == employee.id)
        .order_by(Assessment.assessed_at.desc(), Assessment.id.desc())
        .limit(1)
    )
    last = last_q.scalar_one_or_none()
    current_by_comp: dict[int, int] = {}
    if last:
        sq = await session.execute(
            select(AssessmentScore).where(AssessmentScore.assessment_id == last.id)
        )
        for s in sq.scalars():
            current_by_comp[s.competency_id] = s.level

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

    comps_q = await session.execute(
        select(Competency)
        .options(selectinload(Competency.criteria))
        .order_by(Competency.sort_order, Competency.id)
    )
    all_comps = list(comps_q.scalars())

    class _Item:
        def __init__(self, name, current, required, gap, cid):
            self.competency_name = name
            self.current_level = current
            self.required_level = required
            self.gap = gap
            self.competency_id = cid

    items = []
    for c in all_comps:
        cur = current_by_comp.get(c.id)
        req = required_by_comp.get(c.id)
        gap = (req - (cur if cur is not None else 0)) if req is not None else None
        items.append(_Item(c.name, cur, req, gap, c.id))

    key_ids: set[int] = set()
    if params.key_only:
        if not employee.role_id:
            raise RuntimeError(
                "Опция «только ключевые»: у сотрудника не назначена роль."
            )
        kq = await session.execute(
            select(role_key_competencies.c.competency_id).where(
                role_key_competencies.c.role_id == employee.role_id
            )
        )
        key_ids = set(kq.scalars().all())
        if not key_ids:
            raise RuntimeError(
                "Опция «только ключевые»: для роли сотрудника не отмечено ни одной "
                "ключевой компетенции. Отметьте ★ в «Справочнике МПК»."
            )

    if params.competency_ids:
        wanted = set(params.competency_ids)
        if params.key_only:
            wanted &= key_ids
            if not wanted:
                raise RuntimeError(
                    "Выбранные компетенции не входят в ключевые для роли."
                )
        focus = [c for c in all_comps if c.id in wanted]
    elif params.key_only:
        focus = [c for c in all_comps if c.id in key_ids]
    else:
        by_comp_id = {c.id: c for c in all_comps}
        candidates = [(it.gap, it.competency_id) for it in items if it.gap and it.gap > 0]
        candidates.sort(key=lambda x: (-x[0], x[1]))
        focus = [by_comp_id[cid] for _, cid in candidates[:8]]
        if not focus:
            required_ids = {cid for cid, r in required_by_comp.items() if r and r > 0}
            focus = [c for c in all_comps if c.id in required_ids][:8]

    if not focus:
        raise RuntimeError(
            "Нет компетенций для генерации. Назначьте роль/грейд или выберите компетенции вручную."
        )

    context = build_employee_context(employee, items, focus)
    return context, focus


async def _build_recommendation_context_full(session, employee: Employee):
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

    comps_q = await session.execute(
        select(Competency)
        .options(selectinload(Competency.criteria))
        .order_by(Competency.sort_order)
    )
    all_comps = list(comps_q.scalars())
    by_id = {c.id: c for c in all_comps}

    hist_q = await session.execute(
        select(Assessment)
        .options(selectinload(Assessment.scores))
        .where(Assessment.employee_id == employee.id)
        .order_by(Assessment.assessed_at.desc())
        .limit(10)
    )
    history = list(hist_q.scalars())

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

    gap_comp_ids = [
        cid
        for cid, req in required_by_comp.items()
        if req - current_by_comp.get(cid, 0) > 0
    ]
    learning_by_comp: dict[int, list[LearningResource]] = {}
    if gap_comp_ids:
        lr_q = await session.execute(
            select(LearningResource)
            .where(LearningResource.competency_id.in_(gap_comp_ids))
            .limit(60)
        )
        for lr in lr_q.scalars():
            learning_by_comp.setdefault(lr.competency_id, []).append(lr)

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
    rows = []
    for c in all_comps:
        cur = current_by_comp.get(c.id)
        req = required_by_comp.get(c.id)
        gap = (req - (cur if cur is not None else 0)) if req is not None else None
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
                f"\n— Встреча {m.scheduled_at.date()} ({m.duration_min} мин, "
                f"процедура: {m.procedure.title if m.procedure else '—'}):"
            )
            if m.agenda_md:
                lines.append(f"  Повестка: {m.agenda_md[:400]}")
            if m.summary_md:
                lines.append(f"  Итоги: {m.summary_md[:600]}")
            if m.transcript_md:
                lines.append(f"  Транскрипт (обрезан): {m.transcript_md[:1500]}")
            for a in artifacts_by_meeting.get(m.id, [])[:20]:
                comp_name = by_id[a.competency_id].name if a.competency_id in by_id else ""
                lines.append(
                    f"    [{a.kind}{' · ' + comp_name if comp_name else ''}]: "
                    f"{a.content[:400]}"
                )

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

    summary = {
        "competencies_count": len(all_comps),
        "measured_count": len(current_by_comp),
        "gaps_count": len(gap_comp_ids),
        "history_count": len(history),
        "meetings_used": len(meetings),
        "artifacts_used": sum(len(v) for v in artifacts_by_meeting.values()),
        "resources_used": sum(len(v) for v in learning_by_comp.values()),
    }

    return "\n".join(lines), summary


async def _build_preparation_context_full(session, employee: Employee, procedure: MpkProcedure):
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

    focus_ids = [cid for cid, req in required_by_comp.items() if req > 0]

    learning_by_comp: dict[int, list[LearningResource]] = {}
    if focus_ids:
        lr_q = await session.execute(
            select(LearningResource).where(LearningResource.competency_id.in_(focus_ids))
        )
        for lr in lr_q.scalars():
            learning_by_comp.setdefault(lr.competency_id, []).append(lr)

    role_name = procedure.role_snapshot or (employee.role.name if employee.role else "—")
    grade_code = procedure.grade_snapshot or (employee.grade.code if employee.grade else "—")

    lines = [
        f"Сотрудник: {employee.full_name}",
        f"Роль: {role_name} / грейд: {grade_code}",
        f"Процедура МПК: «{procedure.title}»",
    ]
    if procedure.period_start or procedure.period_end:
        lines.append(f"Период: {procedure.period_start or '?'} — {procedure.period_end or '?'}")
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
        prefix = "★ " if cid in key_ids else ""
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


def _fill_competency_names(items: list, focus: list[Competency]) -> list:
    name_by_id = {c.id: c.name for c in focus}
    for it in items:
        if getattr(it, "competency_name", None):
            continue
        it.competency_name = name_by_id.get(it.competency_id)
    return items


# ---------- AI tasks ----------


async def run_meeting_questions(ctx, job_id: int) -> dict:
    async with SessionLocal() as session:
        job = await _set_running(session, job_id)
        try:
            client = await get_client()
            if client is None:
                raise RuntimeError("AI не настроен. Задайте AI_API_KEY в backend/.env")
            mid = job.target_id
            mq = await session.execute(select(Meeting).where(Meeting.id == mid))
            meeting = mq.scalar_one_or_none()
            if meeting is None:
                raise RuntimeError(f"Встреча {mid} не найдена")
            emp = await _load_employee(session, meeting.employee_id)
            params = AIGenParams.model_validate(job.payload)

            context, focus = await _build_questions_context(session, emp, params)
            result = await generate_questions(client, context, params)
            items = _fill_competency_names(list(result.questions), focus)
            for it in items:
                if not it.uid:
                    it.uid = uuid4().hex
            stored = AIQuestionsStored(
                items=items,
                params=params,
                generated_at=datetime.now(UTC),
                model=model_of(client),
            )
            meeting.ai_questions = stored.model_dump(mode="json")
            await session.commit()
            await _set_done(session, job, {"meeting_id": mid, "items_count": len(items)})
            return {"ok": True}
        except Exception as e:
            await _set_error(session, job, str(e))
            return {"ok": False, "error": str(e)}


async def run_meeting_tasks(ctx, job_id: int) -> dict:
    async with SessionLocal() as session:
        job = await _set_running(session, job_id)
        try:
            client = await get_client()
            if client is None:
                raise RuntimeError("AI не настроен. Задайте AI_API_KEY в backend/.env")
            mid = job.target_id
            mq = await session.execute(select(Meeting).where(Meeting.id == mid))
            meeting = mq.scalar_one_or_none()
            if meeting is None:
                raise RuntimeError(f"Встреча {mid} не найдена")
            emp = await _load_employee(session, meeting.employee_id)
            params = AIGenParams.model_validate(job.payload)

            context, focus = await _build_questions_context(session, emp, params)
            result = await generate_tasks(client, context, params)
            items = _fill_competency_names(list(result.tasks), focus)
            for it in items:
                if not it.uid:
                    it.uid = uuid4().hex
            stored = AITasksStored(
                items=items,
                params=params,
                generated_at=datetime.now(UTC),
                model=model_of(client),
            )
            meeting.ai_tasks = stored.model_dump(mode="json")
            await session.commit()
            await _set_done(session, job, {"meeting_id": mid, "items_count": len(items)})
            return {"ok": True}
        except Exception as e:
            await _set_error(session, job, str(e))
            return {"ok": False, "error": str(e)}


async def run_meeting_summary(ctx, job_id: int) -> dict:
    async with SessionLocal() as session:
        job = await _set_running(session, job_id)
        try:
            client = await get_client()
            if client is None:
                raise RuntimeError("AI не настроен. Задайте AI_API_KEY в backend/.env")
            mid = job.target_id
            mq = await session.execute(select(Meeting).where(Meeting.id == mid))
            meeting = mq.scalar_one_or_none()
            if meeting is None:
                raise RuntimeError(f"Встреча {mid} не найдена")
            emp = await _load_employee(session, meeting.employee_id)
            notes = (job.payload or {}).get("notes", "")

            # Простой контекст: профиль сотрудника без истории
            ctx_text, _focus = await _build_questions_context(
                session, emp, AIGenParams(competency_ids=[], count=1)
            )
            result = await generate_summary(client, ctx_text, meeting.agenda_md, notes)
            meeting.summary_md = result.summary_md
            if meeting.status == "planned":
                meeting.status = "done"
            await session.commit()
            await _set_done(session, job, {"meeting_id": mid})
            return {"ok": True}
        except Exception as e:
            await _set_error(session, job, str(e))
            return {"ok": False, "error": str(e)}


async def run_procedure_preparation(ctx, job_id: int) -> dict:
    async with SessionLocal() as session:
        job = await _set_running(session, job_id)
        try:
            client = await get_client()
            if client is None:
                raise RuntimeError("AI не настроен. Задайте AI_API_KEY в backend/.env")
            pid = job.target_id
            pq = await session.execute(select(MpkProcedure).where(MpkProcedure.id == pid))
            proc = pq.scalar_one_or_none()
            if proc is None:
                raise RuntimeError(f"Процедура {pid} не найдена")
            emp = await _load_employee(session, proc.employee_id)
            context = await _build_preparation_context_full(session, emp, proc)
            md = await generate_preparation_md(client, context)
            if not md.strip():
                raise RuntimeError("AI вернул пустой ответ")
            proc.preparation_md = md
            await session.commit()
            await _set_done(session, job, {"procedure_id": pid, "chars": len(md)})
            return {"ok": True}
        except Exception as e:
            await _set_error(session, job, str(e))
            return {"ok": False, "error": str(e)}


async def _build_rotation_context(
    session, employee_id: int, from_project_id: int
) -> tuple[str, list[int]]:
    """Контекст для AI: профиль сотрудника + его scoring на проекте + предложенные проекты.

    Возвращает (текст, список target_project_ids)."""
    emp = await _load_employee(session, employee_id)
    proj = await session.get(Project, from_project_id)
    if proj is None:
        raise RuntimeError(f"Проект {from_project_id} не найден")

    candidates = await compute_candidates(session, from_project_id)
    cand = next((c for c in candidates if c.employee_id == employee_id), None)

    targets = await suggest_target_projects(
        session, employee_id, from_project_id, limit=5
    )
    target_project_ids = [t[0] for t in targets]

    role_name = emp.role.name if emp.role else "—"
    grade_code = emp.grade.code if emp.grade else "—"

    lines: list[str] = [
        f"Сотрудник: {emp.full_name}",
        f"Роль: {role_name} / грейд: {grade_code}",
        f"Текущий проект: {proj.name}" + (f" ({proj.code})" if proj.code else ""),
        "",
    ]

    if cand:
        lines += [
            "ФАКТОРЫ (из БД):",
            f"  • стаж в проекте: {cand.tenure_months} мес. (порог ротации: {TENURE_THRESHOLD_MONTHS}+)",
            f"  • присоединился: {cand.joined_at}",
            f"  • tenure-score: {cand.tenure_score} (каждые 3 мес. сверх порога +1)",
            f"  • bus-factor-score: {cand.bus_factor_score} "
            f"(★-компетенций стека, где сотрудник — единственный носитель целевого уровня)",
            f"  • суммарный score: {cand.score}",
        ]
        if cand.bus_factor_competencies:
            lines.append("  Bus-factor по компетенциям:")
            for cid, cname in cand.bus_factor_competencies:
                lines.append(f"    — {cname}")
    else:
        lines.append("Сотрудник не в списке кандидатов на ротацию (не достиг порога или заморожен).")

    if target_project_ids:
        lines += ["", "ПРЕДЛОЖЕННЫЕ ЦЕЛЕВЫЕ ПРОЕКТЫ (по пересечению ★-компетенций):"]
        for pid, name, overlap in targets:
            lines.append(f"  • {name} — пересечение по {overlap} ★-компетенциям")
    else:
        lines += [
            "",
            "ПРЕДЛОЖЕННЫХ ЦЕЛЕВЫХ ПРОЕКТОВ нет: либо нет активных проектов с пересечением "
            "★-компетенций, либо сотрудник уже состоит в подходящих.",
        ]

    return "\n".join(lines), target_project_ids


async def run_rotation_suggestion(ctx, job_id: int) -> dict:
    """Сгенерировать AI-обоснование ротации для пары (employee, from_project)
    и upsert'нуть RotationSuggestion."""
    async with SessionLocal() as session:
        job = await _set_running(session, job_id)
        try:
            client = await get_client()
            if client is None:
                raise RuntimeError("AI не настроен. Задайте AI_API_KEY в backend/.env")
            from_project_id = job.target_id
            if from_project_id is None:
                raise RuntimeError("target_id (project_id) обязателен")

            context, target_ids = await _build_rotation_context(
                session, job.employee_id, from_project_id
            )
            md = await generate_rotation_rationale(client, context)
            if not md.strip():
                raise RuntimeError("AI вернул пустой ответ")

            now = datetime.now(UTC)
            stmt = pg_insert(RotationSuggestion).values(
                employee_id=job.employee_id,
                from_project_id=from_project_id,
                rationale_md=md,
                target_project_ids=target_ids,
                model=model_of(client),
                generated_at=now,
            )
            stmt = stmt.on_conflict_do_update(
                index_elements=["employee_id", "from_project_id"],
                set_={
                    "rationale_md": md,
                    "target_project_ids": target_ids,
                    "model": model_of(client),
                    "generated_at": now,
                },
            )
            await session.execute(stmt)
            await session.commit()
            await _set_done(
                session,
                job,
                {
                    "employee_id": job.employee_id,
                    "from_project_id": from_project_id,
                    "target_project_ids": target_ids,
                    "chars": len(md),
                },
            )
            return {"ok": True}
        except Exception as e:
            await _set_error(session, job, str(e))
            return {"ok": False, "error": str(e)}


async def run_employee_recommendation(ctx, job_id: int) -> dict:
    async with SessionLocal() as session:
        job = await _set_running(session, job_id)
        try:
            client = await get_client()
            if client is None:
                raise RuntimeError("AI не настроен. Задайте AI_API_KEY в backend/.env")
            emp = await _load_employee(session, job.employee_id)
            payload = job.payload or {}
            procedure_id = payload.get("procedure_id")
            title_override = (payload.get("title") or "").strip() or None

            context, summary = await _build_recommendation_context_full(session, emp)
            if summary["competencies_count"] == 0:
                raise RuntimeError("Нет данных МПК")
            md = await generate_recommendations_md(client, context)
            if not md.strip():
                raise RuntimeError("AI вернул пустой ответ")

            now = datetime.now(UTC)
            default_title = f"ИПР {emp.full_name} · {now.strftime('%d.%m.%Y')}"
            rec = Recommendation(
                employee_id=emp.id,
                procedure_id=procedure_id,
                title=title_override or default_title,
                content_md=md,
                context_summary=summary,
                model=model_of(client),
                created_by=job.created_by,
            )
            session.add(rec)
            await session.commit()
            await session.refresh(rec)
            await _set_done(
                session,
                job,
                {"recommendation_id": rec.id, "summary": summary},
            )
            return {"ok": True, "recommendation_id": rec.id}
        except Exception as e:
            await _set_error(session, job, str(e))
            return {"ok": False, "error": str(e)}


# ---------- Self-Review AI ----------


async def _load_self_review(session, review_id: int) -> SelfReview:
    rv = await session.get(SelfReview, review_id)
    if rv is None:
        raise RuntimeError(f"SelfReview {review_id} не найден")
    return rv


async def _run_self_review_ai(
    job_id: int,
    target_field: str,
    build_context,
    generate,
) -> dict:
    """Универсальная обёртка для всех AI-задач Self-Review.

    target_field — имя поля в SelfReview, куда писать результат.
    build_context — async (session, rv, emp) -> str (или для compare возвращает tuple).
    generate — async-функция AI.service, принимающая (client, *contexts) -> str.
    """
    async with SessionLocal() as session:
        job = await _set_running(session, job_id)
        try:
            client = await get_client()
            if client is None:
                raise RuntimeError("AI не настроен. Задайте AI_API_KEY в backend/.env")
            rid = job.target_id
            if rid is None:
                raise RuntimeError("target_id (review_id) обязателен")
            rv = await _load_self_review(session, rid)
            emp = await _load_employee(session, rv.employee_id)
            ctx_result = await build_context(session, rv, emp)
            if isinstance(ctx_result, tuple):
                # compare: (current, previous)
                cur, prev = ctx_result
                if prev is None:
                    raise RuntimeError(
                        "Нет Self-Review за прошлый год — сравнивать не с чем"
                    )
                md = await generate(client, cur, prev)
            else:
                md = await generate(client, ctx_result)
            if not md.strip():
                raise RuntimeError("AI вернул пустой ответ")
            setattr(rv, target_field, md)
            await session.commit()
            await _set_done(
                session,
                job,
                {"review_id": rid, "field": target_field, "chars": len(md)},
            )
            return {"ok": True}
        except Exception as e:
            await _set_error(session, job, str(e))
            return {"ok": False, "error": str(e)}


async def run_self_review_topics(ctx, job_id: int) -> dict:
    return await _run_self_review_ai(
        job_id, "ai_topics_md", build_topics_context, generate_self_review_topics
    )


async def run_self_review_compare(ctx, job_id: int) -> dict:
    return await _run_self_review_ai(
        job_id,
        "ai_comparison_md",
        build_compare_context,
        generate_self_review_comparison,
    )


async def run_self_review_burnout(ctx, job_id: int) -> dict:
    return await _run_self_review_ai(
        job_id, "ai_burnout_md", build_burnout_context, generate_self_review_burnout
    )


async def run_self_review_calibration(ctx, job_id: int) -> dict:
    return await _run_self_review_ai(
        job_id,
        "ai_calibration_md",
        build_calibration_context,
        generate_self_review_calibration,
    )


async def run_self_review_draft(ctx, job_id: int) -> dict:
    return await _run_self_review_ai(
        job_id, "ai_drafting_md", build_drafting_context, generate_self_review_draft
    )


# ---------- Candidate AI ----------


async def _load_candidate_profile(session, employee_id: int) -> CandidateProfile:
    q = await session.execute(
        select(CandidateProfile).where(CandidateProfile.employee_id == employee_id)
    )
    p = q.scalar_one_or_none()
    if p is None:
        raise RuntimeError(f"CandidateProfile for employee {employee_id} not found")
    return p


async def run_candidate_screening(ctx, job_id: int) -> dict:
    """AI-скрининг резюме: пишет recommended (да/нет) и reasoning_md в профиль."""
    async with SessionLocal() as session:
        job = await _set_running(session, job_id)
        try:
            client = await get_client()
            if client is None:
                raise RuntimeError(
                    "AI не настроен. Задайте AI_API_KEY в backend/.env"
                )
            emp = await _load_employee(session, job.employee_id)
            prof = await _load_candidate_profile(session, emp.id)
            ctx_text = await build_screening_context(session, emp, prof)
            result = await generate_candidate_screening(client, ctx_text)
            if not result.reasoning_md.strip():
                raise RuntimeError("AI вернул пустой ответ")
            prof.ai_screening_recommended = bool(result.recommended)
            prof.ai_screening_reasoning_md = result.reasoning_md
            prof.ai_screening_at = datetime.now(UTC)
            await session.commit()
            await _set_done(
                session,
                job,
                {
                    "employee_id": emp.id,
                    "recommended": prof.ai_screening_recommended,
                },
            )
            return {"ok": True}
        except Exception as e:
            await _set_error(session, job, str(e))
            return {"ok": False, "error": str(e)}


# ---------- Digital Profile ----------


def _digital_profile_md_fallback(data: dict) -> str:
    """Минимальный markdown из структурированных данных — для legacy-просмотра
    и экспорта .docx. UI рендерит из content_json напрямую."""
    lines: list[str] = []
    if hl := data.get("headline"):
        lines += [f"_{hl}_", ""]
    if s := data.get("summary"):
        lines += ["## Summary", s, ""]
    for section, label in [
        ("strengths", "## Сильные стороны"),
        ("weaknesses", "## Слабые места / точки роста"),
    ]:
        items = data.get(section) or []
        if items:
            lines.append(label)
            for it in items:
                line = f"- **{it.get('title', '')}** — {it.get('detail', '')}"
                if src := it.get("source"):
                    line += f" _({src})_"
                lines.append(line)
            lines.append("")
    if gaps := data.get("gaps") or []:
        lines.append("## Разрыв «заявлено vs факт»")
        lines.append("| Компетенция | МПК | В PR (факт) | Комментарий |")
        lines.append("|---|---|---|---|")
        for g in gaps:
            lines.append(
                f"| {g.get('competency', '')} | {g.get('mpk_level', '—')} | "
                f"{g.get('fact_summary', '')} | {g.get('comment', '')} |"
            )
        lines.append("")
    if projs := data.get("projects") or []:
        lines.append("## Проекты")
        for p in projs:
            head = p.get("name", "")
            if r := p.get("role"):
                head += f" ({r})"
            lines.append(f"- **{head}** — {p.get('summary', '')}")
        lines.append("")
    if acts := data.get("actions") or []:
        lines.append("## Рекомендуемые действия")
        for a in acts:
            prio = {"high": "🔴", "medium": "🟡", "low": "🟢"}.get(
                a.get("priority", "medium"), "•"
            )
            lines.append(f"- {prio} **{a.get('title', '')}** — {a.get('detail', '')}")
        lines.append("")
    return "\n".join(lines).strip() or "_(пусто)_"


async def run_digital_profile(ctx, job_id: int) -> dict:  # noqa: ARG001
    """AI-задача генерации цифрового профиля сотрудника. Пишет результат в
    `digital_profiles` (upsert по employee_id)."""
    from app.dev_metrics.context import build_digital_profile_context
    from app.models.dev_metrics import DigitalProfile

    async with SessionLocal() as session:
        job = await _set_running(session, job_id)
        try:
            client = await get_client()
            if client is None:
                raise RuntimeError(
                    "AI не настроен. Задайте AI_API_KEY в backend/.env"
                )
            emp_q = await session.execute(
                select(Employee)
                .options(
                    selectinload(Employee.role),
                    selectinload(Employee.grade),
                    selectinload(Employee.department),
                )
                .where(Employee.id == job.employee_id)
            )
            emp = emp_q.scalar_one_or_none()
            if emp is None:
                raise RuntimeError(f"Employee {job.employee_id} not found")

            ctx_text, summary = await build_digital_profile_context(session, emp)
            result = await generate_digital_profile(client, ctx_text)
            content_json = result.model_dump(mode="json")
            content_md = _digital_profile_md_fallback(content_json)

            # Upsert
            existing_q = await session.execute(
                select(DigitalProfile).where(
                    DigitalProfile.employee_id == emp.id
                )
            )
            profile = existing_q.scalar_one_or_none()
            if profile is None:
                profile = DigitalProfile(
                    employee_id=emp.id,
                    content_md=content_md,
                    content_json=content_json,
                    input_summary=summary,
                    model=model_of(client),
                    generated_at=datetime.now(UTC),
                )
                session.add(profile)
            else:
                profile.content_md = content_md
                profile.content_json = content_json
                profile.input_summary = summary
                profile.model = model_of(client)
                profile.generated_at = datetime.now(UTC)

            await session.commit()
            await _set_done(session, job, {"employee_id": emp.id})
            return {"ok": True}
        except Exception as e:
            await _set_error(session, job, str(e))
            return {"ok": False, "error": str(e)}


async def run_product_performance_review(ctx, review_id: int) -> dict:  # noqa: ARG001
    """AI-обзор performance продукта. Пишет результат в
    `product_performance_reviews` (status queued→running→done/error)."""
    from app.api.products import build_product_performance
    from app.models.performance import ProductPerformanceReview
    from app.models.project import Product
    from app.models.user import User
    from app.products.ai_review import (
        REVIEW_SYSTEM_PROMPT,
        build_review_context,
        parse_review_json,
    )

    async with SessionLocal() as session:
        rv = await session.get(ProductPerformanceReview, review_id)
        if rv is None:
            return {"ok": False, "error": "review not found"}
        rv.status = "running"
        await session.commit()

    try:
        async with SessionLocal() as session:
            client = await get_client()
            if client is None:
                raise RuntimeError(
                    "AI не настроен. Задайте AI_API_KEY в backend/.env"
                )
            rv = await session.get(ProductPerformanceReview, review_id)
            product = await session.get(Product, rv.product_id)
            if product is None:
                raise RuntimeError("Продукт не найден")
            access_user = await session.get(User, rv.created_by)

            perf = await build_product_performance(
                session, rv.product_id, access_user, 90
            )
            ctx_text = build_review_context(product.name, perf)

            # Жёсткий таймаут на LLM-вызов; structured JSON-output.
            resp = await asyncio.wait_for(
                client.chat.completions.create(
                    model=model_of(client),
                    messages=[
                        {"role": "system", "content": REVIEW_SYSTEM_PROMPT},
                        {"role": "user", "content": ctx_text},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.4,
                    max_tokens=20000,
                ),
                timeout=180,
            )
            raw = resp.choices[0].message.content or ""
            result = parse_review_json(raw)

            rv.content_json = result.model_dump(mode="json")
            rv.content_md = None
            rv.model = model_of(client)
            rv.period_from = perf.period_from
            rv.period_to = perf.period_to
            rv.status = "done"
            rv.finished_at = datetime.now(UTC)
            await session.commit()
        return {"ok": True}
    except Exception as e:
        async with SessionLocal() as session:
            rv = await session.get(ProductPerformanceReview, review_id)
            if rv is not None:
                rv.status = "error"
                rv.error = str(e)[:2000]
                rv.finished_at = datetime.now(UTC)
                await session.commit()
        return {"ok": False, "error": str(e)}
