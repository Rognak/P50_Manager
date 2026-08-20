"""Формирование промпт-контекста и парсинг AI-обзора performance продукта."""

from __future__ import annotations

import json

from pydantic import ValidationError

from app.schemas.performance import (
    ProductPerformanceResponse,
    ProductReviewResult,
)

_HEALTH_RU = {
    "healthy": "здоровый",
    "attention": "требует внимания",
    "critical": "критично",
}


def build_review_context(product_name: str, perf: ProductPerformanceResponse) -> str:
    """Текстовый контекст для LLM — компактная сводка performance."""
    h = perf.health
    lines: list[str] = []
    lines.append(f"Продукт: {product_name}")
    lines.append(f"Период: {perf.period_from} — {perf.period_to}")
    lines.append("")
    lines.append("## Здоровье продукта")
    lines.append(
        f"Статус: {_HEALTH_RU.get(h.health_status, h.health_status)} "
        f"(health-score {h.health_score}/100)"
    )
    lines.append(
        f"PR-ов за период: {h.total_prs} "
        f"(merged {h.prs_merged}, open {h.prs_open}, closed {h.prs_closed})"
    )
    if h.total_prs_delta is not None:
        lines.append(f"  изменение объёма PR vs прошлый период: {h.total_prs_delta:+d}")
    if h.avg_quality is not None:
        lines.append(f"Средний quality: {int(h.avg_quality * 100)}%")
    if h.with_tests_pct is not None:
        lines.append(f"Доля PR с тестами: {int(h.with_tests_pct * 100)}%")
    if h.avg_ttm_hours is not None:
        lines.append(f"Среднее time-to-merge: {h.avg_ttm_hours} ч")
    lines.append(f"WIP сейчас: {h.wip_count}, зависших PR: {h.stale_count}")
    lines.append(f"Дефицит ★-компетенций (gap): {h.coverage_gap}, bus-factor: {h.bus_factor_count}")
    lines.append(
        f"Активных разработчиков: {h.active_developers}/{h.team_size}, "
        f"пишут ревью: {h.reviewers_count}/{h.team_size}"
    )
    if h.workload_top_share is not None:
        lines.append(f"Доля PR самого активного: {int(h.workload_top_share * 100)}%")
    lines.append("")

    lines.append("## Рейтинг разработчиков")
    for i, d in enumerate(perf.developers, 1):
        delta = (
            f", score {d.score_delta:+.1f} vs прошлый период" if d.score_delta is not None else ""
        )
        lines.append(
            f"{i}. {d.full_name} ({d.role_name or '—'} {d.grade_code or ''}) "
            f"— score {d.composite_score}{delta}"
        )
        lines.append(
            f"   PR: {d.mr_count} (merged {d.prs_merged}, open {d.prs_open}); "
            f"quality {int(d.avg_quality * 100)}%; "
            f"тесты {int(d.tests_pct * 100)}%; "
            f"переделки {int(d.rework_pct * 100)}%; "
            f"итераций ~{d.avg_iterations:.1f}; "
            f"ревью написано/получено {d.comments_written}/{d.comments_received}"
        )
    lines.append("")

    if perf.signals:
        lines.append("## Эвристические сигналы")
        for s in perf.signals:
            who = f" [{s.employee_name}]" if s.employee_name else ""
            lines.append(f"[{s.severity}]{who} {s.title}: {s.detail}")
        lines.append("")

    return "\n".join(lines)


REVIEW_SYSTEM_PROMPT = (
    "Ты — аналитик-ассистент руководителя отдела разработки. На основе "
    "данных performance продукта дай деловой разбор. Отвечай СТРОГО одним "
    "JSON-объектом, без markdown-обёртки, по схеме:\n"
    "{\n"
    '  "summary": "общая оценка состояния продукта, 2–4 предложения",\n'
    '  "health_verdict": "короткий вердикт по здоровью, 1 предложение",\n'
    '  "top_performers": [\n'
    '    {"name": "ФИО точно как в данных", "reason": "за что отмечен, кратко"}\n'
    "  ],\n"
    '  "risks": [\n'
    '    {"name": "ФИО или null если риск продукта в целом",\n'
    '     "severity": "critical|warning|info",\n'
    '     "text": "в чём риск, конкретно"}\n'
    "  ],\n"
    '  "actions": [\n'
    '    {"title": "краткое действие", "detail": "пояснение что и зачем"}\n'
    "  ]\n"
    "}\n\n"
    "Правила: actions — 3–5 пунктов по убыванию приоритета. top_performers "
    "и risks — по 2–4 пункта. Опирайся только на данные, без воды. Имена — "
    "точно как в данных. Текст на русском."
)


def parse_review_json(raw: str) -> ProductReviewResult:
    """Распарсить ответ LLM в ProductReviewResult. Снимает ```json-обёртку."""
    content = (raw or "").strip()
    if content.startswith("```"):
        content = content.strip("`")
        if content.lower().startswith("json"):
            content = content[4:]
        content = content.strip()
    try:
        data = json.loads(content)
    except json.JSONDecodeError as e:
        print(content)
        raise ValueError(f"AI вернул невалидный JSON: {e}") from e
    try:
        return ProductReviewResult.model_validate(data)
    except ValidationError as e:
        raise ValueError(f"AI вернул данные не по схеме: {e}") from e
