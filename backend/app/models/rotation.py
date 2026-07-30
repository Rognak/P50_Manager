from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Rotation(Base, TimestampMixin):
    """Факт ротации сотрудника между проектами.

    Цикл: proposed → accepted (все согласовали) → completed (membership пересажен)
    Альтернативные ветки: proposed → cancelled, completed → reverted.
    Сама строка — источник истины для дашборда (count completed/in_progress)."""

    __tablename__ = "rotations"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # DEPRECATED: ротации перешли на уровень продукта. На этапе 5 эти
    # project_id колонки будут удалены вместе со старыми FK.
    from_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    to_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Новые поля — primary после этапа 3.
    from_product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=True, index=True
    )
    to_product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # status: proposed | accepted | completed | cancelled | reverted
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="proposed", index=True
    )
    reason_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    initiated_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    proposed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # планируемая дата старта (когда ожидается зафиксировать факт ротации)
    planned_start_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reverted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reverted_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Кто пойдёт на освобождающееся место (информативно, для аудита и UI-ссылки).
    # Реальная ротация замены — отдельный Rotation-row.
    replacement_employee_id: Mapped[int | None] = mapped_column(
        ForeignKey("employees.id", ondelete="SET NULL"), nullable=True
    )


class RotationApproval(Base, TimestampMixin):
    """Голос конкретного руководителя по предложенной ротации.

    Список требуемых approvers вычисляется в момент proposal:
    {employee.owner, from_project.created_by, to_project.created_by} \\ {initiator}.
    Когда все decision='approve' — Rotation.status = 'accepted'.
    Любой 'reject' — Rotation.status = 'cancelled'."""

    __tablename__ = "rotation_approvals"
    __table_args__ = (UniqueConstraint("rotation_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    rotation_id: Mapped[int] = mapped_column(
        ForeignKey("rotations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # decision: approve | reject | NULL=ожидает
    decision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)


class RotationSuggestion(Base, TimestampMixin):
    """AI-обоснование и список предложенных целевых проектов
    для конкретной пары (сотрудник, проект-источник).

    Один сотрудник может состоять в нескольких проектах одновременно —
    обоснование «почему ротировать с этого проекта» в каждом случае своё."""

    __tablename__ = "rotation_suggestions"
    __table_args__ = (
        UniqueConstraint("employee_id", "from_project_id"),
        UniqueConstraint(
            "employee_id", "from_product_id",
            name="uq_rotation_suggestions_employee_from_product",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # DEPRECATED после этапа 3 — заменяется from_product_id.
    from_project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True, index=True
    )
    from_product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=True, index=True
    )
    rationale_md: Mapped[str] = mapped_column(Text, nullable=False)
    target_project_ids: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), nullable=False, server_default="{}"
    )
    target_product_ids: Mapped[list[int]] = mapped_column(
        ARRAY(Integer), nullable=False, server_default="{}"
    )
    model: Mapped[str | None] = mapped_column(String(50), nullable=True)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
