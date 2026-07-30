"""Высокоуровневый сервис CodeBuddy: маппинг DTO → наши Pydantic-схемы +
Redis-кэш.

Использование (из FastAPI-эндпойнтов):

    from app.codebuddy.service import codebuddy_service

    metrics = await codebuddy_service.get_dev_metrics(
        employee, period_from, period_to
    )

Все методы кидают `CodeBuddyAPIError` при сетевых/HTTP проблемах
(вызывающий эндпойнт перехватывает и отдаёт 502 фронту с понятным
сообщением, см. `app.api.dev_metrics`).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, date, datetime
from typing import Any

from app.codebuddy.cache import cached, make_key
from app.codebuddy.client import CodeBuddyAPIError, codebuddy_client
from app.codebuddy.identity import resolve_gitlab_username
from app.models.employee import Employee
from app.models.project import Project
from app.schemas.dev_metrics import (
    CompetencyTopicCoverage,
    CompetencyTopSignal,
    DevMetricsSnapshotPublic,
    ExtractedCompetenciesResponse,
    ExtractedCompetencyItem,
    ProjectCompetencyEmployeeContrib,
    ProjectExtractedCompetenciesResponse,
    ProjectExtractedCompetencyItem,
    PullRequestPublic,
    QualityBreakdownComponents,
    WipMrItem,
)

logger = logging.getLogger(__name__)


# Минута + дефолт — компромисс между свежестью и rate-limit 60 req/min.
TTL_DEFAULT = 600
TTL_CATALOG = 24 * 60 * 60


class _NotMapped(Exception):
    """Сотрудник не сопоставлен с CodeBuddy username — нет данных для запроса."""


# --------------------------------------------------------------------------
#                           Helpers / mappers
# --------------------------------------------------------------------------


def _iso(d: date) -> str:
    return d.isoformat()


def _size_buckets_to_xs_xl(buckets: dict[str, int] | None) -> dict[str, int]:
    """CodeBuddy: small/medium/large/huge → наши 5 ведер XS/S/M/L/XL.

    Маппинг компромисс (CodeBuddy не разделяет XS и S):
        XS=0, S=small, M=medium, L=large, XL=huge.
    """
    b = buckets or {}
    return {
        "mr_size_xs": 0,
        "mr_size_s": int(b.get("small", 0) or 0),
        "mr_size_m": int(b.get("medium", 0) or 0),
        "mr_size_l": int(b.get("large", 0) or 0),
        "mr_size_xl": int(b.get("huge", 0) or 0),
    }


def _detail_to_snapshot(
    detail: dict, period_from: date, period_to: date
) -> DevMetricsSnapshotPublic:
    """CodeBuddy DeveloperProfileDetailResponse → DevMetricsSnapshotPublic."""
    s = detail.get("summary") or {}
    qb = s.get("prQualityBreakdown") or {}
    quality_breakdown = detail.get("qualityBreakdown") or {}
    size_buckets = _size_buckets_to_xs_xl(quality_breakdown.get("prSizeBuckets"))

    mr_count = int(s.get("mrCount") or 0)
    # CodeBuddy не даёт абсолютные «N MR с описанием/обсуждением» — выводим
    # из процент-компонентов prQualityBreakdown (0..100). Приближение.
    desc_pct = float(qb.get("descriptionComponent") or 0)
    mr_with_description = round(mr_count * desc_pct / 100)
    # `hasReviewDiscussion` — нет компонента в breakdown, используем
    # commentsReceivedFromPeers > 0 как сильный proxy (per-PR не можем).
    has_peer_comments = (s.get("commentsReceivedFromPeers") or 0) > 0
    mr_with_review_discussion = mr_count if has_peer_comments else 0

    quality_score = float(s.get("prQualityScore") or 0)
    avg_quality_ratio = round(quality_score / 100, 4)

    breakdown = None
    if qb:
        breakdown = QualityBreakdownComponents(
            conventional_commits_pct=float(qb.get("conventionalCommitsComponent") or 0),
            description_pct=desc_pct,
            size_pct=float(qb.get("sizeComponent") or 0),
            weights=dict(qb.get("weights") or {}),
        )

    wip_items: list[WipMrItem] = []
    for w in (detail.get("wipMrs") or []):
        wip_items.append(
            WipMrItem(
                mr_iid=int(w.get("mrIid") or 0),
                project_id=w.get("projectId"),
                project_name=w.get("projectName"),
                title=str(w.get("title") or ""),
                url=w.get("url"),
                created_at=_parse_dt(w.get("createdAt")),
                updated_at=_parse_dt(w.get("updatedAt")),
                age_days=int(w.get("ageDays") or 0),
                is_stale=bool(w.get("isStale")),
            )
        )

    return DevMetricsSnapshotPublic(
        period_start=period_from,
        period_end=period_to,
        total_commits=0,  # нет в CodeBuddy на summary-уровне
        total_mrs=mr_count,
        lines_added=int(s.get("linesAdded") or 0),
        lines_removed=int(s.get("linesRemoved") or 0),
        **size_buckets,
        mr_with_tests=int(s.get("prsWithTests") or 0),
        mr_with_description=mr_with_description,
        mr_with_review_discussion=mr_with_review_discussion,
        # CodeBuddy не агрегирует средние итерации; reworkRate — % MR с rewrite.
        avg_iterations=round(float(s.get("reworkRate") or 0) / 100 + 1, 2),
        avg_time_to_merge_hours=(
            float(s["avgTimeToMergeHours"])
            if s.get("avgTimeToMergeHours") is not None
            else None
        ),
        avg_quality_ratio=avg_quality_ratio,
        comments_given=int(s.get("commentsWritten") or 0),
        comments_received=int(s.get("commentsReceivedFromPeers") or 0)
        + int(s.get("aiCommentsReceived") or 0),
        ai_comments_received=int(s.get("aiCommentsReceived") or 0),
        wip_count=int(s.get("wipMrCount") or 0),
        stale_count=int(s.get("staleMrCount") or 0),
        wip_mrs=wip_items,
        stale_threshold_days=s.get("staleThresholdDays"),
        quality_breakdown=breakdown,
    )


def _mr_item_to_pr(it: dict) -> PullRequestPublic:
    """CodeBuddy DeveloperMrItem → PullRequestPublic."""
    sigs = it.get("signals") or {}
    peers = int(it.get("commentsFromPeers") or 0)
    ai = int(it.get("commentsFromAi") or 0)
    feature_keys = [str(fk) for fk in (it.get("featureKeys") or []) if fk]
    conv_rate = it.get("conventionalCommitsRate")
    return PullRequestPublic(
        id=int(it.get("mrIid") or 0),
        external_id=str(it.get("mrIid") or ""),
        project_id=it.get("projectId"),
        project_name=it.get("projectName"),
        title=it.get("title") or "",
        url=it.get("url"),
        state=str(it.get("state") or "open"),
        created_at_ext=_parse_dt(it.get("createdAt")) or datetime.now(UTC),
        merged_at_ext=_parse_dt(it.get("mergedAt")),
        additions=int(it.get("additions") or 0),
        deletions=int(it.get("deletions") or 0),
        files_changed=int(it.get("filesChanged") or 0),
        tests_changed=int(it.get("testFilesChanged") or 0),
        size_bucket=str(it.get("sizeBucket") or "S")[0].upper() or "S",
        iterations=int(it.get("iterations") or 1),
        comments_count=peers + ai,
        time_to_merge_hours=it.get("timeToMergeHours"),
        signals={
            "small_size": bool(sigs.get("smallSize")),
            "has_description": bool(sigs.get("hasDescription")),
            "minimal_rework": bool(sigs.get("minimalRework")),
            "has_review_discussion": bool(sigs.get("hasReviewDiscussion")),
            "has_tests": bool(sigs.get("hasTests")),
        },
        quality_ratio=float(it.get("qualityScore") or 0),
        feature_keys=feature_keys,
        commits_count=it.get("commitsCount"),
        conventional_commits_rate=(
            float(conv_rate) if conv_rate is not None else None
        ),
        comments_from_peers=peers,
        comments_from_ai=ai,
    )


def _parse_dt(s: Any) -> datetime | None:
    if not s:
        return None
    if isinstance(s, datetime):
        return s
    try:
        # Принимаем «...Z» (UTC) и offset-форматы
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _competency_to_item(c: dict) -> ExtractedCompetencyItem:
    """CodeBuddy CompetencyScoreDto → ExtractedCompetencyItem.

    `pr_examples` оставляем пустым: CodeBuddy не даёт связи competency ↔ конкретный
    PR. Drill-down к PR-ам должен делать сам пользователь через `/mrs`.
    """
    top_signals: list[CompetencyTopSignal] = []
    for ts in (c.get("topSignals") or [])[:10]:
        top_signals.append(
            CompetencyTopSignal(
                signal=str(ts.get("signal") or ""),
                signal_type=str(ts.get("type") or "feature_key"),
                occurrences=int(ts.get("occurrences") or 0),
                weight=float(ts.get("weight") or 1.0),
                contribution=float(ts.get("contribution") or 0),
            )
        )

    topic_coverage: list[CompetencyTopicCoverage] = []
    for tc in (c.get("topicCoverage") or []):
        topic_coverage.append(
            CompetencyTopicCoverage(
                topic_id=int(tc.get("topicId") or 0),
                section=tc.get("section"),
                topic=str(tc.get("topic") or ""),
                recommended_level=tc.get("recommendedLevel"),
                score=float(tc.get("score") or 0),
                signal_count=int(tc.get("signalCount") or 0),
            )
        )

    freq_score = c.get("frequencyScore")
    return ExtractedCompetencyItem(
        competency_id=int(c.get("competencyId") or 0),
        competency_name=str(c.get("name") or ""),
        sort_order=0,  # CodeBuddy не отдаёт sort_order; не критично
        frequency=int(c.get("signalCount") or 0),
        last_seen_at=None,
        pr_examples=[],
        required_level=None,
        current_level=None,
        frequency_score=float(freq_score) if freq_score is not None else None,
        max_level=c.get("maxLevel"),
        top_signals=top_signals,
        topic_coverage=topic_coverage,
        mptk_answer=c.get("mptkAnswer"),
    )


# --------------------------------------------------------------------------
#                              Service object
# --------------------------------------------------------------------------


class CodeBuddyService:
    """Singleton-фасад. Создаётся как modul-level `codebuddy_service`."""

    # ----- dev metrics --------------------------------------------------

    async def get_dev_metrics(
        self, employee: Employee, period_from: date, period_to: date
    ) -> DevMetricsSnapshotPublic | None:
        """Один snapshot за период. None если у сотрудника нет username или PR.

        Делает один запрос `/developers/{username}` — там и summary, и
        `qualityBreakdown.prSizeBuckets`, и `wipMrs`.
        """
        username = resolve_gitlab_username(employee)
        if not username:
            return None
        key = make_key("detail", username, _iso(period_from), _iso(period_to))

        async def fetch() -> dict | None:
            try:
                return await codebuddy_client.get(
                    f"/api/external/v1/developers/{username}",
                    params={"from": _iso(period_from), "to": _iso(period_to)},
                )
            except CodeBuddyAPIError as e:
                if e.status_code == 404:
                    return None
                raise

        data = await cached(key, TTL_DEFAULT, fetch)
        if not data:
            return None
        snap = _detail_to_snapshot(data, period_from, period_to)
        # Если в периоде вообще не было MR — возвращаем None, чтобы UI показал
        # empty-state, а не нули («Иванов не делал PR за период»).
        if snap.total_mrs == 0:
            return None
        return snap

    # ----- pull requests ------------------------------------------------

    async def get_pull_requests(
        self,
        employee: Employee,
        period_from: date,
        period_to: date,
        limit: int = 50,
    ) -> list[PullRequestPublic]:
        username = resolve_gitlab_username(employee)
        if not username:
            return []
        limit = min(max(limit, 1), 200)
        key = make_key(
            "mrs", username, _iso(period_from), _iso(period_to), limit
        )

        async def fetch() -> dict:
            try:
                return await codebuddy_client.get(
                    f"/api/external/v1/developers/{username}/mrs",
                    params={
                        "from": _iso(period_from),
                        "to": _iso(period_to),
                        "limit": limit,
                    },
                )
            except CodeBuddyAPIError as e:
                if e.status_code == 404:
                    return {"items": []}
                raise

        data = await cached(key, TTL_DEFAULT, fetch) or {}
        items = data.get("items") or []
        return [_mr_item_to_pr(it) for it in items]

    # ----- full-history iteration (для бэкфилла проектов) --------------

    async def iterate_all_pull_requests(
        self,
        employee: Employee,
        period_from: date,
        period_to: date,
        page_size: int = 200,
        max_pages: int = 50,
    ) -> list[PullRequestPublic]:
        """Все PR-ы сотрудника за период с пагинацией через offset.

        Не использует Redis-кэш — это разовая операция бэкфилла, кэш бы
        только мусорил. Безопасный stop: max_pages × page_size (10 000 PR
        по умолчанию) — больше у одного человека и не должно быть.
        """
        username = resolve_gitlab_username(employee)
        if not username:
            return []
        page_size = min(max(page_size, 1), 200)
        out: list[PullRequestPublic] = []
        offset = 0
        for _ in range(max_pages):
            try:
                data = await codebuddy_client.get(
                    f"/api/external/v1/developers/{username}/mrs",
                    params={
                        "from": _iso(period_from),
                        "to": _iso(period_to),
                        "limit": page_size,
                        "offset": offset,
                    },
                )
            except CodeBuddyAPIError as e:
                if e.status_code == 404:
                    break
                raise
            items = (data or {}).get("items") or []
            if not items:
                break
            for it in items:
                out.append(_mr_item_to_pr(it))
            if len(items) < page_size:
                break
            offset += page_size
        else:
            logger.warning(
                "iterate_all_pull_requests: capped at %d pages for %s",
                max_pages, username,
            )
        return out

    # ----- extracted competencies (per employee) -----------------------

    async def get_extracted_competencies(
        self,
        employee: Employee,
        period_from: date,
        period_to: date,
        include_answers: bool = False,
    ) -> ExtractedCompetenciesResponse:
        username = resolve_gitlab_username(employee)
        if not username:
            return ExtractedCompetenciesResponse(
                items=[],
                period_start=period_from,
                period_end=period_to,
            )
        key = make_key(
            "comp",
            username,
            _iso(period_from),
            _iso(period_to),
            "answers" if include_answers else "noanswers",
        )

        async def fetch() -> dict:
            params: dict[str, Any] = {
                "from": _iso(period_from),
                "to": _iso(period_to),
            }
            if include_answers:
                params["includeAnswers"] = "true"
            try:
                return await codebuddy_client.get(
                    f"/api/external/v1/developers/{username}/competencies",
                    params=params,
                )
            except CodeBuddyAPIError as e:
                if e.status_code == 404:
                    return {"competencies": []}
                raise

        data = await cached(key, TTL_DEFAULT, fetch) or {}
        items = [
            _competency_to_item(c)
            for c in (data.get("competencies") or [])
            if not c.get("notCovered")  # пропускаем «нулевые» компетенции
        ]
        items.sort(key=lambda i: -i.frequency)
        return ExtractedCompetenciesResponse(
            items=items,
            period_start=period_from,
            period_end=period_to,
        )

    # ----- project aggregation -----------------------------------------

    async def get_project_extracted_competencies(
        self,
        project: Project,
        members: list[Employee],
        period_from: date,
        period_to: date,
    ) -> ProjectExtractedCompetenciesResponse:
        """Агрегат `/competencies?projectId=...` по всем активным членам проекта.

        N запросов параллельно через `asyncio.gather` — без batch для
        competencies на стороне CodeBuddy (зона ответственности — наша).
        Кэш per-сотрудник в Redis.
        """
        # Без gitlab_project_id фильтр по проекту в CodeBuddy не задать,
        # но мы всё равно агрегируем компетенции по членам нашего проекта —
        # просто без фильтра по проекту на стороне CodeBuddy.
        cb_project_id = project.gitlab_project_id
        valid_pairs: list[tuple[Employee, str]] = []
        for emp in members:
            username = resolve_gitlab_username(emp)
            if username:
                valid_pairs.append((emp, username))
        total_team = len(members)

        async def _fetch_one(employee: Employee, username: str) -> dict:
            key = make_key(
                "comp",
                username,
                _iso(period_from),
                _iso(period_to),
                f"proj-{cb_project_id}" if cb_project_id else "any",
            )

            async def fetch() -> dict:
                params: dict[str, Any] = {
                    "from": _iso(period_from),
                    "to": _iso(period_to),
                }
                if cb_project_id is not None:
                    params["projectId"] = cb_project_id
                try:
                    return await codebuddy_client.get(
                        f"/api/external/v1/developers/{username}/competencies",
                        params=params,
                    )
                except CodeBuddyAPIError as e:
                    if e.status_code == 404:
                        return {"competencies": []}
                    raise

            data = await cached(key, TTL_DEFAULT, fetch) or {}
            return {"employee": employee, "data": data}

        # Параллелим — CodeBuddy лимит 60/мин допускает короткие всплески.
        results = await asyncio.gather(
            *[_fetch_one(emp, u) for emp, u in valid_pairs],
            return_exceptions=True,
        )

        # Группируем competency → ProjectExtractedCompetencyItem
        by_comp: dict[int, ProjectExtractedCompetencyItem] = {}
        # Промежуточный аккумулятор сигналов: cid → {signal → (signal_type, occurrences, contribution)}
        signals_acc: dict[int, dict[str, dict[str, float | int | str]]] = {}
        for r in results:
            if isinstance(r, Exception):
                logger.warning("project agg: one fetch failed: %s", r)
                continue
            emp = r["employee"]
            data = r["data"]
            for c in (data.get("competencies") or []):
                if c.get("notCovered"):
                    continue
                cid = int(c.get("competencyId") or 0)
                if not cid:
                    continue
                freq = int(c.get("signalCount") or 0)
                if freq <= 0:
                    continue
                item = by_comp.get(cid)
                if item is None:
                    item = ProjectExtractedCompetencyItem(
                        competency_id=cid,
                        competency_name=str(c.get("name") or ""),
                        sort_order=0,
                        project_target_level=None,
                        employees_with=0,
                        total_frequency=0,
                        employees=[],
                        top_signals=[],
                    )
                    by_comp[cid] = item
                    signals_acc[cid] = {}
                item.employees_with += 1
                item.total_frequency += freq
                item.employees.append(
                    ProjectCompetencyEmployeeContrib(
                        employee_id=emp.id,
                        full_name=emp.full_name,
                        frequency=freq,
                        pr_examples=[],
                    )
                )
                # Аггрегируем top_signals на уровне проекта.
                for ts in (c.get("topSignals") or []):
                    sig = str(ts.get("signal") or "")
                    if not sig:
                        continue
                    bucket = signals_acc[cid].setdefault(
                        sig,
                        {
                            "signal_type": str(ts.get("type") or "feature_key"),
                            "occurrences": 0,
                            "contribution": 0.0,
                        },
                    )
                    bucket["occurrences"] = int(bucket["occurrences"]) + int(
                        ts.get("occurrences") or 0
                    )
                    bucket["contribution"] = float(bucket["contribution"]) + float(
                        ts.get("contribution") or 0
                    )

        items = sorted(
            by_comp.values(),
            key=lambda x: (-x.employees_with, -x.total_frequency),
        )
        for it in items:
            it.employees.sort(key=lambda e: -e.frequency)
            # Топ-5 сигналов по сумме contribution.
            buckets = signals_acc.get(it.competency_id, {})
            it.top_signals = [
                CompetencyTopSignal(
                    signal=sig,
                    signal_type=str(info["signal_type"]),
                    occurrences=int(info["occurrences"]),
                    weight=1.0,
                    contribution=float(info["contribution"]),
                )
                for sig, info in sorted(
                    buckets.items(),
                    key=lambda kv: -float(kv[1]["contribution"]),
                )[:5]
            ]

        return ProjectExtractedCompetenciesResponse(
            items=items,
            total_team=total_team,
            period_start=period_from,
            period_end=period_to,
        )

    # ----- list developers (для identity-mapping в админке) -----------

    async def list_developers(self, limit: int = 200) -> list[dict]:
        """Список активных GitLab-пользователей в CodeBuddy.

        Используется в админке для подсказок при сопоставлении
        `Employee.gitlab_username`. Кэшируем 1 час — список меняется редко.
        """
        limit = min(max(limit, 1), 500)

        async def fetch() -> dict:
            return await codebuddy_client.get(
                "/api/external/v1/developers",
                params={"limit": limit},
            )

        data = await cached(make_key("developers", limit), 3600, fetch) or {}
        items = data.get("items") or []
        out: list[dict] = []
        for it in items[:limit]:
            out.append(
                {
                    "username": str(it.get("username") or ""),
                    "full_name": it.get("fullName"),
                    "mr_count": int(it.get("mrCount") or 0),
                    "last_active_at": it.get("lastActiveAt"),
                }
            )
        return out

    # ----- feature catalog (для админа) --------------------------------

    async def get_feature_catalog(self) -> dict:
        async def fetch() -> dict:
            return await codebuddy_client.get(
                "/api/external/v1/feature-catalog"
            )

        return await cached(make_key("feature-catalog"), TTL_CATALOG, fetch)

    # ----- healthcheck (для админ-панели) ------------------------------

    async def healthcheck(self) -> dict:
        """Проверка связи. Дёргает `/feature-catalog` (легковесный)."""
        from app.codebuddy.auth import token_manager

        if not token_manager.is_configured():
            return {"ok": False, "reason": "Не настроены credentials"}
        try:
            data = await codebuddy_client.get(
                "/api/external/v1/feature-catalog"
            )
            return {
                "ok": True,
                "languages": len(data.get("languages") or []),
                "categories": len(data.get("categories") or []),
                "features": len(data.get("features") or []),
            }
        except CodeBuddyAPIError as e:
            return {
                "ok": False,
                "reason": str(e),
                "status_code": e.status_code,
            }


codebuddy_service = CodeBuddyService()
