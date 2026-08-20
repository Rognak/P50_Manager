import csv
import re
from functools import lru_cache
from pathlib import Path


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


@lru_cache(maxsize=1)
def _aliases() -> dict[str, str]:
    result: dict[str, str] = {}
    source = Path(__file__).resolve().parents[1] / "data" / "technology_icon_map.csv"
    with source.open(encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            for value in [row["technology_id"], row["name"], *row["aliases"].split("|")]:
                if value:
                    result[_normalize(value)] = row["icon_slug"]
    result.update(
        {
            _normalize("C#"): "sharp",
            _normalize("Kafka"): "apachekafka",
            _normalize("OpenShift"): "redhatopenshift",
            _normalize("ReactJS"): "react",
        }
    )
    return result


def suggest_technology_icon_slug(name: str) -> str | None:
    return _aliases().get(_normalize(name))
