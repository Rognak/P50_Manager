"""Расчёт performance-метрик продукта из данных CodeBuddy.

Чистый расчётный слой: получает PR-ы и dev-снапшоты через `codebuddy_service`,
считает per-developer метрики, composite-рейтинг, здоровье продукта и
эвристические сигналы. AI-обзор живёт отдельно (ARQ-задача).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date
from typing import Literal

from app.codebuddy.client import CodeBuddyAPIError
from app.codebuddy.service import codebuddy_service
from app.models.employee import Employee
from app.schemas.dev_metrics import PullRequestPublic, WipMrItem
from app.schemas.performance import (
    DeveloperPerformance,
    DevScoreBreakdown,
    PerfSignal,
    ProductHealth,
    SignalEvidenceItem,
)

logger = logging.getLogger(__name__)

# Веса composite-рейтинга разработчика (сумма = 1.0).
_W_QUALITY = 0.35
_W_TESTS = 0.20
_W_REVIEW = 0.15
_W_LOW_REWORK = 0.15
_W_VOLUME = 0.15


@dataclass
class RawDev:
    """Сырые данные одного разработчика за окно (до нормализации)."""

    employee: Employee
    prs: list[PullRequestPublic]
    comments_written: int = 0  # из dev-снапшота (по всем продуктам)
    stale_mrs: list[WipMrItem] = field(default_factory=list)  # stale-PR продукта

    @property
    def stale_count(self) -> int:
        return len(self.stale_mrs)


async def gather_raw_devs(
    members: list[Employee],
    repo_pids: set[int],
    period_from: date,
    period_to: date,
) -> list[RawDev]:
    """Параллельно тянет PR-ы + снапшот по каждому участнику продукта."""

    async def _one(emp: Employee) -> RawDev:
        prs: list[PullRequestPublic] = []
        try:
            all_prs = await codebuddy_service.get_pull_requests(
                emp, period_from, period_to, limit=200
            )
            prs = [p for p in all_prs if p.project_id in repo_pids]
        except CodeBuddyAPIError as e:
            logger.warning("perf: /mrs for emp %s: %s", emp.id, e)
        comments_written = 0
        stale_mrs: list[WipMrItem] = []
        try:
            snap = await codebuddy_service.get_dev_metrics(emp, period_from, period_to)
            if snap is not None:
                comments_written = snap.comments_given
                stale_mrs = [
                    w
                    for w in (snap.wip_mrs or [])
                    if w.is_stale and w.state == "open" and w.project_id in repo_pids
                ]
        except CodeBuddyAPIError as e:
            logger.warning("perf: /developers for emp %s: %s", emp.id, e)
        return RawDev(emp, prs, comments_written, stale_mrs)

    return list(await asyncio.gather(*[_one(m) for m in members]))


async def gather_prs_only(
    members: list[Employee],
    repo_pids: set[int],
    period_from: date,
    period_to: date,
) -> list[PullRequestPublic]:
    """Облегчённый сбор — только PR-ы продукта (без dev-снапшотов).
    Для трендов: меньше запросов к CodeBuddy на каждое окно."""

    async def _one(emp: Employee) -> list[PullRequestPublic]:
        try:
            prs = await codebuddy_service.get_pull_requests(emp, period_from, period_to, limit=200)
            return [p for p in prs if p.project_id in repo_pids]
        except CodeBuddyAPIError as e:
            logger.warning("trends: /mrs for emp %s: %s", emp.id, e)
            return []

    batches = await asyncio.gather(*[_one(m) for m in members])
    return [p for b in batches for p in b]


@dataclass
class _DevAgg:
    """Промежуточный агрегат по PR-ам (без composite-score)."""

    mr_count: int = 0
    prs_open: int = 0
    prs_merged: int = 0
    prs_closed: int = 0
    avg_quality: float = 0.0
    tests_pct: float = 0.0
    description_pct: float = 0.0
    avg_iterations: float = 0.0
    rework_pct: float = 0.0
    comments_received: int = 0
    ai_comments_received: int = 0
    lines_added: int = 0
    lines_removed: int = 0
    avg_ttm_hours: float | None = None
    ttm_values: list[float] = field(default_factory=list)


def _aggregate_prs(prs: list[PullRequestPublic]) -> _DevAgg:
    agg = _DevAgg()
    n = len(prs)
    agg.mr_count = n
    if n == 0:
        return agg
    q_sum = iter_sum = 0.0
    tests = descr = rework = 0
    for p in prs:
        if p.state == "open":
            agg.prs_open += 1
        elif p.state == "merged":
            agg.prs_merged += 1
        elif p.state == "closed":
            agg.prs_closed += 1
        q_sum += p.quality_ratio
        iter_sum += p.iterations
        sig = p.signals or {}
        if sig.get("has_tests"):
            tests += 1
        if sig.get("has_description"):
            descr += 1
        if p.iterations > 1:
            rework += 1
        agg.comments_received += p.comments_count
        agg.ai_comments_received += p.comments_from_ai or 0
        agg.lines_added += p.additions
        agg.lines_removed += p.deletions
        if p.time_to_merge_hours is not None:
            agg.ttm_values.append(p.time_to_merge_hours)
    agg.avg_quality = round(q_sum / n, 4)
    agg.tests_pct = round(tests / n, 4)
    agg.description_pct = round(descr / n, 4)
    agg.avg_iterations = round(iter_sum / n, 2)
    agg.rework_pct = round(rework / n, 4)
    if agg.ttm_values:
        agg.avg_ttm_hours = round(sum(agg.ttm_values) / len(agg.ttm_values), 1)
    return agg


def build_developers(
    raw_devs: list[RawDev],
    prev_by_emp: dict[int, _DevAgg] | None = None,
    prev_score_by_emp: dict[int, float] | None = None,
) -> list[DeveloperPerformance]:
    """Считает рейтинг по сырым данным. prev_* — для дельт (опц.)."""
    aggs: dict[int, _DevAgg] = {rd.employee.id: _aggregate_prs(rd.prs) for rd in raw_devs}
    # Нормализаторы — максимумы по команде.
    max_volume = max((a.mr_count for a in aggs.values()), default=0) or 1
    max_review = max((rd.comments_written for rd in raw_devs), default=0) or 1

    out: list[DeveloperPerformance] = []
    for rd in raw_devs:
        emp = rd.employee
        a = aggs[emp.id]
        quality_ax = a.avg_quality
        tests_ax = a.tests_pct
        review_ax = round(min(1.0, rd.comments_written / max_review), 4)
        low_rework_ax = round(1.0 - a.rework_pct, 4)
        volume_ax = round(min(1.0, a.mr_count / max_volume), 4)
        score = (
            quality_ax * _W_QUALITY
            + tests_ax * _W_TESTS
            + review_ax * _W_REVIEW
            + low_rework_ax * _W_LOW_REWORK
            + volume_ax * _W_VOLUME
        ) * 100
        score = round(score, 1)

        prev_a = (prev_by_emp or {}).get(emp.id)
        prev_score = (prev_score_by_emp or {}).get(emp.id)
        out.append(
            DeveloperPerformance(
                employee_id=emp.id,
                full_name=emp.full_name,
                role_name=emp.role.name if emp.role else None,
                grade_code=emp.grade.code if emp.grade else None,
                mr_count=a.mr_count,
                prs_open=a.prs_open,
                prs_merged=a.prs_merged,
                prs_closed=a.prs_closed,
                avg_quality=a.avg_quality,
                tests_pct=a.tests_pct,
                description_pct=a.description_pct,
                avg_iterations=a.avg_iterations,
                rework_pct=a.rework_pct,
                comments_received=a.comments_received,
                ai_comments_received=a.ai_comments_received,
                comments_written=rd.comments_written,
                lines_added=a.lines_added,
                lines_removed=a.lines_removed,
                avg_ttm_hours=a.avg_ttm_hours,
                composite_score=score,
                breakdown=DevScoreBreakdown(
                    quality=quality_ax,
                    tests=tests_ax,
                    review=review_ax,
                    low_rework=low_rework_ax,
                    volume=volume_ax,
                ),
                score_delta=(round(score - prev_score, 1) if prev_score is not None else None),
                mr_count_delta=(a.mr_count - prev_a.mr_count if prev_a is not None else None),
                quality_delta=(
                    round(a.avg_quality - prev_a.avg_quality, 4) if prev_a is not None else None
                ),
            )
        )
    out.sort(key=lambda d: -d.composite_score)
    return out


def aggregate_for_deltas(raw_devs: list[RawDev]) -> tuple[dict[int, _DevAgg], dict[int, float]]:
    """Готовит prev-агрегаты + prev-score для передачи в build_developers."""
    devs = build_developers(raw_devs)
    aggs = {rd.employee.id: _aggregate_prs(rd.prs) for rd in raw_devs}
    scores = {d.employee_id: d.composite_score for d in devs}
    return aggs, scores


def build_health(
    raw_devs: list[RawDev],
    coverage_gap: float,
    bus_factor_count: int,
    team_size: int,
    prev_total_prs: int | None = None,
    prev_avg_quality: float | None = None,
) -> ProductHealth:
    all_prs = [p for rd in raw_devs for p in rd.prs]
    total = len(all_prs)
    prs_open = sum(1 for p in all_prs if p.state == "open")
    prs_merged = sum(1 for p in all_prs if p.state == "merged")
    prs_closed = sum(1 for p in all_prs if p.state == "closed")
    avg_quality = round(sum(p.quality_ratio for p in all_prs) / total, 4) if total else None
    with_tests = (
        round(
            sum(1 for p in all_prs if (p.signals or {}).get("has_tests")) / total,
            4,
        )
        if total
        else None
    )
    ttm = [p.time_to_merge_hours for p in all_prs if p.time_to_merge_hours]
    avg_ttm = round(sum(ttm) / len(ttm), 1) if ttm else None
    stale_count = sum(rd.stale_count for rd in raw_devs)

    # распределение нагрузки
    per_dev_counts = [len(rd.prs) for rd in raw_devs]
    active = sum(1 for c in per_dev_counts if c > 0)
    top_share = round(max(per_dev_counts) / total, 4) if total and per_dev_counts else None
    reviewers = sum(1 for rd in raw_devs if rd.comments_written > 0)

    # интегральная оценка здоровья (0..100)
    quality_part = (avg_quality or 0) * 40
    tests_part = (with_tests or 0) * 20
    stale_free = 1.0 - min(1.0, stale_count / total) if total else 1.0
    stale_part = stale_free * 20
    coverage_ok = 1.0 - min(1.0, coverage_gap / 10.0)
    coverage_part = coverage_ok * 20
    health_score = round(quality_part + tests_part + stale_part + coverage_part, 1)
    status: Literal["healthy", "attention", "critical"]
    if health_score >= 75 and bus_factor_count < 2:
        status = "healthy"
    elif health_score >= 50:
        status = "attention"
    else:
        status = "critical"

    return ProductHealth(
        total_prs=total,
        prs_open=prs_open,
        prs_merged=prs_merged,
        prs_closed=prs_closed,
        avg_quality=avg_quality,
        with_tests_pct=with_tests,
        avg_ttm_hours=avg_ttm,
        wip_count=prs_open,
        stale_count=stale_count,
        coverage_gap=coverage_gap,
        bus_factor_count=bus_factor_count,
        workload_top_share=top_share,
        active_developers=active,
        team_size=team_size,
        reviewers_count=reviewers,
        health_status=status,
        health_score=health_score,
        total_prs_delta=(total - prev_total_prs if prev_total_prs is not None else None),
        avg_quality_delta=(
            round((avg_quality or 0) - prev_avg_quality, 4)
            if prev_avg_quality is not None and avg_quality is not None
            else None
        ),
    )


def _fmt_dt(dt) -> str:
    """datetime → 'дд.мм.гг'."""
    if dt is None:
        return "—"
    return dt.strftime("%d.%m.%y")


def build_signals(
    developers: list[DeveloperPerformance],
    health: ProductHealth,
    raw_devs: list[RawDev],
    bus_factor_detail: list[tuple[int, str, list[str]]],
    coverage_gaps: list[tuple[str, int, float | None]],
) -> list[PerfSignal]:
    """Эвристические сигналы с доказательной базой (evidence).

    bus_factor_detail: (emp_id, name, [имена ★-компетенций]).
    coverage_gaps: (имя компетенции, target_level, avg_level).
    Сортировка: critical → warning → info.
    """
    signals: list[PerfSignal] = []
    raw_by_emp = {rd.employee.id: rd for rd in raw_devs}

    # critical: bus-factor
    for emp_id, name, comps in bus_factor_detail:
        if not comps:
            continue
        signals.append(
            PerfSignal(
                severity="critical",
                kind="bus_factor",
                title=f"Bus-factor: {name}",
                detail=(
                    f"Единственный носитель {len(comps)} ★-компетенц"
                    f"{'ии' if len(comps) == 1 else 'ий'} продукта. "
                    f"Уход = потеря экспертизы."
                ),
                employee_id=emp_id,
                employee_name=name,
                evidence=[SignalEvidenceItem(label=c) for c in comps],
            )
        )

    # warning / info per developer
    for d in developers:
        rd = raw_by_emp.get(d.employee_id)
        prs = rd.prs if rd else []

        if rd and rd.stale_mrs:
            stale_sorted = sorted(rd.stale_mrs, key=lambda w: -w.age_days)
            signals.append(
                PerfSignal(
                    severity="warning",
                    kind="stale_prs",
                    title=f"Зависшие PR: {d.full_name}",
                    detail=(f"{len(stale_sorted)} PR висят дольше порога — нужно сдвинуть."),
                    employee_id=d.employee_id,
                    employee_name=d.full_name,
                    evidence=[
                        SignalEvidenceItem(
                            label=w.title or f"MR !{w.mr_iid}",
                            detail=(
                                f"{w.age_days} дн · с {_fmt_dt(w.created_at)}"
                                + (f" · {w.project_name}" if w.project_name else "")
                            ),
                            url=w.url,
                        )
                        for w in stale_sorted
                    ],
                )
            )
        if d.mr_count >= 3 and d.avg_quality < 0.5:
            low = sorted(
                (p for p in prs if p.quality_ratio < 0.5),
                key=lambda p: p.quality_ratio,
            )
            signals.append(
                PerfSignal(
                    severity="warning",
                    kind="low_quality",
                    title=f"Низкий quality: {d.full_name}",
                    detail=(
                        f"Средний quality {int(d.avg_quality * 100)}% "
                        f"на {d.mr_count} PR — ниже половины."
                    ),
                    employee_id=d.employee_id,
                    employee_name=d.full_name,
                    evidence=[
                        SignalEvidenceItem(
                            label=p.title or f"PR !{p.external_id}",
                            detail=(
                                f"quality {int(p.quality_ratio * 100)}% · "
                                f"{_fmt_dt(p.created_at_ext)}"
                            ),
                            url=p.url,
                        )
                        for p in low[:15]
                    ],
                )
            )
        if d.mr_count >= 5 and d.tests_pct == 0:
            no_tests = [p for p in prs if not (p.signals or {}).get("has_tests")]
            signals.append(
                PerfSignal(
                    severity="warning",
                    kind="no_tests",
                    title=f"Нет тестов: {d.full_name}",
                    detail=f"Ни один из {d.mr_count} PR не содержит тестов.",
                    employee_id=d.employee_id,
                    employee_name=d.full_name,
                    evidence=[
                        SignalEvidenceItem(
                            label=p.title or f"PR !{p.external_id}",
                            detail=_fmt_dt(p.created_at_ext),
                            url=p.url,
                        )
                        for p in no_tests[:15]
                    ],
                )
            )
        if d.mr_count >= 3 and d.avg_iterations > 3:
            heavy = sorted(
                (p for p in prs if p.iterations > 3),
                key=lambda p: -p.iterations,
            )
            signals.append(
                PerfSignal(
                    severity="warning",
                    kind="high_rework",
                    title=f"Много переделок: {d.full_name}",
                    detail=(
                        f"Среднее число итераций {d.avg_iterations:.1f} — "
                        f"PR-ы долго доводятся до merge."
                    ),
                    employee_id=d.employee_id,
                    employee_name=d.full_name,
                    evidence=[
                        SignalEvidenceItem(
                            label=p.title or f"PR !{p.external_id}",
                            detail=(f"{p.iterations} итераций · {_fmt_dt(p.created_at_ext)}"),
                            url=p.url,
                        )
                        for p in heavy[:15]
                    ],
                )
            )
        if d.mr_count == 0:
            signals.append(
                PerfSignal(
                    severity="info",
                    kind="inactive",
                    title=f"Нет активности: {d.full_name}",
                    detail="За период не было ни одного PR в репозиториях продукта.",
                    employee_id=d.employee_id,
                    employee_name=d.full_name,
                )
            )

    # product-level
    if health.coverage_gap >= 5:
        signals.append(
            PerfSignal(
                severity="warning",
                kind="coverage_gap",
                title="Дефицит компетенций стека",
                detail=(
                    f"Суммарный гэп ★-компетенций {health.coverage_gap:.0f} — "
                    f"команда не дотягивает до целевых уровней."
                ),
                evidence=[
                    SignalEvidenceItem(
                        label=name,
                        detail=(
                            f"target L{target} · "
                            f"факт {'L' + str(round(avg, 1)) if avg is not None else 'нет оценок'}"
                        ),
                    )
                    for name, target, avg in coverage_gaps
                ],
            )
        )
    if (
        health.workload_top_share is not None
        and health.workload_top_share > 0.5
        and health.total_prs >= 10
    ):
        top = max(raw_devs, key=lambda rd: len(rd.prs), default=None)
        signals.append(
            PerfSignal(
                severity="info",
                kind="workload_skew",
                title="Перекос нагрузки",
                detail=(
                    f"Один разработчик сделал "
                    f"{int(health.workload_top_share * 100)}% всех PR продукта."
                ),
                evidence=(
                    [
                        SignalEvidenceItem(
                            label=top.employee.full_name,
                            detail=f"{len(top.prs)} из {health.total_prs} PR",
                        )
                    ]
                    if top
                    else []
                ),
            )
        )
    if health.team_size >= 3 and health.reviewers_count <= max(1, health.team_size // 3):
        reviewers = [rd for rd in raw_devs if rd.comments_written > 0]
        signals.append(
            PerfSignal(
                severity="info",
                kind="review_imbalance",
                title="Перекос в ревью",
                detail=(
                    f"Code-review пишут только {health.reviewers_count} из "
                    f"{health.team_size} — ревью держится на немногих."
                ),
                evidence=[
                    SignalEvidenceItem(
                        label=rd.employee.full_name,
                        detail=f"{rd.comments_written} комментариев",
                    )
                    for rd in sorted(
                        reviewers,
                        key=lambda r: -r.comments_written,
                    )
                ],
            )
        )

    order = {"critical": 0, "warning": 1, "info": 2}
    signals.sort(key=lambda s: order.get(s.severity, 3))
    return signals
