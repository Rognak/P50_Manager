"""Расчёт рейтинга техзрелости отдела по той же модели, что и отчёт ГПН-ЦР.

Структура опросника:
  • 7 направлений (CON, STU, SKI, IMP, ROT, SOR, MET);
  • в каждом направлении — N процессов (1–4 на направление);
  • для каждого процесса — стандартный 5-уровневый чек-лист из 6 критериев
    (уровень 4 содержит 2 критерия, остальные — по одному);
  • каждый критерий имеет одно из значений: "yes" / "no" / "na".

Алгоритм:
  1) per-direction-per-level value = доля "yes" среди всех применимых
     (yes + no) ответов по всем критериям всех процессов на этом уровне.
     Если все ответы "na" — уровень не учитывается.
  2) per-direction rating = (Сумма level_value до первого ≤ 0.8 включительно)
     × (100 / 35). 35 = 7 направлений × 5 уровней.
  3) per-direction level = индекс последнего уровня с value > 0.8.
  4) total rating = сумма всех direction rating.
  5) overall level = min direction.level (при пустом — 0).

Формат `answers`:
  ключ = "{processCode}-{level}-{critIdx}", значение = "yes" | "no" | "na".
  Отсутствующий ключ трактуется как "no".
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

TEMPLATE_PATH = Path(__file__).parent / "template.json"
TOTAL_DIRECTIONS = 7
TOTAL_LEVELS = 5
NORMALIZE = 100.0 / (TOTAL_DIRECTIONS * TOTAL_LEVELS)  # 100 / 35
CUTOFF = 0.8  # сумма до первого ≤ CUTOFF включительно

CriteriaValue = Literal["yes", "no", "na"]


@lru_cache(maxsize=1)
def load_template() -> dict[str, Any]:
    with TEMPLATE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _criterion_keys_at_level(template: dict[str, Any], level: int) -> list[int]:
    """Индексы критериев, определённых для данного уровня."""
    return [c["idx"] for c in template["criteria"] if c["level"] == level]


def _level_value(
    template: dict[str, Any],
    answers: dict[str, str],
    direction_processes: list[str],
    level: int,
) -> float | None:
    """Доля 'yes' по всем критериям всех процессов направления на уровне.
    Возвращает None если все ответы — 'na'."""
    crit_indexes = _criterion_keys_at_level(template, level)
    yes = 0
    applicable = 0
    for proc_code in direction_processes:
        for cidx in crit_indexes:
            v = answers.get(f"{proc_code}-{level}-{cidx}", "no")
            if v == "na":
                continue
            applicable += 1
            if v == "yes":
                yes += 1
    if applicable == 0:
        return None
    return yes / applicable


def calc_marks(template: dict[str, Any], answers: dict[str, str]) -> dict[str, Any]:
    """Возвращает структуру:
    {
      "by_direction": {
        "CON": {
          "name": str,
          "level_marks": {"1": float|None, ..., "5": float|None},
          "level": int,    # последний уровень с value > 0.8
          "rating": float, # round(sum × 100/35, 2)
          "processes": [process_code, ...]
        },
        ...
      },
      "total_rating": float,
      "overall_level": int,
    }
    """
    by_direction: dict[str, dict[str, Any]] = {}
    levels_reached: list[int] = []

    for d in template["directions"]:
        dcode = d["code"]
        dname = d["name"]
        proc_codes = [p["code"] for p in d["processes"]]

        level_marks: dict[str, float | None] = {}
        cumulative = 0.0
        last_level = 0
        for lvl in range(1, TOTAL_LEVELS + 1):
            v = _level_value(template, answers, proc_codes, lvl)
            level_marks[str(lvl)] = round(v, 4) if v is not None else None
            if v is None:
                # пропускаем "не применимо" уровень — не суммируем, не ломаем цепочку
                continue
            if v > CUTOFF:
                cumulative += v
                last_level = lvl
            else:
                cumulative += v
                break
        rating = round(cumulative * NORMALIZE, 2)
        by_direction[dcode] = {
            "name": dname,
            "level_marks": level_marks,
            "level": last_level,
            "rating": rating,
            "processes": proc_codes,
        }
        levels_reached.append(last_level)

    total_rating = round(sum(d["rating"] for d in by_direction.values()), 2)
    overall_level = min(levels_reached) if levels_reached else 0

    return {
        "by_direction": by_direction,
        "total_rating": total_rating,
        "overall_level": overall_level,
    }
