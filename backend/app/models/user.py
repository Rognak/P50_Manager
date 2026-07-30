from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin

# Роли пользователей системы:
#  • department_head — руководитель отдела/практики (текущая модель: своя команда сотрудников)
#  • manager         — менеджер продукта (доступ только в рамках своих проектов)
#  • core_team       — full read-only access по всем отделам и сотрудникам, без мутаций
USER_ROLES = ("department_head", "manager", "core_team")


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="department_head",
        server_default="department_head",
    )
    # Ортогонально к role: даёт доступ к админ-панели (фича-флаги, cron,
    # системные уведомления). Обычно у одного-двух пользователей.
    is_admin: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
