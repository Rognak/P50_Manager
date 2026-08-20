from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

GenType = Literal["practical", "theoretical", "case", "code_review", "mixed"]
Difficulty = Literal["current", "target", "above_target", "custom"]
AnswerFormat = Literal["discussion", "code", "diagram", "written"]


class AIGenParams(BaseModel):
    competency_ids: list[int] = Field(default_factory=list)
    count: int = Field(3, ge=1, le=10)
    type: GenType = "mixed"
    difficulty: Difficulty = "target"
    custom_level: Annotated[int | None, Field(ge=0, le=5)] = None
    format: AnswerFormat = "discussion"
    time_budget_min: Annotated[int, Field(ge=5, le=60)] = 15
    custom_constraints: str = ""
    key_only: bool = False


class AIQuestion(BaseModel):
    uid: str | None = None  # стабильный идентификатор item (для связи с MeetingArtifact)
    competency_id: int
    competency_name: str | None = None
    question: str
    expected_level: int = Field(ge=0, le=5)
    rationale: str | None = None
    reference_answer: str | None = None


class AITask(BaseModel):
    uid: str | None = None
    competency_id: int
    competency_name: str | None = None
    title: str
    description: str
    input_data: str | None = None
    expected_level: int = Field(ge=0, le=5)
    time_min: int | None = None
    reference_solution: str | None = None


class AIQuestionsResult(BaseModel):
    questions: list[AIQuestion]


class AITasksResult(BaseModel):
    tasks: list[AITask]


class AISummaryResult(BaseModel):
    summary_md: str


class AICandidateScreening(BaseModel):
    """Структурированный результат AI-скрининга резюме (качественная оценка)."""

    recommended: bool = Field(description="true = рекомендуется к собеседованию, false = нет")
    reasoning_md: str = Field(description="развёрнутое обоснование в markdown")


# ---------- Digital profile (структурированный) ----------------------------


class DigitalProfileItem(BaseModel):
    """Один пункт в списках «сильные стороны» / «слабые места»."""

    title: str = Field(description="заголовок-тезис (3-7 слов)")
    detail: str = Field(description="развёрнутое описание (1-3 предложения)")
    source: str | None = Field(
        default=None,
        description=(
            "из каких данных пункт получен: «МПК+12 PR», «self-review», «activity 90 дн» и т.п."
        ),
    )


class DigitalProfileGapRow(BaseModel):
    """Строка таблицы «заявлено vs факт» по конкретной компетенции."""

    competency: str
    mpk_level: str = Field(description="L0..L5 или «—», если не задано в МПК")
    fact_summary: str = Field(
        description="Кратко: «L1 (3 PR)» или «активно (4 PR), не учтено в МПК»"
    )
    comment: str


class DigitalProfileProject(BaseModel):
    name: str
    role: str | None = None
    summary: str = Field(description="1-2 предложения о вкладе/нагрузке")


class DigitalProfileAction(BaseModel):
    title: str = Field(description="3-7 слов: «провести 1:1 по архитектуре»")
    detail: str = Field(description="1-2 предложения, КАК и ЗАЧЕМ")
    priority: Literal["high", "medium", "low"] = Field(
        default="medium",
        description="high = критично; medium = важно; low = можно отложить",
    )


class DigitalProfileResult(BaseModel):
    """Полный цифровой профиль сотрудника. JSON-схема жёсткая, AI обязан
    вернуть все поля. Пустые списки допустимы."""

    headline: str = Field(description="Одна фраза-выжимка для шапки (10-20 слов)")
    summary: str = Field(description="1-2 абзаца общего описания")
    strengths: list[DigitalProfileItem] = Field(default_factory=list)
    weaknesses: list[DigitalProfileItem] = Field(default_factory=list)
    gaps: list[DigitalProfileGapRow] = Field(default_factory=list)
    projects: list[DigitalProfileProject] = Field(default_factory=list)
    actions: list[DigitalProfileAction] = Field(default_factory=list)


class AIQuestionsStored(BaseModel):
    items: list[AIQuestion]
    params: AIGenParams
    generated_at: datetime
    model: str


class AITasksStored(BaseModel):
    items: list[AITask]
    params: AIGenParams
    generated_at: datetime
    model: str


class AISummaryRequest(BaseModel):
    notes: str = ""
