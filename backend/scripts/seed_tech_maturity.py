"""Заполненные опросники техзрелости — для демо динамики на проектах.

Идемпотентно: удаляет существующие записи и создаёт новые.

Логика:
  • для каждого проекта определяем сколько кварталов в истории (зависит от
    started_at);
  • сценарий «постепенный рост»: на первом квартале закрываем половину L1, дальше
    каждый квартал добавляем порцию пунктов; некоторые проекты — стагнация или
    регресс для разнообразия.

Запуск:  uv run python -m scripts.seed_tech_maturity
"""

import asyncio
import random
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.project import Project
from app.models.tech_maturity import TechMaturitySurvey
from app.models.user import User
from app.tech_maturity.scoring import load_template

ADMIN_EMAIL = "admin@example.com"

# Профили заполнения — позволяют управлять «сценарием» проекта.
# Для каждого квартала указываем долю заполненных пунктов внутри уровня.
# Например (0.9, 0.7, 0.4, 0.0, 0.0) — почти полный L1, частичный L2-L3.

# Сценарий A: «зрелый проект, рост от среднего к высокому»
SCENARIO_MATURE: list[tuple[float, ...]] = [
    (0.85, 0.6, 0.3, 0.0, 0.0),  # Q-3
    (0.95, 0.75, 0.5, 0.1, 0.0),  # Q-2
    (1.0, 0.85, 0.65, 0.3, 0.0),  # Q-1
    (1.0, 0.9, 0.8, 0.5, 0.1),  # Q0 (текущий)
]

# Сценарий B: «средний рост» — 3 квартала
SCENARIO_GROWING: list[tuple[float, ...]] = [
    (0.6, 0.3, 0.1, 0.0, 0.0),
    (0.85, 0.55, 0.25, 0.0, 0.0),
    (0.95, 0.7, 0.4, 0.1, 0.0),
]

# Сценарий C: «новый проект, начали недавно» — 2 квартала
SCENARIO_NEW: list[tuple[float, ...]] = [
    (0.4, 0.15, 0.0, 0.0, 0.0),
    (0.7, 0.4, 0.15, 0.0, 0.0),
]

# Сценарий D: «застрявший в начале» — 3 квартала почти без роста
SCENARIO_STUCK: list[tuple[float, ...]] = [
    (0.5, 0.1, 0.0, 0.0, 0.0),
    (0.6, 0.15, 0.05, 0.0, 0.0),
    (0.65, 0.2, 0.05, 0.0, 0.0),
]

# По коду проекта выбираем базовый сценарий + профиль направлений.
# Профиль (множители 0.5..1.4) — расхождение направлений у одного проекта,
# чтобы линии в графике динамики не слипались.
PROJECT_SCENARIOS: dict[str, list[tuple[float, ...]]] = {
    "U190001633": SCENARIO_MATURE,  # ГибрИМА — старый, зрелый
    "U230008409": SCENARIO_GROWING,  # Уберизация — растёт
    "M-001": SCENARIO_GROWING,  # Mobile — растёт
    "QA-AUTO": SCENARIO_NEW,  # Автоматизация регресса — новый
    "RND-2026": SCENARIO_STUCK,  # RND — застрявший
}

# directionCode → множитель силы направления у проекта
# 1: Упр.разработкой, 2: Архитектура, 3: Системный анализ,
# 4: Разработка, 5: Тестирование, 6: DevOps, 7: Дизайн
PROJECT_DIRECTION_PROFILE: dict[str, dict[str, float]] = {
    # ГибрИМА: фронт-портал, Дизайн+Архитектура впереди, тестирование слабее
    "U190001633": {"1": 1.0, "2": 1.15, "3": 0.9, "4": 1.0, "5": 0.75, "6": 0.85, "7": 1.25},
    # Уберизация: backend-heavy, design не приоритет
    "U230008409": {"1": 1.0, "2": 1.05, "3": 0.95, "4": 1.2, "5": 0.85, "6": 1.05, "7": 0.6},
    # Mobile: дизайн и кодинг сильны, ops слабее
    "M-001": {"1": 0.95, "2": 0.95, "3": 0.95, "4": 1.15, "5": 1.0, "6": 0.8, "7": 1.25},
    # QA-AUTO: тестирование сильно опережает, дизайн почти отсутствует
    "QA-AUTO": {"1": 0.95, "2": 0.7, "3": 1.0, "4": 0.7, "5": 1.5, "6": 1.05, "7": 0.4},
    # RND: архитектура и анализ сильны, ops/тестирование слабо
    "RND-2026": {"1": 1.0, "2": 1.4, "3": 1.15, "4": 0.95, "5": 0.65, "6": 0.6, "7": 0.55},
}


