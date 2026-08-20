from datetime import datetime
from typing import Literal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Vacancy(Base, TimestampMixin):
    """Открытая позиция (вакансия) — конкретная процедура найма.

    Привязывается либо к проекту (наиболее частый случай — ищем в команду),
    либо к отделу/практике (общий найм для пополнения штата). Один из них
    обязателен (CHECK).

    Требования к позиции (`requirements_md`) изначально предзаполняются
    шаблоном на основе role + grade, далее редактируются автором вакансии.

    Кандидаты привязываются через `CandidateProfile.vacancy_id`.
    """

    __tablename__ = "vacancies"
    __table_args__ = (
        # На этапе 5 заменим на product_id OR department_id.
        CheckConstraint(
            "project_id IS NOT NULL OR product_id IS NOT NULL OR department_id IS NOT NULL",
            name="ck_vacancies_target_required",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)

    title: Mapped[str] = mapped_column(String(255), nullable=False)

    # DEPRECATED — заменяется product_id. Удалим в этапе 5.
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    role_id: Mapped[int | None] = mapped_column(
        ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )
    grade_id: Mapped[int | None] = mapped_column(
        ForeignKey("grades.id", ondelete="SET NULL"), nullable=True
    )

    # Markdown с требованиями. На фронте — шаблон + правки.
    requirements_md: Mapped[str | None] = mapped_column(Text, nullable=True)

    # status: open | closed
    status: Mapped[Literal["open", "closed"]] = mapped_column(
        String(20), nullable=False, default="open", server_default="open", index=True
    )

    created_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
