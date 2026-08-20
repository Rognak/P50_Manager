import asyncio
import logging
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import selectinload

from app.admin.settings import is_codebuddy_live
from app.api.deps import (
    CurrentUser,
    SessionDep,
    effective_owner_id,
)
from app.codebuddy.client import CodeBuddyAPIError
from app.codebuddy.service import codebuddy_service
from app.models.candidate import CandidateProfile
from app.models.department import Department
from app.models.employee import Employee
from app.models.mpk import (
    AIJob,
    Assessment,
    AssessmentScore,
    Competency,
    Grade,
    Meeting,
    MpkProcedure,
    Role,
    RoleProfile,
    role_key_competencies,
)
from app.models.project import Project, ProjectMember
from app.models.rotation import Rotation
from app.models.self_review import SelfReview
from app.models.vacancy import Vacancy
from app.rotations.ranking import CandidateRow, compute_candidates
from app.schemas.dashboard import UpcomingMeeting
from app.schemas.dashboard import (
    DashboardMetrics,
    DevActivitySummary,
    DevLeaderboardEmployee,
    EmployeeRef,
    GapCompetencyItem,
    HiringStageBucket,
    HiringTopVacancy,
    RotationCandidateRef,
    StaleMrAlert,
    TeamCompetencyAggregate,
    TeamGradeBucket,
    TeamMetrics,
    TeamRecentEvent,
    TeamRoleBucket,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/metrics", response_model=DashboardMetrics)
async def get_metrics(
    session: SessionDep,
    current_user: CurrentUser,
    manager_id: int | None = None,
):
    today = date.today()
    one_year_ago = today - timedelta(days=365)
    thirty_days_ago_dt = datetime.now(UTC) - timedelta(days=30)
    thirty_days_ago = thirty_days_ago_dt.date()

    owner_id = effective_owner_id(current_user, manager_id)

    # core_team без выбранного руководителя — пустой дашборд
    if owner_id is None:
        return DashboardMetrics(
            employees_total=0,
            assessed_last_12m=0,
            not_assessed_last_12m=0,
            not_assessed_employees=[],
            procedures_planned=0,
            procedures_open=0,
            procedures_closed_last_12m=0,
            employees_with_role_grade=0,
            avg_gap_score=None,
            top_gap_competencies=[],
            assessments_last_30d=0,
            meetings_done_last_30d=0,
            ai_jobs_done_last_30d=0,
            rotations_completed_last_30d=0,
            rotations_completed_last_12m=0,
            rotations_in_progress=0,
            rotation_candidates_count=0,
            rotation_top_candidates=[],
            bus_factor_alerts=0,
            locked_members_count=0,
            self_review_year=today.year,
            self_review_total=0,
            self_review_drafts=0,
            self_review_submitted=0,
            self_review_closed=0,
            self_review_pending=0,
            self_review_avg_project=None,
            self_review_avg_company=None,
            self_review_days_to_year_end=(date(today.year, 12, 31) - today).days,
            self_review_stuck_submitted=0,
            self_review_stale_drafts=0,
            vacancies_open=0,
            vacancies_closed=0,
            candidates_total=0,
            candidates_in_pipeline=0,
            candidates_added_last_30d=0,
            candidates_hired_year=0,
            candidates_rejected_year=0,
            candidates_by_stage=[],
            top_vacancies=[],
        )

    # все «свои» активные сотрудники: кандидаты исключаются (у них свой раздел),
    # ушедшие (left_at не пуст) — тоже, их не нужно оценивать/учитывать в цикле
    emp_q = await session.execute(
        select(Employee)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .where(
            Employee.owner_id == owner_id,
            Employee.kind == "employee",
            Employee.left_at.is_(None),
        )
    )
    employees = list(emp_q.scalars())
    emp_ids = [e.id for e in employees]

    # последняя дата оценки на сотрудника
    last_by_emp: dict[int, date] = {}
    if emp_ids:
        last_q = await session.execute(
            select(Assessment.employee_id, func.max(Assessment.assessed_at))
            .where(Assessment.employee_id.in_(emp_ids))
            .group_by(Assessment.employee_id)
        )
        last_by_emp = {eid: dt for eid, dt in last_q.all()}

    assessed_year_ids = {eid for eid, dt in last_by_emp.items() if dt and dt >= one_year_ago}
    not_assessed = [e for e in employees if e.id not in assessed_year_ids]
    # сортируем сначала те, кого вообще не оценивали, потом по давности
    not_assessed.sort(
        key=lambda e: (
            last_by_emp.get(e.id) or date.min,
            e.full_name,
        )
    )
    # список показываем целиком — это рабочий перечень «кого оценить»
    not_assessed_refs = [
        EmployeeRef(
            id=e.id,
            full_name=e.full_name,
            last_assessed_at=last_by_emp.get(e.id),
            role_name=e.role.name if e.role else None,
            grade_code=e.grade.code if e.grade else None,
        )
        for e in not_assessed
    ]

    # процедуры: «запланирована» — открыта, но первая встреча ещё впереди;
    # «открыта» — открыта и хотя бы одна встреча уже прошла (процедура идёт).
    now_dt = datetime.now(UTC)
    procedures_planned = 0
    procedures_open = 0
    procedures_closed_last_12m = 0
    if emp_ids:
        proc_q = await session.execute(
            select(MpkProcedure)
            .options(selectinload(MpkProcedure.meetings))
            .where(MpkProcedure.employee_id.in_(emp_ids))
        )
        for p in proc_q.scalars():
            if p.status == "open":
                started = any(m.status == "done" or m.scheduled_at <= now_dt for m in p.meetings)
                if started:
                    procedures_open += 1
                else:
                    procedures_planned += 1
            elif p.status == "closed" and p.created_at.date() >= one_year_ago:
                procedures_closed_last_12m += 1

    # gap-аналитика по сотрудникам с role+grade и хотя бы одной оценкой
    employees_with_rg = [e for e in employees if e.role_id and e.grade_id and e.id in last_by_emp]
    avg_gap_score: float | None = None
    top_gap_competencies: list[GapCompetencyItem] = []

    if employees_with_rg:
        ids_rg = [e.id for e in employees_with_rg]
        # latest-per-comp current levels
        cur_q = await session.execute(
            select(
                Assessment.employee_id,
                AssessmentScore.competency_id,
                AssessmentScore.level,
            )
            .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
            .where(Assessment.employee_id.in_(ids_rg))
            .order_by(
                Assessment.employee_id,
                AssessmentScore.competency_id,
                Assessment.assessed_at.desc(),
                Assessment.id.desc(),
            )
            .distinct(Assessment.employee_id, AssessmentScore.competency_id)
        )
        current_by_emp_comp: dict[tuple[int, int], int] = {}
        for eid, cid, lvl in cur_q.all():
            current_by_emp_comp[(eid, cid)] = lvl

        # required levels по уникальным role/grade парам
        rg_pairs = {(e.role_id, e.grade_id) for e in employees_with_rg}
        required_by_rg_comp: dict[tuple[int, int, int], int] = {}
        if rg_pairs:
            conditions = [
                and_(RoleProfile.role_id == rid, RoleProfile.grade_id == gid)
                for rid, gid in rg_pairs
            ]
            rp_q = await session.execute(select(RoleProfile).where(or_(*conditions)))
            for rp in rp_q.scalars():
                if rp.required_level > 0:
                    required_by_rg_comp[(rp.role_id, rp.grade_id, rp.competency_id)] = (
                        rp.required_level
                    )

        # ключевые (★) компетенции по ролям — gap считаем только по ним
        key_by_role: dict[int, set[int]] = {}
        role_ids_rg = {e.role_id for e in employees_with_rg}
        if role_ids_rg:
            kq = await session.execute(
                select(
                    role_key_competencies.c.role_id,
                    role_key_competencies.c.competency_id,
                ).where(role_key_competencies.c.role_id.in_(role_ids_rg))
            )
            for rid, cid in kq.all():
                key_by_role.setdefault(rid, set()).add(cid)

        gap_sums: list[int] = []
        # по компетенции собираем: общее число сотрудников, у которых она требуется,
        # и список positive gap'ов
        comp_total: dict[int, int] = {}
        comp_gaps: dict[int, list[int]] = {}

        for e in employees_with_rg:
            emp_sum_gap = 0
            had_required = False
            for (rid, gid, cid), req in required_by_rg_comp.items():
                if rid != e.role_id or gid != e.grade_id:
                    continue
                if cid not in key_by_role.get(e.role_id, ()):
                    continue  # gap имеет смысл только для ключевых компетенций
                had_required = True
                comp_total[cid] = comp_total.get(cid, 0) + 1
                cur = current_by_emp_comp.get((e.id, cid), 0)
                gap = max(0, req - cur)
                if gap > 0:
                    emp_sum_gap += gap
                    comp_gaps.setdefault(cid, []).append(gap)
            if had_required:
                gap_sums.append(emp_sum_gap)

        if gap_sums:
            avg_gap_score = round(sum(gap_sums) / len(gap_sums), 2)

        if comp_gaps:
            comp_q = await session.execute(
                select(Competency).where(Competency.id.in_(comp_gaps.keys()))
            )
            comp_by_id = {c.id: c for c in comp_q.scalars()}
            items = [
                GapCompetencyItem(
                    competency_id=cid,
                    competency_name=(comp_by_id[cid].name if cid in comp_by_id else f"#{cid}"),
                    affected_count=len(gaps),
                    avg_gap=round(sum(gaps) / len(gaps), 2),
                    total_with_role=comp_total.get(cid, 0),
                )
                for cid, gaps in comp_gaps.items()
            ]
            items.sort(key=lambda x: (-x.affected_count, -x.avg_gap))
            top_gap_competencies = items[:5]

    # активность 30 дней
    assessments_30d = meetings_30d = ai_30d = 0
    if emp_ids:
        a30 = await session.execute(
            select(func.count(Assessment.id)).where(
                Assessment.employee_id.in_(emp_ids),
                Assessment.assessed_at >= thirty_days_ago,
            )
        )
        assessments_30d = a30.scalar() or 0

        m30 = await session.execute(
            select(func.count(Meeting.id)).where(
                Meeting.employee_id.in_(emp_ids),
                Meeting.status == "done",
                Meeting.scheduled_at >= thirty_days_ago_dt,
            )
        )
        meetings_30d = m30.scalar() or 0

        j30 = await session.execute(
            select(func.count(AIJob.id)).where(
                AIJob.employee_id.in_(emp_ids),
                AIJob.status == "done",
                AIJob.finished_at >= thirty_days_ago_dt,
            )
        )
        ai_30d = j30.scalar() or 0

    # ротации — общая картина по всем видимым проектам
    thirty_days_ago_dt_utc = datetime.now(UTC) - timedelta(days=30)
    one_year_ago_dt_utc = datetime.now(UTC) - timedelta(days=365)

    rot_30d_q = await session.execute(
        select(func.count(Rotation.id)).where(
            Rotation.status == "completed",
            Rotation.completed_at >= thirty_days_ago_dt_utc,
        )
    )
    rotations_completed_30d = rot_30d_q.scalar() or 0

    rot_12m_q = await session.execute(
        select(func.count(Rotation.id)).where(
            Rotation.status == "completed",
            Rotation.completed_at >= one_year_ago_dt_utc,
        )
    )
    rotations_completed_12m = rot_12m_q.scalar() or 0

    rot_inprog_q = await session.execute(
        select(func.count(Rotation.id)).where(Rotation.status.in_(("proposed", "accepted")))
    )
    rotations_in_progress = rot_inprog_q.scalar() or 0

    locked_q = await session.execute(
        select(func.count(ProjectMember.id)).where(
            ProjectMember.rotation_locked.is_(True),
            ProjectMember.left_at.is_(None),
        )
    )
    locked_members_count = locked_q.scalar() or 0

    # обходим все активные проекты — собираем кандидатов
    active_proj_q = await session.execute(
        select(Project.id, Project.name).where(Project.status == "active")
    )
    active_projects = list(active_proj_q.all())

    all_candidates: list[tuple[int, str, CandidateRow]] = []
    bus_alerts = 0
    for pid, pname in active_projects:
        cands = await compute_candidates(session, pid)
        for c in cands:
            all_candidates.append((pid, pname, c))
            if c.bus_factor_score > 0:
                bus_alerts += c.bus_factor_score

    rotation_candidates_count = len(all_candidates)
    all_candidates.sort(key=lambda t: (-t[2].score, -t[2].tenure_months))
    top = all_candidates[:5]

    rotation_top_candidates = [
        RotationCandidateRef(
            employee_id=c.employee_id,
            full_name=c.full_name,
            role_name=c.role_name,
            grade_code=c.grade_code,
            from_project_id=pid,
            from_project_name=pname,
            tenure_months=c.tenure_months,
            score=c.score,
            bus_factor_score=c.bus_factor_score,
        )
        for pid, pname, c in top
    ]

    # Self-Review за текущий год для «своих» сотрудников
    sr_year = today.year
    sr_total = sr_drafts = sr_submitted = sr_closed = 0
    sr_proj_scores: list[int] = []
    sr_comp_scores: list[int] = []
    sr_stuck_submitted = 0
    sr_stale_drafts = 0
    fourteen_days_ago = datetime.now(UTC) - timedelta(days=14)
    thirty_days_ago_utc = datetime.now(UTC) - timedelta(days=30)
    if emp_ids:
        srq = await session.execute(
            select(SelfReview).where(
                SelfReview.employee_id.in_(emp_ids),
                SelfReview.year == sr_year,
            )
        )
        for r in srq.scalars():
            sr_total += 1
            if r.status == "draft":
                sr_drafts += 1
                if r.source_data is None and r.created_at < thirty_days_ago_utc:
                    sr_stale_drafts += 1
            elif r.status == "submitted":
                sr_submitted += 1
                if r.submitted_at and r.submitted_at < fourteen_days_ago:
                    sr_stuck_submitted += 1
            elif r.status == "closed":
                sr_closed += 1
            if r.project_score is not None:
                sr_proj_scores.append(r.project_score)
            if r.company_score is not None:
                sr_comp_scores.append(r.company_score)
    sr_pending = max(0, len(employees) - sr_total)
    sr_avg = lambda xs: round(sum(xs) / len(xs), 2) if xs else None  # noqa: E731

    # дней до конца года
    sr_days_to_year_end = (date(sr_year, 12, 31) - today).days

    # ----- Найм: вакансии и кандидаты ----------------------------------------
    # Замечание: кандидат, прошедший hire, становится Employee.kind='employee',
    # но CandidateProfile остаётся как исторический след. Поэтому фильтруем
    # только по Employee.owner_id (без kind), как и в /candidates list.
    vac_status_q = await session.execute(
        select(Vacancy.status, func.count(Vacancy.id))
        .where(Vacancy.created_by_id == owner_id)
        .group_by(Vacancy.status)
    )
    vac_status: dict[str, int] = {
        vacancy_status: count for vacancy_status, count in vac_status_q.all()
    }
    vacancies_open = int(vac_status.get("open", 0))
    vacancies_closed = int(vac_status.get("closed", 0))

    stage_q = await session.execute(
        select(CandidateProfile.stage, func.count(CandidateProfile.id))
        .select_from(CandidateProfile)
        .join(Employee, Employee.id == CandidateProfile.employee_id)
        .where(Employee.owner_id == owner_id)
        .group_by(CandidateProfile.stage)
    )
    stage_counts: dict[str, int] = {s: int(n) for s, n in stage_q.all()}
    candidates_by_stage = [
        HiringStageBucket(stage=s, count=stage_counts.get(s, 0))
        for s in ("new", "screening", "interview", "offer", "hired", "rejected")
        if stage_counts.get(s, 0) > 0
    ]
    candidates_total = sum(stage_counts.values())
    candidates_in_pipeline = (
        candidates_total - stage_counts.get("hired", 0) - stage_counts.get("rejected", 0)
    )

    cand_added_q = await session.execute(
        select(func.count(CandidateProfile.id))
        .select_from(CandidateProfile)
        .join(Employee, Employee.id == CandidateProfile.employee_id)
        .where(
            Employee.owner_id == owner_id,
            CandidateProfile.created_at >= thirty_days_ago_dt,
        )
    )
    candidates_added_last_30d = int(cand_added_q.scalar() or 0)

    year_start = date(today.year, 1, 1)
    cand_hired_year_q = await session.execute(
        select(func.count(CandidateProfile.id))
        .select_from(CandidateProfile)
        .join(Employee, Employee.id == CandidateProfile.employee_id)
        .where(
            Employee.owner_id == owner_id,
            CandidateProfile.stage == "hired",
            Employee.hired_at >= year_start,
        )
    )
    candidates_hired_year = int(cand_hired_year_q.scalar() or 0)

    cand_rejected_year_q = await session.execute(
        select(func.count(CandidateProfile.id))
        .select_from(CandidateProfile)
        .join(Employee, Employee.id == CandidateProfile.employee_id)
        .where(
            Employee.owner_id == owner_id,
            CandidateProfile.stage == "rejected",
            CandidateProfile.updated_at >= datetime(today.year, 1, 1, tzinfo=UTC),
        )
    )
    candidates_rejected_year = int(cand_rejected_year_q.scalar() or 0)

    # Топ-5 вакансий по числу привязанных кандидатов
    top_vac_q = await session.execute(
        select(
            Vacancy,
            func.count(CandidateProfile.id).label("cnt"),
        )
        .select_from(Vacancy)
        .outerjoin(CandidateProfile, CandidateProfile.vacancy_id == Vacancy.id)
        .where(Vacancy.created_by_id == owner_id)
        .group_by(Vacancy.id)
        .order_by(func.count(CandidateProfile.id).desc(), Vacancy.created_at.desc())
        .limit(5)
    )
    top_vac_rows = list(top_vac_q.all())
    top_proj_ids = {v.project_id for v, _ in top_vac_rows if v.project_id}
    top_dept_ids = {v.department_id for v, _ in top_vac_rows if v.department_id}
    proj_names: dict[int, str] = {}
    dept_names: dict[int, str] = {}
    if top_proj_ids:
        q = await session.execute(
            select(Project.id, Project.name).where(Project.id.in_(top_proj_ids))
        )
        proj_names = {project_id: name for project_id, name in q.all()}
    if top_dept_ids:
        q = await session.execute(
            select(Department.id, Department.name).where(Department.id.in_(top_dept_ids))
        )
        dept_names = {department_id: name for department_id, name in q.all()}
    top_vacancies = [
        HiringTopVacancy(
            id=v.id,
            title=v.title,
            status=v.status,
            project_name=proj_names.get(v.project_id) if v.project_id else None,
            department_name=dept_names.get(v.department_id) if v.department_id else None,
            candidates_count=int(cnt or 0),
        )
        for v, cnt in top_vac_rows
    ]

    return DashboardMetrics(
        employees_total=len(employees),
        assessed_last_12m=len(assessed_year_ids),
        not_assessed_last_12m=len(not_assessed),
        not_assessed_employees=not_assessed_refs,
        procedures_planned=procedures_planned,
        procedures_open=procedures_open,
        procedures_closed_last_12m=procedures_closed_last_12m,
        employees_with_role_grade=sum(1 for e in employees if e.role_id and e.grade_id),
        avg_gap_score=avg_gap_score,
        top_gap_competencies=top_gap_competencies,
        assessments_last_30d=assessments_30d,
        meetings_done_last_30d=meetings_30d,
        ai_jobs_done_last_30d=ai_30d,
        rotations_completed_last_30d=rotations_completed_30d,
        rotations_completed_last_12m=rotations_completed_12m,
        rotations_in_progress=rotations_in_progress,
        rotation_candidates_count=rotation_candidates_count,
        rotation_top_candidates=rotation_top_candidates,
        bus_factor_alerts=bus_alerts,
        locked_members_count=locked_members_count,
        self_review_year=sr_year,
        self_review_total=sr_total,
        self_review_drafts=sr_drafts,
        self_review_submitted=sr_submitted,
        self_review_closed=sr_closed,
        self_review_pending=sr_pending,
        self_review_avg_project=sr_avg(sr_proj_scores),
        self_review_avg_company=sr_avg(sr_comp_scores),
        self_review_days_to_year_end=sr_days_to_year_end,
        self_review_stuck_submitted=sr_stuck_submitted,
        self_review_stale_drafts=sr_stale_drafts,
        vacancies_open=vacancies_open,
        vacancies_closed=vacancies_closed,
        candidates_total=candidates_total,
        candidates_in_pipeline=candidates_in_pipeline,
        candidates_added_last_30d=candidates_added_last_30d,
        candidates_hired_year=candidates_hired_year,
        candidates_rejected_year=candidates_rejected_year,
        candidates_by_stage=candidates_by_stage,
        top_vacancies=top_vacancies,
    )


def _months_between(a: date, b: date) -> int:
    return (b.year - a.year) * 12 + (b.month - a.month) + (1 if b.day >= a.day else 0)


@router.get("/upcoming", response_model=list[UpcomingMeeting])
async def get_upcoming_meetings(
    session: SessionDep,
    current_user: CurrentUser,
    days: int = 30,
    limit: int = 20,
    manager_id: int | None = None,
):
    """Ближайшие встречи из трёх источников: МПК, найм, self-review.

    days — горизонт вперёд в днях (по умолчанию 30).
    Сотрудники — только «свои» (по owner_id), для core_team — выбранного manager_id."""
    now = datetime.now(UTC)
    horizon = now + timedelta(days=max(1, days))

    owner_id = effective_owner_id(current_user, manager_id)
    if owner_id is None:
        return []

    # все «свои» (включая кандидатов) — для встреч
    eq = await session.execute(select(Employee).where(Employee.owner_id == owner_id))
    owned = {e.id: e for e in eq.scalars()}
    if not owned:
        return []
    emp_ids = list(owned.keys())

    # 1) Meetings (планируемые) — МПК или найм
    mq = await session.execute(
        select(Meeting)
        .where(
            Meeting.employee_id.in_(emp_ids),
            Meeting.status == "planned",
            Meeting.scheduled_at >= now,
            Meeting.scheduled_at <= horizon,
        )
        .order_by(Meeting.scheduled_at)
    )
    meetings = list(mq.scalars())

    items: list[UpcomingMeeting] = []
    for m in meetings:
        emp = owned.get(m.employee_id)
        if emp is None:
            continue
        # МПК-встреча — если есть procedure_id и сотрудник kind='employee'
        # Найм-встреча — если сотрудник kind='candidate'
        # Иначе — обычная meeting (нет MPK procedure, не кандидат) — попадает в МПК
        if emp.kind == "candidate":
            kind = "hiring"
            title = "Интервью"
        else:
            kind = "mpk"
            title = "Встреча 1:1 (МПК)" if m.procedure_id else "Встреча 1:1"
        items.append(
            UpcomingMeeting(
                kind=kind,
                when=m.scheduled_at,
                employee_id=emp.id,
                employee_name=emp.full_name,
                employee_kind=emp.kind,
                title=title,
                meeting_id=m.id,
                self_review_id=None,
            )
        )

    # 2) Self-Review 1:1
    srq = await session.execute(
        select(SelfReview)
        .where(
            SelfReview.employee_id.in_(emp_ids),
            SelfReview.scheduled_1on1_at.is_not(None),
            SelfReview.scheduled_1on1_at >= now,
            SelfReview.scheduled_1on1_at <= horizon,
        )
        .order_by(SelfReview.scheduled_1on1_at)
    )
    for rv in srq.scalars():
        emp = owned.get(rv.employee_id)
        if emp is None:
            continue
        if rv.scheduled_1on1_at is None:
            continue
        items.append(
            UpcomingMeeting(
                kind="self_review",
                when=rv.scheduled_1on1_at,
                employee_id=emp.id,
                employee_name=emp.full_name,
                employee_kind=emp.kind,
                title=f"1:1 по Self-Review {rv.year}",
                meeting_id=None,
                self_review_id=rv.id,
            )
        )

    items.sort(key=lambda x: x.when)
    return items[: max(1, limit)]


@router.get("/team", response_model=TeamMetrics)
async def get_team_metrics(
    session: SessionDep,
    current_user: CurrentUser,
    manager_id: int | None = None,
):
    """Динамика и состав команды текущего руководителя.

    Активные = left_at IS NULL. Все «всё-время» включают тех, кто ушёл — это
    нужно для корректного подсчёта «ушло за год».
    """
    today = date.today()
    year_start = date(today.year, 1, 1)

    owner_id = effective_owner_id(current_user, manager_id)
    if owner_id is None:
        return TeamMetrics(
            total_active=0,
            total_all_time=0,
            interns=0,
            without_role=0,
            without_grade=0,
            without_hire_date=0,
            avg_tenure_months=None,
            hired_year=today.year,
            hired_count_year=0,
            left_count_year=0,
            net_change_year=0,
            grades=[],
            roles=[],
            recent_hires=[],
            recent_leaves=[],
        )

    eq = await session.execute(
        select(Employee).where(Employee.owner_id == owner_id, Employee.kind == "employee")
    )
    employees = list(eq.scalars())

    active = [e for e in employees if e.left_at is None]
    total_active = len(active)
    total_all_time = len(employees)

    # грейды и роли — по активным
    grade_ids = {e.grade_id for e in active if e.grade_id}
    role_ids = {e.role_id for e in active if e.role_id}
    grades_by_id: dict[int, Grade] = {}
    if grade_ids:
        gq = await session.execute(select(Grade).where(Grade.id.in_(grade_ids)))
        grades_by_id = {g.id: g for g in gq.scalars()}
    roles_by_id: dict[int, Role] = {}
    if role_ids:
        rq = await session.execute(select(Role).where(Role.id.in_(role_ids)))
        roles_by_id = {r.id: r for r in rq.scalars()}

    grade_count: dict[int, int] = {}
    role_count: dict[int, int] = {}
    interns = 0
    without_role = 0
    without_grade = 0
    without_hire_date = 0
    tenure_months_sum = 0
    tenure_months_n = 0

    for e in active:
        if e.role_id is None:
            without_role += 1
        else:
            role_count[e.role_id] = role_count.get(e.role_id, 0) + 1
        if e.grade_id is None:
            without_grade += 1
        else:
            grade_count[e.grade_id] = grade_count.get(e.grade_id, 0) + 1
            g = grades_by_id.get(e.grade_id)
            if g and g.code == "Intern":
                interns += 1
        if e.hired_at is None:
            without_hire_date += 1
        else:
            tenure_months_sum += _months_between(e.hired_at, today)
            tenure_months_n += 1

    avg_tenure_months: float | None = None
    if tenure_months_n > 0:
        avg_tenure_months = round(tenure_months_sum / tenure_months_n, 1)

    grades_buckets = [
        TeamGradeBucket(
            grade_code=grades_by_id[gid].code,
            sort_order=grades_by_id[gid].sort_order,
            count=cnt,
        )
        for gid, cnt in grade_count.items()
        if gid in grades_by_id
    ]
    grades_buckets.sort(key=lambda b: b.sort_order)

    roles_buckets = [
        TeamRoleBucket(role_id=rid, role_name=roles_by_id[rid].name, count=cnt)
        for rid, cnt in role_count.items()
        if rid in roles_by_id
    ]
    roles_buckets.sort(key=lambda b: (-b.count, b.role_name))

    # наняты в этом году (включая ушедших — фиксируем факт найма)
    hired_year = [e for e in employees if e.hired_at is not None and e.hired_at >= year_start]
    # ушли в этом году
    left_year = [e for e in employees if e.left_at is not None and e.left_at >= year_start]

    def _ev(e: Employee, at: date) -> TeamRecentEvent:
        return TeamRecentEvent(
            employee_id=e.id,
            full_name=e.full_name,
            role_name=roles_by_id[e.role_id].name
            if e.role_id and e.role_id in roles_by_id
            else None,
            grade_code=grades_by_id[e.grade_id].code
            if e.grade_id and e.grade_id in grades_by_id
            else None,
            at=at,
        )

    recent_hires = sorted(hired_year, key=lambda e: e.hired_at or year_start, reverse=True)
    recent_leaves = sorted(left_year, key=lambda e: e.left_at or year_start, reverse=True)

    return TeamMetrics(
        total_active=total_active,
        total_all_time=total_all_time,
        interns=interns,
        without_role=without_role,
        without_grade=without_grade,
        without_hire_date=without_hire_date,
        avg_tenure_months=avg_tenure_months,
        hired_year=today.year,
        hired_count_year=len(hired_year),
        left_count_year=len(left_year),
        net_change_year=len(hired_year) - len(left_year),
        grades=grades_buckets,
        roles=roles_buckets,
        recent_hires=[_ev(e, e.hired_at) for e in recent_hires[:10] if e.hired_at],
        recent_leaves=[_ev(e, e.left_at) for e in recent_leaves[:10] if e.left_at],
    )


# Лимит на параллельные запросы к CodeBuddy в одном dev-activity вызове.
# При CodeBuddy rate-limit 60 req/min параллельный пакет из 25 запросов
# отрабатывает за < 5с (с уже прогретыми Redis-кэшами — мгновенно).
_DEV_ACTIVITY_MAX_EMPLOYEES = 20


@router.get("/dev-activity", response_model=DevActivitySummary)
async def get_dev_activity(
    session: SessionDep,
    current_user: CurrentUser,
    manager_id: int | None = None,
    period_days: int = 90,
):
    """Сводка по dev-активности команды из CodeBuddy.

    Если интеграция выключена — возвращает enabled=False и пустые поля.
    Иначе параллельно собирает snapshots по «своим» сотрудникам (до 30
    наиболее активных) и агрегирует stale/wip + топ-компетенции.
    """
    owner_id = effective_owner_id(current_user, manager_id)
    if owner_id is None:
        return DevActivitySummary(
            enabled=False,
            team_size=0,
            with_metrics=0,
            total_mrs=0,
            stale_total=0,
            wip_total=0,
        )

    if not await is_codebuddy_live(session):
        # Считаем команду для шапки, но не дёргаем CodeBuddy.
        cnt_q = await session.execute(
            select(func.count(Employee.id)).where(
                Employee.owner_id == owner_id,
                Employee.kind == "employee",
                Employee.left_at.is_(None),
            )
        )
        return DevActivitySummary(
            enabled=False,
            team_size=int(cnt_q.scalar() or 0),
            with_metrics=0,
            total_mrs=0,
            stale_total=0,
            wip_total=0,
        )

    period_days = max(7, min(period_days, 365))
    period_to = date.today()
    period_from = period_to - timedelta(days=period_days)

    eq = await session.execute(
        select(Employee).where(
            Employee.owner_id == owner_id,
            Employee.kind == "employee",
            Employee.left_at.is_(None),
        )
    )
    employees = list(eq.scalars())
    team_size = len(employees)
    if not employees:
        return DevActivitySummary(
            enabled=True,
            team_size=0,
            with_metrics=0,
            total_mrs=0,
            stale_total=0,
            wip_total=0,
            period_from=period_from,
            period_to=period_to,
        )

    targets = employees[:_DEV_ACTIVITY_MAX_EMPLOYEES]

    async def _one(emp: Employee):
        try:
            snap = await codebuddy_service.get_dev_metrics(emp, period_from, period_to)
            comp = await codebuddy_service.get_extracted_competencies(emp, period_from, period_to)
            return emp, snap, comp
        except CodeBuddyAPIError as e:
            logger.warning("dev-activity: %s skip due to CodeBuddy error: %s", emp.id, e)
            return emp, None, None

    results = await asyncio.gather(*[_one(e) for e in targets])

    stale_alerts: list[StaleMrAlert] = []
    by_comp: dict[int, dict] = {}
    total_mrs = 0
    quality_acc = 0.0
    quality_n = 0
    stale_total = 0
    wip_total = 0
    with_metrics = 0
    leaderboard: list[DevLeaderboardEmployee] = []

    for emp, snap, comp in results:
        if snap is not None:
            with_metrics += 1
            total_mrs += snap.total_mrs
            quality_acc += float(snap.avg_quality_ratio or 0)
            quality_n += 1
            stale_total += snap.stale_count
            wip_total += snap.wip_count
            leaderboard.append(
                DevLeaderboardEmployee(
                    employee_id=emp.id,
                    full_name=emp.full_name,
                    total_mrs=snap.total_mrs,
                    avg_quality_ratio=float(snap.avg_quality_ratio or 0),
                    comments_given=snap.comments_given,
                    avg_time_to_merge_hours=snap.avg_time_to_merge_hours,
                    tests_ratio=(snap.mr_with_tests / snap.total_mrs) if snap.total_mrs else 0,
                    stale_count=snap.stale_count,
                )
            )
            stale_prs = [w for w in (snap.wip_mrs or []) if w.is_stale and w.state == "open"]
            if stale_prs:
                stale_prs_sorted = sorted(stale_prs, key=lambda w: -w.age_days)
                oldest = stale_prs_sorted[0]
                stale_alerts.append(
                    StaleMrAlert(
                        employee_id=emp.id,
                        full_name=emp.full_name,
                        stale_count=len(stale_prs),
                        oldest_age_days=oldest.age_days,
                        sample_title=oldest.title or None,
                        sample_url=oldest.url,
                    )
                )

        if comp is not None:
            for it in comp.items:
                if it.frequency <= 0:
                    continue
                bucket = by_comp.setdefault(
                    it.competency_id,
                    {
                        "name": it.competency_name,
                        "total": 0,
                        "employees_with": 0,
                    },
                )
                bucket["total"] += it.frequency
                bucket["employees_with"] += 1

    stale_alerts.sort(key=lambda a: -a.oldest_age_days)
    top_competencies = [
        TeamCompetencyAggregate(
            competency_id=cid,
            competency_name=str(info["name"]),
            total_signal_count=int(info["total"]),
            employees_with=int(info["employees_with"]),
        )
        for cid, info in sorted(
            by_comp.items(),
            key=lambda kv: (-kv[1]["employees_with"], -kv[1]["total"]),
        )[:8]
    ]

    avg_quality = (quality_acc / quality_n) if quality_n else None

    return DevActivitySummary(
        enabled=True,
        period_from=period_from,
        period_to=period_to,
        team_size=team_size,
        with_metrics=with_metrics,
        total_mrs=total_mrs,
        avg_quality_ratio=avg_quality,
        stale_total=stale_total,
        wip_total=wip_total,
        stale_alerts=stale_alerts[:10],
        top_competencies=top_competencies,
        leaderboard=leaderboard,
    )
