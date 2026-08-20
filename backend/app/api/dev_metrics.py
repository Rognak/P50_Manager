"""API для dev-метрик, извлечённых компетенций и цифрового профиля сотрудника.

Read-only. Источник зависит от feature-flag `integrations.codebuddy_live`
в админ-настройках:
  • False (по умолчанию) — читаем из mock-таблиц `dev_metrics_snapshots`,
    `pull_requests`, `extracted_competencies` (для локальной разработки).
  • True — читаем live из CodeBuddy через `codebuddy_service`.

Сигнатуры endpoint'ов и Pydantic-схемы одинаковы для обоих режимов, фронт
о коммутации не знает.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.admin.settings import is_codebuddy_live, is_gitlab_auto_sync_enabled
from app.api.deps import CurrentUser, MutatorUser, SessionDep, can_view_employee_owned_by
from app.codebuddy.client import CodeBuddyAPIError
from app.codebuddy.projects_sync import sync_projects_from_codebuddy
from app.codebuddy.service import codebuddy_service
from app.gitlab_status import (
    GitLabStatusError,
    cache_merge_request_status,
    check_repository_access,
    fetch_merge_request_status,
    resolve_gitlab_config,
)
from app.models.dev_metrics import (
    DigitalProfile,
    ExtractedCompetency,
    PullRequest,
)
from app.models.employee import Employee
from app.models.mpk import (
    AIJob,
    Assessment,
    AssessmentScore,
    Competency,
    RoleProfile,
)
from app.models.project import Project, ProjectMember
from app.redis_pool import get_pool
from app.schemas.ai_job import AIJobPublic
from app.schemas.dev_metrics import (
    DevMetricsSnapshotPublic,
    DigitalProfilePublic,
    ExtractedCompetenciesResponse,
    ExtractedCompetencyItem,
    ProjectExtractedCompetenciesResponse,
    ProjectExtractedCompetencyItem,
    PullRequestPublic,
    PullRequestStatusAccess,
    PullRequestStatusRequest,
    PullRequestStatusSync,
)

router = APIRouter(prefix="/employees", tags=["dev-metrics"])
project_router = APIRouter(prefix="/projects", tags=["dev-metrics"])


async def _load_owned_employee(session, employee_id: int, current_user) -> Employee:
    """То же что в employees.py: владелец видит свои, CoreTeam — всех."""
    emp = await session.get(Employee, employee_id)
    if emp is None or not can_view_employee_owned_by(current_user, emp.owner_id):
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return emp


# Дефолтный период анализа — последние 90 дней. Согласован с тем, что генерирует
# seed_dev_metrics.py для DevMetricsSnapshot.
DEFAULT_PERIOD_DAYS = 90


def _resolve_period(
    from_date: date | None, to_date: date | None
) -> tuple[datetime, datetime, date, date]:
    """Вернуть (from_dt, to_dt, from_date, to_date) с дефолтами.
    `to` включительно — конвертируется в start_of_next_day для сравнения."""
    today = date.today()
    if to_date is None:
        to_date = today
    if from_date is None:
        from_date = to_date - timedelta(days=DEFAULT_PERIOD_DAYS)
    from_dt = datetime.combine(from_date, datetime.min.time(), tzinfo=UTC)
    # включительно до конца дня
    to_dt = datetime.combine(to_date, datetime.max.time(), tzinfo=UTC)
    return from_dt, to_dt, from_date, to_date


async def _enrich_with_mpk_levels(
    session, employee: Employee, items: list[ExtractedCompetencyItem]
) -> None:
    """Дополнить элементы ExtractedCompetencyItem нашими МПК-уровнями
    (required_level из RoleProfile + current_level из последней Assessment).
    CodeBuddy эти поля не знает — таксономия наша, а уровни хранятся локально.
    """
    if not items:
        return
    comp_ids = [it.competency_id for it in items]

    # required_level: из RoleProfile роли+грейда сотрудника
    if employee.role_id and employee.grade_id:
        rq = await session.execute(
            select(RoleProfile.competency_id, RoleProfile.required_level).where(
                RoleProfile.role_id == employee.role_id,
                RoleProfile.grade_id == employee.grade_id,
                RoleProfile.competency_id.in_(comp_ids),
            )
        )
        req_map = {cid: lvl for cid, lvl in rq.all()}
        for it in items:
            if it.competency_id in req_map:
                it.required_level = req_map[it.competency_id]

    # current_level: из последней Assessment
    cur_q = await session.execute(
        select(AssessmentScore.competency_id, AssessmentScore.level)
        .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
        .where(
            Assessment.employee_id == employee.id,
            AssessmentScore.competency_id.in_(comp_ids),
        )
        .order_by(
            AssessmentScore.competency_id,
            Assessment.assessed_at.desc(),
            Assessment.id.desc(),
        )
        .distinct(AssessmentScore.competency_id)
    )
    cur_map = {cid: lvl for cid, lvl in cur_q.all()}
    for it in items:
        if it.competency_id in cur_map:
            it.current_level = cur_map[it.competency_id]


def _codebuddy_error_to_http(e: CodeBuddyAPIError) -> HTTPException:
    """CodeBuddy 4xx/5xx → HTTPException, понятная для UI."""
    code = e.status_code or 502
    # 429 пропускаем 1:1, остальное 5xx — 502 (мы — proxy)
    http_code = 429 if code == 429 else 502
    return HTTPException(status_code=http_code, detail=f"CodeBuddy: {e}")


async def _filter_examples_by_pr_date(
    session,
    examples: list[dict],
    from_dt: datetime,
    to_dt: datetime,
    date_cache: dict[int, datetime] | None = None,
) -> list[dict]:
    """Отфильтровать pr_examples по дате создания PR (по таблице pull_requests).

    `date_cache` — необязательная карта pr_id → created_at_ext, чтобы при батче
    не делать один запрос на каждую компетенцию.
    """
    if not examples:
        return []
    pr_ids = [e.get("pr_id") for e in examples if e.get("pr_id") is not None]
    if not pr_ids:
        return []
    if date_cache is not None:
        missing = [pid for pid in pr_ids if pid not in date_cache]
        if missing:
            dq = await session.execute(
                select(PullRequest.id, PullRequest.created_at_ext).where(
                    PullRequest.id.in_(missing)
                )
            )
            for pid, d in dq.all():
                date_cache[pid] = d
        m = date_cache
    else:
        dq = await session.execute(
            select(PullRequest.id, PullRequest.created_at_ext).where(PullRequest.id.in_(pr_ids))
        )
        m = dict(dq.all())
    out: list[dict] = []
    for ex in examples:
        pid = ex.get("pr_id")
        d = m.get(pid) if pid is not None else None
        if d is None:
            continue
        if d < from_dt or d > to_dt:
            continue
        out.append(ex)
    return out


# ----- /employees/{id}/dev-metrics -----------------------------------------


@router.get(
    "/{employee_id}/dev-metrics",
    response_model=DevMetricsSnapshotPublic | None,
)
async def get_employee_dev_metrics(
    employee_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
):
    """Агрегированные dev-метрики сотрудника за период.

    Источник определяется feature-flag `integrations.codebuddy_live`.
    """
    emp = await _load_owned_employee(session, employee_id, current_user)
    from_dt, to_dt, period_start, period_end = _resolve_period(from_date, to_date)

    if await is_codebuddy_live(session):
        try:
            snap = await codebuddy_service.get_dev_metrics(emp, period_start, period_end)
        except CodeBuddyAPIError as e:
            raise _codebuddy_error_to_http(e) from e
        # Авто-создание проектов из wip_mrs (если есть). Опускаем при пустом
        # snapshot — нет смысла дёргать БД.
        if snap is not None and snap.wip_mrs:
            try:
                seen = [
                    (w.project_id, w.project_name, w.created_at, w.url)
                    for w in snap.wip_mrs
                    if w.project_id
                ]
                await sync_projects_from_codebuddy(session, emp, seen)
            except Exception:  # noqa: BLE001 — sync не должен валить read
                await session.rollback()
        return snap

    # Mock-fallback: считаем из локальной таблицы pull_requests.
    prq = await session.execute(
        select(PullRequest).where(
            PullRequest.employee_id == employee_id,
            PullRequest.created_at_ext >= from_dt,
            PullRequest.created_at_ext <= to_dt,
        )
    )
    prs = list(prq.scalars())
    if not prs:
        return None

    n = len(prs)
    size_counts = {"XS": 0, "S": 0, "M": 0, "L": 0, "XL": 0}
    with_tests = with_descr = with_review = 0
    sum_iter = 0
    sum_qr = 0.0
    ttm_values: list[float] = []
    lines_added = 0
    lines_removed = 0
    comments_received = 0
    wip_count = 0
    stale_count = 0
    stale_cutoff = datetime.now(UTC) - timedelta(days=14)
    for p in prs:
        size_counts[p.size_bucket] = size_counts.get(p.size_bucket, 0) + 1
        sigs = p.signals or {}
        if sigs.get("has_tests"):
            with_tests += 1
        if sigs.get("has_description"):
            with_descr += 1
        if sigs.get("has_review_discussion"):
            with_review += 1
        sum_iter += p.iterations
        sum_qr += p.quality_ratio
        if p.time_to_merge_hours is not None:
            ttm_values.append(p.time_to_merge_hours)
        lines_added += p.additions
        lines_removed += p.deletions
        comments_received += p.comments_count
        if p.state == "open":
            wip_count += 1
            if p.created_at_ext < stale_cutoff:
                stale_count += 1

    return DevMetricsSnapshotPublic(
        period_start=period_start,
        period_end=period_end,
        # total_commits — синтетический индикатор (нет отдельной таблицы коммитов
        # в нашей модели), приближаем суммой итераций × 2
        total_commits=sum_iter * 2,
        total_mrs=n,
        lines_added=lines_added,
        lines_removed=lines_removed,
        mr_size_xs=size_counts["XS"],
        mr_size_s=size_counts["S"],
        mr_size_m=size_counts["M"],
        mr_size_l=size_counts["L"],
        mr_size_xl=size_counts["XL"],
        mr_with_tests=with_tests,
        mr_with_description=with_descr,
        mr_with_review_discussion=with_review,
        avg_iterations=round(sum_iter / n, 2) if n else 0.0,
        avg_time_to_merge_hours=(
            round(sum(ttm_values) / len(ttm_values), 1) if ttm_values else None
        ),
        avg_quality_ratio=round(sum_qr / n, 2) if n else 0.0,
        # comments_given не хранится по периодам — оставляем 0 (мок-ограничение)
        comments_given=0,
        comments_received=comments_received,
        wip_count=wip_count,
        stale_count=stale_count,
    )


# ----- /employees/{id}/pull-requests ---------------------------------------


@router.get("/{employee_id}/pull-requests", response_model=list[PullRequestPublic])
async def list_employee_pull_requests(
    employee_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=500),
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
):
    """PR-ы сотрудника. По умолчанию — последние 90 дней."""
    emp = await _load_owned_employee(session, employee_id, current_user)
    from_dt, to_dt, period_start, period_end = _resolve_period(from_date, to_date)

    if await is_codebuddy_live(session):
        try:
            prs = await codebuddy_service.get_pull_requests(
                emp, period_start, period_end, limit=limit
            )
        except CodeBuddyAPIError as e:
            raise _codebuddy_error_to_http(e) from e
        # Авто-создание проектов из списка PR. Идёмпотентно, без падения read'а.
        try:
            seen = [
                (p.project_id, p.project_name, p.created_at_ext, p.url) for p in prs if p.project_id
            ]
            await sync_projects_from_codebuddy(session, emp, seen)
        except Exception:  # noqa: BLE001
            await session.rollback()
        return prs

    # Mock-fallback
    q = await session.execute(
        select(PullRequest, Project.name)
        .outerjoin(Project, Project.id == PullRequest.project_id)
        .where(
            PullRequest.employee_id == employee_id,
            PullRequest.created_at_ext >= from_dt,
            PullRequest.created_at_ext <= to_dt,
        )
        .order_by(PullRequest.created_at_ext.desc())
        .limit(limit)
    )
    out: list[PullRequestPublic] = []
    for pr, pname in q.all():
        item = PullRequestPublic.model_validate(pr)
        item.project_name = pname
        out.append(item)
    return out


@router.post(
    "/{employee_id}/pull-requests/status-access",
    response_model=PullRequestStatusAccess,
)
async def pull_request_status_access(
    employee_id: int,
    payload: PullRequestStatusRequest,
    session: SessionDep,
    current_user: CurrentUser,
):
    """Проверить сеть, конфигурацию и права на конкретный GitLab-репозиторий."""
    await _load_owned_employee(session, employee_id, current_user)
    auto_sync_enabled = await is_gitlab_auto_sync_enabled(session)
    config = await resolve_gitlab_config(session)
    try:
        await check_repository_access(str(payload.url), config)
    except GitLabStatusError as exc:
        return PullRequestStatusAccess(
            available=False,
            reason=str(exc),
            auto_sync_enabled=auto_sync_enabled,
        )
    return PullRequestStatusAccess(available=True, auto_sync_enabled=auto_sync_enabled)


@router.post(
    "/{employee_id}/pull-requests/sync-status",
    response_model=PullRequestStatusSync,
)
async def sync_pull_request_status(
    employee_id: int,
    payload: PullRequestStatusRequest,
    session: SessionDep,
    current_user: CurrentUser,
):
    """Вручную получить актуальный статус PR напрямую из GitLab."""
    await _load_owned_employee(session, employee_id, current_user)
    config = await resolve_gitlab_config(session)
    try:
        state, merged_at, checked_at = await fetch_merge_request_status(str(payload.url), config)
    except GitLabStatusError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    await cache_merge_request_status(str(payload.url), state, merged_at, checked_at)
    return PullRequestStatusSync(state=state, merged_at=merged_at, checked_at=checked_at)


# ----- /employees/{id}/extracted-competencies ------------------------------


@router.get(
    "/{employee_id}/extracted-competencies",
    response_model=ExtractedCompetenciesResponse,
)
async def get_extracted_competencies(
    employee_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
    include_answers: bool = Query(default=False),
):
    """Извлечённые из PR компетенции + сопоставление с заявленным МПК-уровнем.

    Параметры `from`/`to` (YYYY-MM-DD) фильтруют по дате создания PR.
    `include_answers=true` — запросить у CodeBuddy развёрнутые рекомендации
    из PDF (mptkAnswer). По умолчанию — последние 90 дней без mptkAnswer.
    """
    emp = await _load_owned_employee(session, employee_id, current_user)
    from_dt, to_dt, period_start, period_end = _resolve_period(from_date, to_date)

    if await is_codebuddy_live(session):
        try:
            resp = await codebuddy_service.get_extracted_competencies(
                emp, period_start, period_end, include_answers=include_answers
            )
        except CodeBuddyAPIError as e:
            raise _codebuddy_error_to_http(e) from e
        # Дополняем required/current уровень из локальной МПК — это наша
        # таксономия, CodeBuddy её не знает.
        await _enrich_with_mpk_levels(session, emp, resp.items)
        return resp

    # Mock-fallback: считаем из локальной таблицы extracted_competencies.
    eq = await session.execute(
        select(ExtractedCompetency, Competency)
        .join(Competency, Competency.id == ExtractedCompetency.competency_id)
        .where(ExtractedCompetency.employee_id == employee_id)
    )
    extracted_rows = list(eq.all())
    by_comp: dict[int, ExtractedCompetencyItem] = {}
    date_cache: dict[int, datetime] = {}
    for ec, comp in extracted_rows:
        filtered = await _filter_examples_by_pr_date(
            session, list(ec.pr_examples or []), from_dt, to_dt, date_cache
        )
        # last_seen_at — из самой свежей даты среди оставшихся примеров
        last_seen = None
        if filtered:
            dated_ids = [
                pr_id
                for example in filtered
                if isinstance((pr_id := example.get("pr_id")), int) and pr_id in date_cache
            ]
            last_seen = max((date_cache[pr_id] for pr_id in dated_ids), default=None)
        by_comp[comp.id] = ExtractedCompetencyItem(
            competency_id=comp.id,
            competency_name=comp.name,
            sort_order=comp.sort_order,
            frequency=len(filtered),
            last_seen_at=last_seen,
            pr_examples=filtered,
        )

    # 2) Требуемые уровни — добавляем даже если frequency=0 (это «гэп»)
    if emp.role_id and emp.grade_id:
        rq = await session.execute(
            select(RoleProfile, Competency)
            .join(Competency, Competency.id == RoleProfile.competency_id)
            .where(
                RoleProfile.role_id == emp.role_id,
                RoleProfile.grade_id == emp.grade_id,
                RoleProfile.required_level > 0,
            )
        )
        for rp, comp in rq.all():
            if comp.id in by_comp:
                by_comp[comp.id].required_level = rp.required_level
            else:
                by_comp[comp.id] = ExtractedCompetencyItem(
                    competency_id=comp.id,
                    competency_name=comp.name,
                    sort_order=comp.sort_order,
                    frequency=0,
                    last_seen_at=None,
                    pr_examples=[],
                    required_level=rp.required_level,
                )

    # 3) Текущие уровни (из последней Assessment) — для drill-down в UI
    cur_q = await session.execute(
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
    for cid, lvl in cur_q.all():
        if cid in by_comp:
            by_comp[cid].current_level = lvl

    # Если в периоде frequency=0 и компетенция не «заявлена» — скрываем (шум).
    items = [
        v
        for v in by_comp.values()
        if v.frequency > 0 or (v.required_level is not None and v.required_level > 0)
    ]
    items.sort(key=lambda x: (x.sort_order, x.competency_id))

    return ExtractedCompetenciesResponse(
        items=items, period_start=period_start, period_end=period_end
    )


# ----- /employees/{id}/competencies/{cid}/prs ------------------------------


@router.get(
    "/{employee_id}/competencies/{competency_id}/prs",
    response_model=list[PullRequestPublic],
)
async def get_employee_competency_prs(
    employee_id: int,
    competency_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
):
    """PR-ы сотрудника, проявившие конкретную компетенцию.

    Берём top_signals по этому competency_id из /competencies сотрудника
    (без фильтра projectId), затем его PR-ы, и оставляем те, у которых
    feature_keys пересекаются с signals (через catalog-mapping для
    feature_category/language_group, prefix-match для feature_prefix).
    """
    from app.codebuddy.competency_matching import (
        build_catalog_index,
        pr_matches_signals,
    )

    emp = await _load_owned_employee(session, employee_id, current_user)
    if not await is_codebuddy_live(session):
        return []
    _, _, period_start, period_end = _resolve_period(from_date, to_date)

    try:
        comp_resp = await codebuddy_service.get_extracted_competencies(
            emp, period_start, period_end
        )
    except CodeBuddyAPIError as e:
        raise _codebuddy_error_to_http(e) from e

    signals: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for it in comp_resp.items:
        if it.competency_id != competency_id:
            continue
        for s in it.top_signals or []:
            if not s.signal:
                continue
            key = (s.signal, s.signal_type)
            if key in seen:
                continue
            seen.add(key)
            signals.append(key)
    if not signals:
        return []

    try:
        prs = await codebuddy_service.get_pull_requests(emp, period_start, period_end, limit=200)
    except CodeBuddyAPIError as e:
        raise _codebuddy_error_to_http(e) from e

    try:
        catalog = await codebuddy_service.get_feature_catalog()
    except CodeBuddyAPIError:
        catalog = {"features": []}
    catalog_idx = build_catalog_index(catalog)

    # Если все signals — comment_category, CodeBuddy не даёт связи
    # comment↔PR, поэтому возвращаем пусто (UI покажет соответствующее
    # сообщение). Не выдумываем fallback по `comments_from_ai`, чтобы
    # не вводить пользователя в заблуждение.
    feature_signals = [s for s in signals if s[1] != "comment_category"]
    if not feature_signals:
        return []

    matched: list[PullRequestPublic] = []
    for p in prs:
        if not p.feature_keys:
            continue
        if pr_matches_signals(p.feature_keys, feature_signals, catalog_idx):
            p.author_employee_id = emp.id
            p.author_full_name = emp.full_name
            matched.append(p)
    matched.sort(key=lambda p: p.created_at_ext, reverse=True)
    return matched


# ----- /employees/{id}/digital-profile -------------------------------------


@router.get("/{employee_id}/digital-profile", response_model=DigitalProfilePublic | None)
async def get_digital_profile(employee_id: int, session: SessionDep, current_user: CurrentUser):
    await _load_owned_employee(session, employee_id, current_user)
    q = await session.execute(
        select(DigitalProfile).where(DigitalProfile.employee_id == employee_id)
    )
    profile = q.scalar_one_or_none()
    return DigitalProfilePublic.model_validate(profile) if profile else None


@router.post(
    "/{employee_id}/digital-profile/generate",
    response_model=AIJobPublic,
    status_code=202,
)
async def generate_digital_profile(
    employee_id: int, session: SessionDep, current_user: MutatorUser
):
    """Поставить AI-задачу на (пере)генерацию цифрового профиля.
    Возвращает существующий queued/running job, если уже идёт — без дедупа."""
    emp = await _load_owned_employee(session, employee_id, current_user)
    # дедуп
    aq = await session.execute(
        select(AIJob).where(
            AIJob.kind == "digital_profile",
            AIJob.employee_id == emp.id,
            AIJob.status.in_(("queued", "running")),
        )
    )
    existing = aq.scalar_one_or_none()
    if existing is not None:
        return AIJobPublic.model_validate(existing)
    job = AIJob(
        kind="digital_profile",
        status="queued",
        employee_id=emp.id,
        target_kind="employee",
        target_id=emp.id,
        payload={},
        created_by=current_user.id,
    )
    session.add(job)
    await session.commit()
    await session.refresh(job)
    pool = get_pool()
    await pool.enqueue_job("run_digital_profile", job.id)
    return AIJobPublic.model_validate(job)


# ----- /projects/{id}/extracted-competencies -------------------------------


@project_router.get(
    "/{project_id}/extracted-competencies",
    response_model=ProjectExtractedCompetenciesResponse,
)
async def get_project_extracted_competencies(
    project_id: int,
    session: SessionDep,
    _current_user: CurrentUser,
    from_date: date | None = Query(default=None, alias="from"),
    to_date: date | None = Query(default=None, alias="to"),
):
    """Агрегат «заявлено vs факт» по проекту за указанный период.

    Параметры `from`/`to` (YYYY-MM-DD) фильтруют PR-ы по дате создания.
    По умолчанию — последние 90 дней. Учитываются только активные members
    (left_at IS NULL).
    """
    from app.models.project import ProjectCompetency
    from app.schemas.dev_metrics import ProjectCompetencyEmployeeContrib

    proj = await session.get(Project, project_id)
    if proj is None:
        raise HTTPException(status_code=404, detail="Проект не найден")

    from_dt, to_dt, period_start, period_end = _resolve_period(from_date, to_date)

    # Активные члены команды
    mq = await session.execute(
        select(ProjectMember.employee_id).where(
            ProjectMember.project_id == project_id,
            ProjectMember.left_at.is_(None),
        )
    )
    member_ids = [eid for (eid,) in mq.all()]
    total_team = len(member_ids)

    if await is_codebuddy_live(session):
        # Грузим Employee для resolve_gitlab_username
        if member_ids:
            mq2 = await session.execute(select(Employee).where(Employee.id.in_(member_ids)))
            members = list(mq2.scalars())
        else:
            members = []
        try:
            return await codebuddy_service.get_project_extracted_competencies(
                proj, members, period_start, period_end
            )
        except CodeBuddyAPIError as e:
            raise _codebuddy_error_to_http(e) from e

    by_comp: dict[int, ProjectExtractedCompetencyItem] = {}
    date_cache: dict[int, datetime] = {}

    if member_ids:
        eq = await session.execute(
            select(ExtractedCompetency, Competency, Employee.full_name)
            .join(Competency, Competency.id == ExtractedCompetency.competency_id)
            .join(Employee, Employee.id == ExtractedCompetency.employee_id)
            .where(ExtractedCompetency.employee_id.in_(member_ids))
        )
        for ec, comp, emp_name in eq.all():
            filtered = await _filter_examples_by_pr_date(
                session, list(ec.pr_examples or []), from_dt, to_dt, date_cache
            )
            if not filtered:
                # В этом периоде эта компетенция не проявилась у этого сотрудника
                continue
            it = by_comp.get(comp.id)
            if it is None:
                it = ProjectExtractedCompetencyItem(
                    competency_id=comp.id,
                    competency_name=comp.name,
                    sort_order=comp.sort_order,
                    employees_with=0,
                    total_frequency=0,
                    employees=[],
                )
                by_comp[comp.id] = it
            it.employees_with += 1
            it.total_frequency += len(filtered)
            it.employees.append(
                ProjectCompetencyEmployeeContrib(
                    employee_id=ec.employee_id,
                    full_name=emp_name,
                    frequency=len(filtered),
                    pr_examples=filtered,
                )
            )

    # Заявленный тех. стек проекта — добавляем даже если нет проявлений
    pcq = await session.execute(
        select(ProjectCompetency, Competency)
        .join(Competency, Competency.id == ProjectCompetency.competency_id)
        .where(ProjectCompetency.project_id == project_id)
    )
    for pc, comp in pcq.all():
        it = by_comp.get(comp.id)
        if it is None:
            it = ProjectExtractedCompetencyItem(
                competency_id=comp.id,
                competency_name=comp.name,
                sort_order=comp.sort_order,
                employees_with=0,
                total_frequency=0,
                employees=[],
            )
            by_comp[comp.id] = it
        it.project_target_level = pc.target_level

    items = sorted(
        by_comp.values(),
        key=lambda x: (-x.employees_with, x.sort_order),
    )
    for it in items:
        it.employees.sort(key=lambda e: -e.frequency)

    return ProjectExtractedCompetenciesResponse(
        items=items,
        total_team=total_team,
        period_start=period_start,
        period_end=period_end,
    )
