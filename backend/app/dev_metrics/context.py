"""Сборка контекста для AI-генерации цифрового профиля сотрудника.

Объединяет все доступные данные:
  • Базовые поля сотрудника (роль, грейд, отдел, стаж)
  • МПК-профиль: текущий vs требуемый, гэпы
  • История оценок (агрегат)
  • Self-Review за текущий год (если есть)
  • Dev-метрики: snapshot, top PR-ы
  • Извлечённые компетенции (с привязкой к PR-ам)
  • Проекты (текущие + история)
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.settings import is_codebuddy_live
from app.codebuddy.client import CodeBuddyAPIError
from app.codebuddy.service import codebuddy_service
from app.models.dev_metrics import (
    DevMetricsSnapshot,
    ExtractedCompetency,
    PullRequest,
)
from app.models.employee import Employee
from app.models.mpk import (
    Assessment,
    AssessmentScore,
    Competency,
    RoleProfile,
)
from app.models.project import Project, ProjectMember
from app.models.self_review import SelfReview
from app.schemas.dev_metrics import DevMetricsSnapshotPublic


async def build_digital_profile_context(
    session: AsyncSession, employee: Employee
) -> tuple[str, dict]:
    """Сформировать prompt-контекст + структурированный input_summary."""
    lines: list[str] = []
    summary: dict = {}

    # ---- 1) Сотрудник ----
    role_name = employee.role.name if employee.role else "—"
    grade = employee.grade.code if employee.grade else "—"
    dept = employee.department.name if employee.department else "—"
    tenure_days = (datetime.now(UTC).date() - employee.hired_at).days if employee.hired_at else None
    lines.append("## Сотрудник")
    lines.append(f"ФИО: {employee.full_name}")
    lines.append(f"Должность: {employee.position or '—'}")
    lines.append(f"Роль МПК: {role_name} / грейд {grade}")
    lines.append(f"Отдел: {dept}")
    hired_at = employee.hired_at
    if tenure_days is not None and hired_at is not None:
        years = tenure_days // 365
        months = (tenure_days % 365) // 30
        lines.append(f"Стаж в команде: {years} лет {months} мес (с {hired_at.isoformat()})")
    lines.append("")
    summary["employee"] = {
        "id": employee.id,
        "full_name": employee.full_name,
        "role": role_name,
        "grade": grade,
        "department": dept,
        "tenure_days": tenure_days,
    }

    # ---- 2) МПК профиль (текущий vs требуемый) ----
    if employee.role_id and employee.grade_id:
        req_q = await session.execute(
            select(RoleProfile, Competency)
            .join(Competency, Competency.id == RoleProfile.competency_id)
            .where(
                RoleProfile.role_id == employee.role_id,
                RoleProfile.grade_id == employee.grade_id,
                RoleProfile.required_level > 0,
            )
        )
        required = {comp.id: (rp.required_level, comp.name) for rp, comp in req_q.all()}
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
        current = {cid: lvl for cid, lvl in cur_q.all()}

        gaps = []
        ok_count = 0
        for cid, (req, cname) in required.items():
            cur = current.get(cid)
            if cur is None:
                gaps.append((cname, req, None, "не оценено"))
            elif cur < req:
                gaps.append((cname, req, cur, f"гэп +{req - cur}"))
            else:
                ok_count += 1

        lines.append("## МПК-профиль (заявлено)")
        lines.append(f"Соответствует требованиям: {ok_count} компетенций.")
        if gaps:
            lines.append("Гэпы / неоценено:")
            for cname, req, cur, note in gaps[:12]:
                cur_str = "—" if cur is None else str(cur)
                lines.append(f"  • {cname}: требуется L{req}, текущий L{cur_str} ({note})")
        lines.append("")
        summary["mpk_gaps_count"] = len(gaps)
        summary["mpk_ok_count"] = ok_count

    # ---- 3) Self-Review текущего года ----
    year = datetime.now(UTC).year
    sr_q = await session.execute(
        select(SelfReview)
        .where(SelfReview.employee_id == employee.id, SelfReview.year == year)
        .order_by(SelfReview.created_at.desc())
        .limit(1)
    )
    sr = sr_q.scalar_one_or_none()
    if sr is not None:
        lines.append(f"## Self-Review {year} (статус: {sr.status})")
        if sr.project_score is not None or sr.company_score is not None:
            lines.append(
                f"Оценки сотрудника: проект {sr.project_score or '—'} / "
                f"компания {sr.company_score or '—'} (по шкале 1-10)"
            )
        if sr.source_text:
            preview = sr.source_text.replace("\n", " ")[:600]
            lines.append(f"Текст ревью (фрагмент): {preview}")
        lines.append("")
        summary["self_review_year"] = year
        summary["self_review_status"] = sr.status

    # ---- 4) Dev-метрики (CodeBuddy live или mock) ----
    use_codebuddy = await is_codebuddy_live(session)
    period_to = date.today()
    period_from = period_to - timedelta(days=90)

    snap: DevMetricsSnapshotPublic | DevMetricsSnapshot | None = None
    if use_codebuddy:
        try:
            snap = await codebuddy_service.get_dev_metrics(employee, period_from, period_to)
        except CodeBuddyAPIError:
            snap = None  # сеть/auth упал — пропускаем секцию, не валим всю генерацию
    else:
        snap_q = await session.execute(
            select(DevMetricsSnapshot)
            .where(DevMetricsSnapshot.employee_id == employee.id)
            .order_by(DevMetricsSnapshot.period_end.desc())
            .limit(1)
        )
        snap = snap_q.scalar_one_or_none()

    if snap is not None:
        lines.append("## Активность разработки (последние 90 дней)")
        lines.append(
            f"PR-ов: {snap.total_mrs} · коммитов: {snap.total_commits} · "
            f"+{snap.lines_added}/−{snap.lines_removed} строк"
        )
        lines.append(
            f"Средний quality ratio: {int(snap.avg_quality_ratio * 100)}% "
            f"(% «зелёных» сигналов на PR)"
        )
        # Разбивка quality — даёт AI понимание «почему quality такой».
        qb = getattr(snap, "quality_breakdown", None)
        if qb is not None:
            lines.append(
                "  Из чего складывается quality: "
                f"conv.commits {int(qb.conventional_commits_pct)}% · "
                f"описания {int(qb.description_pct)}% · "
                f"размер PR {int(qb.size_pct)}%"
            )
        lines.append(
            f"С тестами: {snap.mr_with_tests}/{snap.total_mrs}, "
            f"с описанием: {snap.mr_with_description}/{snap.total_mrs}, "
            f"с review-обсуждением: {snap.mr_with_review_discussion}/{snap.total_mrs}"
        )
        lines.append(
            f"Среднее число итераций до merge: {snap.avg_iterations:.2f} · "
            f"среднее time-to-merge: "
            f"{snap.avg_time_to_merge_hours:.1f} ч"
            if snap.avg_time_to_merge_hours
            else f"Среднее число итераций до merge: {snap.avg_iterations:.2f}"
        )
        ai_received = getattr(snap, "ai_comments_received", 0) or 0
        if ai_received:
            lines.append(
                f"Комментариев: дал {snap.comments_given}, "
                f"получил {snap.comments_received} "
                f"(из них {ai_received} от AI-ревьюера)"
            )
        else:
            lines.append(
                f"Комментариев: дал {snap.comments_given}, получил {snap.comments_received}"
            )
        if snap.wip_count or snap.stale_count:
            lines.append(f"WIP сейчас: {snap.wip_count}, зависших: {snap.stale_count}")
        # Детали зависших PR — конкретные имена/возраст помогают AI говорить
        # про реальные риски, а не абстрактные «есть зависшие».
        wip_items = getattr(snap, "wip_mrs", None) or []
        stale_items = [w for w in wip_items if w.is_stale and w.state == "open"]
        if stale_items:
            threshold = getattr(snap, "stale_threshold_days", None)
            tail = f" (порог {threshold} дн.)" if threshold else ""
            lines.append(f"Зависшие PR-ы{tail}:")
            for w in stale_items[:5]:
                proj = w.project_name or "—"
                lines.append(f"  • !{w.mr_iid} «{w.title}» — {w.age_days} дн., проект {proj}")
        lines.append("")
        summary["dev_metrics"] = {
            "total_mrs": snap.total_mrs,
            "avg_quality_ratio": snap.avg_quality_ratio,
            "with_tests_ratio": snap.mr_with_tests / max(1, snap.total_mrs),
            "ai_comments_received": ai_received,
            "stale_count": snap.stale_count,
        }
        if qb is not None:
            summary["quality_breakdown"] = {
                "conv_commits_pct": qb.conventional_commits_pct,
                "description_pct": qb.description_pct,
                "size_pct": qb.size_pct,
            }

    # ---- 5) Извлечённые компетенции (CodeBuddy live или mock) ----
    # Расширенный кортеж: name, frequency, last_seen, frequency_score, top_signals_str, topics_str
    extracted_rows: list[tuple[str, int, datetime | None, float | None, str, str]] = []

    if use_codebuddy:
        try:
            resp = await codebuddy_service.get_extracted_competencies(
                employee, period_from, period_to
            )
            for it in resp.items[:15]:
                # Сжимаем топ-сигналы и темы в короткую строку для prompt'а —
                # модель не любит длинные nested-структуры в свободном тексте.
                sigs = ", ".join(f"{s.signal}×{s.occurrences}" for s in (it.top_signals or [])[:5])
                topics = "; ".join(
                    (
                        f"{t.topic}"
                        + (f" (ИПР L{t.recommended_level})" if t.recommended_level else "")
                        + f" — {int(t.score)}"
                    )
                    for t in (it.topic_coverage or [])[:4]
                )
                extracted_rows.append(
                    (
                        it.competency_name,
                        it.frequency,
                        it.last_seen_at,
                        it.frequency_score,
                        sigs,
                        topics,
                    )
                )
        except CodeBuddyAPIError:
            pass
    else:
        ec_q = await session.execute(
            select(ExtractedCompetency, Competency)
            .join(Competency, Competency.id == ExtractedCompetency.competency_id)
            .where(ExtractedCompetency.employee_id == employee.id)
            .order_by(ExtractedCompetency.frequency.desc())
            .limit(15)
        )
        for ec, comp in ec_q.all():
            extracted_rows.append((comp.name, ec.frequency, ec.last_seen_at, None, "", ""))

    if extracted_rows:
        lines.append("## Компетенции, реально проявленные в PR-ах")
        for name, freq, last_seen, fscore, sigs, topics in extracted_rows:
            score_part = f", score {int(fscore)}/100" if fscore is not None else ""
            seen_part = f", последний {last_seen.date().isoformat()}" if last_seen else ""
            lines.append(f"  • {name}: {freq} PR-ов{score_part}{seen_part}")
            if sigs:
                lines.append(f"      сигналы: {sigs}")
            if topics:
                lines.append(f"      покрытие ИПР: {topics}")
        lines.append("")
        summary["extracted_competencies_count"] = len(extracted_rows)

    # ---- 6) Проекты ----
    proj_q = await session.execute(
        select(ProjectMember, Project)
        .join(Project, Project.id == ProjectMember.project_id)
        .where(ProjectMember.employee_id == employee.id)
        .order_by(ProjectMember.joined_at.desc().nullslast())
    )
    proj_rows = list(proj_q.all())
    if proj_rows:
        current_proj = [(m, p) for m, p in proj_rows if m.left_at is None]
        past_proj = [(m, p) for m, p in proj_rows if m.left_at is not None]
        lines.append("## Проекты")
        if current_proj:
            lines.append("Сейчас:")
            for m, p in current_proj:
                lines.append(
                    f"  • {p.name} ({m.role_in_project or '—'}), "
                    f"с {m.joined_at.isoformat() if m.joined_at else '—'}"
                )
        if past_proj:
            lines.append("История:")
            for m, p in past_proj[:5]:
                lines.append(
                    f"  • {p.name} ({m.role_in_project or '—'}), {m.joined_at} — {m.left_at}"
                )
        lines.append("")
        summary["projects_current"] = len(current_proj)
        summary["projects_total"] = len(proj_rows)

    # ---- Топ PR-ы за период ----
    top_prs_rows: list[tuple[str, str, float, str | None, list[str]]] = []
    # (title, size_bucket, quality_ratio, project_name, feature_keys)

    if use_codebuddy:
        try:
            prs = await codebuddy_service.get_pull_requests(
                employee, period_from, period_to, limit=20
            )
            prs_sorted = sorted(
                prs,
                key=lambda p: (-p.quality_ratio, p.created_at_ext),
                reverse=False,
            )[:5]
            for p in prs_sorted:
                top_prs_rows.append(
                    (
                        p.title,
                        p.size_bucket,
                        p.quality_ratio,
                        p.project_name,
                        list(p.feature_keys or [])[:5],
                    )
                )
        except CodeBuddyAPIError:
            pass
    else:
        top_pr_q = await session.execute(
            select(PullRequest, Project.name)
            .outerjoin(Project, Project.id == PullRequest.project_id)
            .where(
                PullRequest.employee_id == employee.id,
                PullRequest.created_at_ext >= datetime.now(UTC) - timedelta(days=90),
            )
            .order_by(PullRequest.quality_ratio.desc(), PullRequest.created_at_ext.desc())
            .limit(5)
        )
        for pr, pname in top_pr_q.all():
            top_prs_rows.append((pr.title, pr.size_bucket, pr.quality_ratio, pname, []))

    if top_prs_rows:
        lines.append("## Топ PR-ов по quality_ratio (за 90 дней)")
        for title, bucket, qratio, pname, fkeys in top_prs_rows:
            base = f"  • [{bucket} · q={int(qratio * 100)}%] {title} ({pname or 'без проекта'})"
            lines.append(base)
            if fkeys:
                lines.append(f"      фичи: {', '.join(fkeys)}")
        lines.append("")

    return "\n".join(lines), summary
