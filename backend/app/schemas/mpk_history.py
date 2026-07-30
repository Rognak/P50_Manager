from datetime import date

from pydantic import BaseModel


class HistoryPoint(BaseModel):
    assessed_at: date
    level: int


class HistoryCompetency(BaseModel):
    competency_id: int
    name: str
    sort_order: int
    points: list[HistoryPoint]


class MpkHistory(BaseModel):
    competencies: list[HistoryCompetency]
