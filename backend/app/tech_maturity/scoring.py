"""Расчёт рейтинга техзрелости.

• Для каждого направления группируем пункты по уровню (1..5).
• На уровне: m = (n - z) / n
    n  — кол-во пунктов на этом уровне у направления;
    z  — кол-во пунктов с value == 0 (не отмечено / не выполнено).
  То есть m — доля «выполненных» пунктов.
• Идём от L1 к L5: суммируем m, как только встречаем m ≤ 0.8 — добавляем m
  и останавливаемся (этот уровень считаем граничным, дальше не идём).
• normalize = 100 / (NUM_DIRECTIONS * 5) — приводим направление к доле от 100%.
• rating_направления = sum(m_i для зачтённых уровней) * normalize
• Уровень зрелости направления = индекс последнего зачтённого уровня (целое).
• Общий рейтинг = сумма рейтингов всех направлений.
• Общий уровень = минимальный достигнутый среди направлений.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

TEMPLATE_PATH = Path(__file__).parent / "template.json"


@lru_cache(maxsize=1)
def load_template() -> dict[str, Any]:
    """Возвращает шаблон опросника. Кэшируется в памяти процесса."""
    with TEMPLATE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _level_index(level_label: str) -> int:
    """'3 (развитый)' → 3"""
    return int(level_label.split(" ", 1)[0])


def calc_marks(template: dict[str, Any], answers: dict[str, float]) -> dict[str, Any]:
    """Возвращает структуру с расчётами по каждому направлению + суммарными.

    {
      "by_direction": {
        "1": {
          "name": "Управление разработкой",
          "level_marks": {"1": 1.0, "2": 0.83, "3": 0.5, "4": null, "5": null},
          "level": 3,             # достигнутый уровень (последний с m > 0.8 + первый ≤ 0.8)
          "rating": 30.0,         # 0..(100/NUM_DIR)
        },
        ...
      },
      "total_rating": 65.5,        # сумма по направлениям, 0..100
      "overall_level": 2,          # min среди направлений
    }
    """
    num_dirs = len(template["direction"])
    normalize = 100.0 / (num_dirs * 5)

    # data сгруппируем по directionCode + level
    by_dir_level: dict[str, dict[int, list[str]]] = {}
    for item in template["data"]:
        dcode = item["directionCode"]
        lvl = _level_index(item["level"])
        by_dir_level.setdefault(dcode, {}).setdefault(lvl, []).append(item["paramCode"])

    by_direction: dict[str, dict[str, Any]] = {}
    levels_reached: list[int] = []

    for dcode, dir_name in template["direction"].items():
        per_level = by_dir_level.get(dcode, {})
        level_marks: dict[str, float | None] = {str(i): None for i in range(1, 6)}
        cumulative = 0.0
        last_level = 0  # 0 = «пассивный»
        for lvl in range(1, 6):
            params = per_level.get(lvl, [])
            if not params:
                level_marks[str(lvl)] = None
                continue
            n = len(params)
            z = sum(1 for p in params if not _truthy(answers.get(p)))
            m = (n - z) / n if n > 0 else 0.0
            level_marks[str(lvl)] = round(m, 4)
            if m > 0.8:
                cumulative += m
                last_level = lvl
            else:
                # засчитываем дробью и стопаем
                cumulative += m
                break
        rating = round(cumulative * normalize, 2)
        by_direction[dcode] = {
            "name": dir_name,
            "level_marks": level_marks,
            "level": last_level,
            "rating": rating,
        }
        levels_reached.append(last_level)

    total_rating = round(sum(d["rating"] for d in by_direction.values()), 2)
    overall_level = min(levels_reached) if levels_reached else 0

    return {
        "by_direction": by_direction,
        "total_rating": total_rating,
        "overall_level": overall_level,
    }


def _truthy(v: Any) -> bool:
    """Считаем «выполнено», если value > 0. Поддерживает '1', 1, '1.0' и т.п."""
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    try:
        return float(v) > 0
    except (ValueError, TypeError):
        return False
