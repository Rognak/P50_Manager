from datetime import date

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Product(Base, TimestampMixin):
    """Продукт = логическая единица из 1+ GitLab-репозиториев.

    Соответствует GitLab-группе (через `gitlab_group`), а для проектов
    заведённых вручную или одиночных репо без группы — Product 1:1
    с одним Project. Все «бизнес-сущности» (участники, тех.стек, ротации,
    вакансии) живут на уровне Product, а Project (репо) даёт только
    dev-метрики и PR-ы по конкретному репозиторию.
    """
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="active"
    )
    started_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    finished_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    # PM продукта (роли 'manager' видят только свои продукты).
    product_manager_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Идентификатор GitLab-группы (например 'devzone/NonProgram/isup').
    # NULL для продуктов, у которых нет соответствия GitLab-группе
    # (вручную заведённые / одиночные репо без группы).
    gitlab_group: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True, index=True
    )

    projects: Mapped[list["Project"]] = relationship(
        back_populates="product"
    )


class Project(Base, TimestampMixin):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    started_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    finished_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    # Менеджер продукта проекта. Доступ роли 'manager' ограничен проектами,
    # где product_manager_id совпадает с user.id. NULL — у проекта нет PM.
    # DEPRECATED: переехало в Product. Оставлено на время этапа 2 миграции.
    product_manager_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # FK на продукт. Каждый репо принадлежит одному продукту.
    # nullable первые сутки/этап миграции, потом — NOT NULL.
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    # GitLab project ID для фильтрации запросов в CodeBuddy (`?projectId=...`).
    # Без него агрегаты CodeBuddy на уровне проекта не отфильтровать на стороне
    # CodeBuddy — придётся тянуть всё и фильтровать у себя по projectName.
    gitlab_project_id: Mapped[int | None] = mapped_column(
        Integer, nullable=True, index=True
    )
    # Полный путь GitLab-группы (без имени репо) — извлекается из MR url.
    # DEPRECATED: дублирует Product.gitlab_group. Оставлено на этап миграции.
    gitlab_group: Mapped[str | None] = mapped_column(
        String(255), nullable=True, index=True
    )

    product: Mapped["Product | None"] = relationship(
        back_populates="projects"
    )
    members: Mapped[list["ProjectMember"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )
    competencies: Mapped[list["ProjectCompetency"]] = relationship(
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProductMember(Base, TimestampMixin):
    """Член продукта (агрегат по всем его репо).

    Один человек в нескольких репо одного продукта — одна запись. При
    конвертации из ProjectMember сливаются:
      • joined_at = min(joined_at)
      • left_at = max(left_at), но NULL если хотя бы одно репо активно
      • rotation_locked = OR
      • role_in_project / rotation_lock_note — первое непустое
    """

    __tablename__ = "product_members"
    __table_args__ = (UniqueConstraint("product_id", "employee_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_in_project: Mapped[str | None] = mapped_column(String(100), nullable=True)
    joined_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    left_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    rotation_locked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    rotation_lock_note: Mapped[str | None] = mapped_column(Text, nullable=True)


class ProductCompetency(Base):
    """Тех.стек продукта (агрегат по всем его репо)."""

    __tablename__ = "product_competencies"

    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    )
    competency_id: Mapped[int] = mapped_column(
        ForeignKey("competencies.id", ondelete="CASCADE"), primary_key=True
    )
    target_level: Mapped[int] = mapped_column(Integer, nullable=False, default=3)


class ProjectMember(Base, TimestampMixin):
    """DEPRECATED после этапа 2 — данные мигрированы в product_members.
    Таблица оставлена для безопасного rollback и будет удалена в этапе 5.
    """
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "employee_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role_in_project: Mapped[str | None] = mapped_column(String(100), nullable=True)
    joined_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    left_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    rotation_locked: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false", default=False
    )
    rotation_lock_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped[Project] = relationship(back_populates="members")


class ProjectCompetency(Base):
    """DEPRECATED после этапа 2 — данные мигрированы в product_competencies.
    Таблица будет удалена в этапе 5.
    """

    __tablename__ = "project_competencies"

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    competency_id: Mapped[int] = mapped_column(
        ForeignKey("competencies.id", ondelete="CASCADE"), primary_key=True
    )
    target_level: Mapped[int] = mapped_column(Integer, nullable=False, default=3)

    project: Mapped[Project] = relationship(back_populates="competencies")
