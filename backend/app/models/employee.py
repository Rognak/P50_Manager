from datetime import date

from sqlalchemy import Date, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.department import Department
from app.models.mpk import Grade, Role
from app.models.user import User


class Employee(Base, TimestampMixin):
    __tablename__ = "employees"
    __table_args__ = (Index("ix_employees_owner_id", "owner_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    position: Mapped[str | None] = mapped_column(String(255), nullable=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role_id: Mapped[int | None] = mapped_column(
        ForeignKey("roles.id", ondelete="SET NULL"), nullable=True
    )
    grade_id: Mapped[int | None] = mapped_column(
        ForeignKey("grades.id", ondelete="SET NULL"), nullable=True
    )
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 'employee' — реальный сотрудник; 'candidate' — претендент на найм.
    # Все «обычные» списки (МПК, проекты, ротации, self-review) фильтруют
    # kind='employee' — кандидаты туда не попадают, у них свой раздел.
    kind: Mapped[str] = mapped_column(
        String(20), nullable=False, default="employee", server_default="employee", index=True
    )
    # Дата найма. NULL допустим (если неизвестна, например для импортированных).
    hired_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Дата ухода. NULL = сотрудник активен.
    left_at: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    # GitLab username для запросов в CodeBuddy. Если NULL — helper выводит из
    # email-prefix (email.split('@')[0].lower().replace('.', '_')). Заполняется
    # вручную через UI/SQL для случаев, когда автоматический derive не подходит.
    gitlab_username: Mapped[str | None] = mapped_column(
        String(100), nullable=True, index=True
    )

    owner: Mapped[User] = relationship()
    role: Mapped[Role | None] = relationship()
    grade: Mapped[Grade | None] = relationship()
    department: Mapped[Department | None] = relationship()
