from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CandidateProfile(Base, TimestampMixin):
    """Hiring-специфика для Employee с kind='candidate'.

    Сам кандидат хранится в Employee — это даёт переиспользование meetings,
    artifacts, AI-задач и пр. Профиль 1:1 с Employee хранит резюме (BYTEA),
    стадию воронки, AI-сводки и финальное решение.

    После найма kind переключается на 'employee' и проставляется hired_at.
    Профиль остаётся как исторический след «как пришёл в компанию»."""

    __tablename__ = "candidate_profiles"
    __table_args__ = (UniqueConstraint("employee_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False
    )
    # stage: new | screening | interview | offer | hired | rejected
    stage: Mapped[str] = mapped_column(
        String(20), nullable=False, default="new", server_default="new", index=True
    )
    source: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # На вакансию: задаёт контекст для AI-скрининга (требования + проект).
    vacancy_id: Mapped[int | None] = mapped_column(
        ForeignKey("vacancies.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Ожидаемые role/grade (если не указаны на вакансии или хотим override).
    expected_role_id: Mapped[int | None] = mapped_column(
        ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )
    expected_grade_id: Mapped[int | None] = mapped_column(
        ForeignKey("grades.id", ondelete="SET NULL"), nullable=True
    )

    # Резюме: BYTEA + извлечённый текст для AI
    resume_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    resume_content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    resume_size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    resume_uploaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resume_data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    resume_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    # AI-скрининг: качественная рекомендация (да/нет) + развёрнутое обоснование.
    ai_screening_recommended: Mapped[bool | None] = mapped_column(
        Boolean, nullable=True
    )
    ai_screening_reasoning_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_screening_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Решение по итогам — ставит руководитель вручную после интервью.
    feedback_decision: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # 'positive' | 'negative'
    rejection_reason_md: Mapped[str | None] = mapped_column(Text, nullable=True)
