"""Сборка текстовых контекстов для AI-задач Self-Review.

Все функции возвращают plain-text контекст, который пихается в системный промпт.
Никаких I/O вне SQLAlchemy и DOCX-чтения."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.employee import Employee
from app.models.mpk import (
    Assessment,
    AssessmentScore,
    Competency,
    LearningResource,
    Meeting,
    MeetingArtifact,
    Recommendation,
    RoleProfile,
)
from app.models.project import Project, ProjectMember
from app.models.rotation import Rotation
from app.models.self_review import SelfReview


def _employee_header(emp: Employee) -> list[str]:
    role_name = emp.role.name if emp.role else "—"
    grade_code = emp.grade.code if emp.grade else "—"
    return [
        f"Сотрудник: {emp.full_name}",
        f"Должность: {emp.position or '—'}",
        f"Роль / грейд: {role_name} / {grade_code}",
    ]


async def build_topics_context(
    session: AsyncSession, rv: SelfReview, emp: Employee
) -> str:
    """Контекст для AI-генерации тем 1:1: header + текст Self-Review +
    МПК-краткая сводка + последние meeting-итоги + последняя рекомендация."""
    lines: list[str] = []
    lines += _employee_header(emp)
    lines.append(f"Период Self-Review: {rv.year}")
    lines.append("")

    text = (rv.source_text or "").strip()
    if text:
        lines.append("===== ТЕКСТ SELF-REVIEW =====")
        lines.append(text[:8000])
        lines.append("")
    else:
        lines.append("(Файл Self-Review не приложен — текста нет.)")
        lines.append("")

    if rv.manager_notes_md:
        lines.append("===== ЗАМЕТКИ РУКОВОДИТЕЛЯ =====")
        lines.append(rv.manager_notes_md[:2000])
        lines.append("")

    # МПК-сводка: гэпы, ★-компетенции
    if emp.role_id and emp.grade_id:
        rp_q = await session.execute(
            select(RoleProfile).where(
                RoleProfile.role_id == emp.role_id,
                RoleProfile.grade_id == emp.grade_id,
                RoleProfile.required_level > 0,
            )
        )
        required = {p.competency_id: p.required_level for p in rp_q.scalars()}
        if required:
            cur_q = await session.execute(
                select(AssessmentScore.competency_id, AssessmentScore.level)
                .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
                .where(Assessment.employee_id == emp.id)
                .order_by(
                    AssessmentScore.competency_id,
                    Assessment.assessed_at.desc(),
                    Assessment.id.desc(),
                )
                .distinct(AssessmentScore.competency_id)
            )
            current = {cid: lvl for cid, lvl in cur_q.all()}
            comp_q = await session.execute(
                select(Competency.id, Competency.name).where(
                    Competency.id.in_(required.keys())
                )
            )
            name_by_id = {cid: n for cid, n in comp_q.all()}
            lines.append(
                "===== ОЦЕНКА РУКОВОДИТЕЛЯ ПО МПК ====="
            )
            lines.append(
                "Уровни проставил руководитель (это НЕ самооценка). "
                "Формат: оценка руководителя / целевой уровень / Δ"
            )
            rows = []
            for cid, req in required.items():
                cur = current.get(cid, 0)
                gap = req - cur
                rows.append((cid, req, cur, gap))
            rows.sort(key=lambda r: -r[3])
            for cid, req, cur, gap in rows[:20]:
                gap_s = f"{gap:+d}" if gap else " 0"
                lines.append(f"  • {name_by_id.get(cid, cid)}: {cur} / {req} / {gap_s}")
            lines.append("")

    # последний ИПР, если есть
    rec_q = await session.execute(
        select(Recommendation)
        .where(Recommendation.employee_id == emp.id)
        .order_by(Recommendation.created_at.desc())
        .limit(1)
    )
    rec = rec_q.scalar_one_or_none()
    if rec is not None:
        lines.append(f"===== ПОСЛЕДНИЙ ИПР: {rec.title} =====")
        lines.append((rec.content_md or "")[:3000])
        lines.append("")

    # последние meeting summaries
    m_q = await session.execute(
        select(Meeting)
        .where(Meeting.employee_id == emp.id, Meeting.status == "done")
        .order_by(Meeting.scheduled_at.desc())
        .limit(3)
    )
    meetings = list(m_q.scalars())
    if meetings:
        lines.append("===== ПОСЛЕДНИЕ ВСТРЕЧИ 1:1 =====")
        for m in meetings:
            lines.append(f"\n— Встреча {m.scheduled_at.date()}:")
            if m.summary_md:
                lines.append(m.summary_md[:1500])
        lines.append("")

    # ротации сотрудника
    rot_q = await session.execute(
        select(Rotation)
        .where(Rotation.employee_id == emp.id)
        .order_by(Rotation.proposed_at.desc())
        .limit(3)
    )
    rots = list(rot_q.scalars())
    if rots:
        lines.append("===== РОТАЦИИ =====")
        for r in rots:
            lines.append(
                f"  • {r.proposed_at.date()}: {r.status} "
                f"(from project #{r.from_project_id} → to #{r.to_project_id})"
            )
        lines.append("")

    return "\n".join(lines)


async def build_compare_context(
    session: AsyncSession, rv: SelfReview, emp: Employee
) -> tuple[str, str | None]:
    """(текущий контекст, прошлогодний контекст). Если прошлогодней нет — None."""
    cur_lines = _employee_header(emp)
    cur_lines.append(f"Год: {rv.year}")
    cur_lines.append("")
    if rv.source_text:
        cur_lines.append(rv.source_text[:10000])
    if rv.manager_notes_md:
        cur_lines.append("\nЗаметки руководителя:")
        cur_lines.append(rv.manager_notes_md[:2000])
    if rv.project_score is not None:
        cur_lines.append(f"\nСамооценка по проекту: {rv.project_score}/10")
    if rv.company_score is not None:
        cur_lines.append(f"Самооценка по компании: {rv.company_score}/10")

    prev_q = await session.execute(
        select(SelfReview).where(
            SelfReview.employee_id == emp.id,
            SelfReview.year == rv.year - 1,
        )
    )
    prev = prev_q.scalar_one_or_none()
    if prev is None:
        return ("\n".join(cur_lines), None)

    prev_lines = _employee_header(emp)
    prev_lines.append(f"Год: {prev.year}")
    prev_lines.append("")
    if prev.source_text:
        prev_lines.append(prev.source_text[:10000])
    if prev.manager_notes_md:
        prev_lines.append("\nЗаметки руководителя:")
        prev_lines.append(prev.manager_notes_md[:2000])
    if prev.project_score is not None:
        prev_lines.append(f"\nСамооценка по проекту: {prev.project_score}/10")
    if prev.company_score is not None:
        prev_lines.append(f"Самооценка по компании: {prev.company_score}/10")

    return ("\n".join(cur_lines), "\n".join(prev_lines))


async def build_burnout_context(
    session: AsyncSession, rv: SelfReview, emp: Employee
) -> str:
    """Только текст самого ревью + заметки. Анализ опирается на формулировки."""
    lines = _employee_header(emp)
    lines.append(f"Год: {rv.year}")
    lines.append("")
    if rv.source_text:
        lines.append("===== ТЕКСТ SELF-REVIEW =====")
        lines.append(rv.source_text[:12000])
    if rv.manager_notes_md:
        lines.append("\n===== ЗАМЕТКИ РУКОВОДИТЕЛЯ =====")
        lines.append(rv.manager_notes_md[:2000])
    return "\n".join(lines)


async def build_calibration_context(
    session: AsyncSession, rv: SelfReview, emp: Employee
) -> str:
    """Цитаты из ревью + полный МПК-профиль с уровнями."""
    lines = _employee_header(emp)
    lines.append(f"Год: {rv.year}")
    lines.append("")
    if rv.source_text:
        lines.append("===== ТЕКСТ SELF-REVIEW =====")
        lines.append(rv.source_text[:10000])
        lines.append("")

    if not (emp.role_id and emp.grade_id):
        lines.append("Роль/грейд не назначены — калибровка ограничена.")
        return "\n".join(lines)

    rp_q = await session.execute(
        select(RoleProfile).where(
            RoleProfile.role_id == emp.role_id,
            RoleProfile.grade_id == emp.grade_id,
            RoleProfile.required_level > 0,
        )
    )
    required = {p.competency_id: p.required_level for p in rp_q.scalars()}

    cur_q = await session.execute(
        select(AssessmentScore.competency_id, AssessmentScore.level)
        .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
        .where(Assessment.employee_id == emp.id)
        .order_by(
            AssessmentScore.competency_id,
            Assessment.assessed_at.desc(),
            Assessment.id.desc(),
        )
        .distinct(AssessmentScore.competency_id)
    )
    current = {cid: lvl for cid, lvl in cur_q.all()}

    comp_q = await session.execute(select(Competency.id, Competency.name))
    name_by_id = {cid: n for cid, n in comp_q.all()}

    lines.append(
        "===== ОЦЕНКА РУКОВОДИТЕЛЯ ПО МПК ====="
    )
    lines.append(
        "Это оценки, которые руководитель проставил сотруднику в матрице "
        "профессиональных компетенций. Это НЕ самооценка сотрудника. "
        "Формат: «компетенция: оценка руководителя / целевой уровень для грейда (Δ)»"
    )
    rows = []
    for cid, req in required.items():
        cur = current.get(cid, 0)
        gap = req - cur
        rows.append((cid, req, cur, gap))
    rows.sort(key=lambda r: r[3])
    for cid, req, cur, gap in rows:
        marker = " ✓" if cur >= req else (" ↓" if gap > 0 else "")
        lines.append(f"  • {name_by_id.get(cid, cid)}: {cur} / {req} ({gap:+d}){marker}")

    return "\n".join(lines)


async def build_drafting_context(
    session: AsyncSession, rv: SelfReview, emp: Employee
) -> str:
    """Контекст для drafting helper'а: артефакты прошлого года + ИПР + МПК + проекты."""
    lines = _employee_header(emp)
    lines.append(f"Год отчёта: {rv.year}")
    lines.append("")

    # ИПР — если был
    rec_q = await session.execute(
        select(Recommendation)
        .where(Recommendation.employee_id == emp.id)
        .order_by(Recommendation.created_at.desc())
        .limit(1)
    )
    rec = rec_q.scalar_one_or_none()
    if rec is not None:
        lines.append(f"===== ПОСЛЕДНИЙ ИПР: {rec.title} =====")
        lines.append((rec.content_md or "")[:4000])
        lines.append("")

    # завершённые встречи и артефакты
    m_q = await session.execute(
        select(Meeting)
        .options(selectinload(Meeting.procedure))
        .where(Meeting.employee_id == emp.id, Meeting.status == "done")
        .order_by(Meeting.scheduled_at.desc())
        .limit(8)
    )
    meetings = list(m_q.scalars())
    if meetings:
        lines.append("===== ВСТРЕЧИ И АРТЕФАКТЫ =====")
        meeting_ids = [m.id for m in meetings]
        art_q = await session.execute(
            select(MeetingArtifact).where(MeetingArtifact.meeting_id.in_(meeting_ids))
        )
        arts_by_m: dict[int, list[MeetingArtifact]] = {}
        for a in art_q.scalars():
            arts_by_m.setdefault(a.meeting_id, []).append(a)
        for m in meetings:
            lines.append(f"\n— Встреча {m.scheduled_at.date()} (процедура: "
                         f"{m.procedure.title if m.procedure else '—'}):")
            if m.summary_md:
                lines.append(m.summary_md[:1000])
            for a in arts_by_m.get(m.id, [])[:5]:
                lines.append(f"  · [{a.kind}] {a.content[:300]}")
        lines.append("")

    # проекты
    pm_q = await session.execute(
        select(ProjectMember, Project)
        .join(Project, Project.id == ProjectMember.project_id)
        .where(ProjectMember.employee_id == emp.id)
        .order_by(ProjectMember.joined_at.desc())
        .limit(6)
    )
    pms = list(pm_q.all())
    if pms:
        lines.append("===== ПРОЕКТЫ =====")
        for pm, p in pms:
            lines.append(
                f"  • {p.name}: {pm.joined_at} — {pm.left_at or 'настоящее'} "
                f"({pm.role_in_project or '—'})"
            )
        lines.append("")

    # МПК-профиль кратко
    if emp.role_id and emp.grade_id:
        rp_q = await session.execute(
            select(RoleProfile).where(
                RoleProfile.role_id == emp.role_id,
                RoleProfile.grade_id == emp.grade_id,
                RoleProfile.required_level > 0,
            )
        )
        required = {p.competency_id: p.required_level for p in rp_q.scalars()}
        if required:
            cur_q = await session.execute(
                select(AssessmentScore.competency_id, AssessmentScore.level)
                .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
                .where(Assessment.employee_id == emp.id)
                .order_by(
                    AssessmentScore.competency_id,
                    Assessment.assessed_at.desc(),
                    Assessment.id.desc(),
                )
                .distinct(AssessmentScore.competency_id)
            )
            current = {cid: lvl for cid, lvl in cur_q.all()}
            comp_q = await session.execute(
                select(Competency.id, Competency.name).where(
                    Competency.id.in_(required.keys())
                )
            )
            name_by_id = {cid: n for cid, n in comp_q.all()}
            lines.append(
                "===== ОЦЕНКА РУКОВОДИТЕЛЯ ПО МПК ====="
            )
            lines.append(
                "Уровни от руководителя (НЕ самооценка)."
            )
            for cid, req in required.items():
                cur = current.get(cid, 0)
                gap = req - cur
                lines.append(
                    f"  • {name_by_id.get(cid, cid)}: оценка руководителя {cur}, "
                    f"целевой {req} (gap {gap:+d})"
                )
            lines.append("")

    # обучение для гэпов — если есть
    if emp.role_id and emp.grade_id:
        gap_ids = [
            cid
            for cid, req in required.items()
            if (req - current.get(cid, 0)) > 0
        ]
        if gap_ids:
            lr_q = await session.execute(
                select(LearningResource).where(
                    LearningResource.competency_id.in_(gap_ids)
                ).limit(20)
            )
            resources = list(lr_q.scalars())
            if resources:
                lines.append("===== РЕСУРСЫ ОБУЧЕНИЯ ПО ГЭПАМ =====")
                for r in resources:
                    lines.append(
                        f"  · {r.name} ({r.format or '—'}, {r.provider or '—'})"
                    )
                lines.append("")

    return "\n".join(lines)