def _quarter_label(year: int, q: int) -> str:
    return f"{year}-Q{q}"


def _periods_back(today: date, count: int) -> list[str]:
    """Возвращает последние N кварталов (от старого к новому), включая текущий."""
    cur_q = (today.month - 1) // 3 + 1
    cur_y = today.year
    out: list[str] = []
    for offset in range(count - 1, -1, -1):
        q = cur_q - offset
        y = cur_y
        while q <= 0:
            q += 4
            y -= 1
        out.append(_quarter_label(y, q))
    return out


def _completed_at_for(period: str) -> datetime:
    """Якорное completed_at — конец квартала."""
    y, q = period.split("-Q")
    end_month = int(q) * 3
    end_year = int(y)
    if end_month == 12:
        end = date(end_year, 12, 31)
    else:
        next_month = date(end_year, end_month + 1, 1)
        end = next_month - timedelta(days=1)
    return datetime(end.year, end.month, end.day, 18, 0, tzinfo=UTC)


def _build_answers(
    template: dict,
    level_fractions: tuple[float, ...],
    direction_profile: dict[str, float] | None = None,
) -> dict[str, int]:
    """Заполняем answers с per-direction множителем — чтобы направления
    давали разный рейтинг и линии в чарте не слипались."""
    answers: dict[str, int] = {}
    by_dir_level: dict[str, dict[int, list[str]]] = {}
    for item in template["data"]:
        dc = item["directionCode"]
        lvl = int(item["level"].split()[0])
        by_dir_level.setdefault(dc, {}).setdefault(lvl, []).append(item["paramCode"])

    for dcode, levels in by_dir_level.items():
        mul = (direction_profile or {}).get(dcode, 1.0)
        for lvl in range(1, 6):
            params = levels.get(lvl, [])
            if not params:
                continue
            base = level_fractions[lvl - 1] if lvl - 1 < len(level_fractions) else 0
            frac = max(0.0, min(1.0, base * mul))
            n_fill = int(round(len(params) * frac))
            shuffled = list(params)
            random.shuffle(shuffled)
            for p in shuffled[:n_fill]:
                answers[p] = 1
    return answers


async def main() -> None:
    random.seed(7)
    template = load_template()
    today = date.today()

    async with SessionLocal() as session:
        admin = (await session.execute(select(User).where(User.email == ADMIN_EMAIL))).scalar_one()

        # очистка
        await session.execute(delete(TechMaturitySurvey))
        await session.commit()

        n_total = 0
        n_projects = 0
        for code, scenario in PROJECT_SCENARIOS.items():
            proj = (
                await session.execute(select(Project).where(Project.code == code))
            ).scalar_one_or_none()
            if proj is None:
                print(f"!! проект {code} не найден — пропускаю")
                continue
            n_projects += 1
            periods = _periods_back(today, len(scenario))
            profile = PROJECT_DIRECTION_PROFILE.get(code)
            for period, level_fracs in zip(periods, scenario):
                ans = _build_answers(template, level_fracs, profile)
                is_current = period == periods[-1]
                completed = None if is_current else _completed_at_for(period)
                rv = TechMaturitySurvey(
                    project_id=proj.id,
                    period=period,
                    status="draft" if is_current else "done",
                    template_version=template["version"],
                    info={
                        "code": proj.code or "",
                        "team": proj.name,
                        "owner": "Демо-демо",
                        "manager": admin.full_name,
                        "version": template["version"],
                        "period": period,
                    },
                    answers=ans,
                    completed_at=completed,
                    created_by=admin.id,
                )
                session.add(rv)
                n_total += 1
        await session.commit()

    print(f"Загружено опросников техзрелости: {n_total} в {n_projects} проектах")
    for code in PROJECT_SCENARIOS:
        print(f"  {code:12s} : {len(PROJECT_SCENARIOS[code])} периодов")


if __name__ == "__main__":
    asyncio.run(main())
