"""Демо-пользователи для не-стандартных ролей: CoreTeam (read-only) и PM
(менеджер продукта, видит только свои проекты).

Идемпотентно. Если PM указан — он становится `product_manager_id` для
указанных проектов (по `code`).

Запуск:  uv run python -m scripts.seed_roles
"""
import asyncio

from sqlalchemy import select, update

from app.core.security import hash_password
from app.db import SessionLocal
from app.models.project import Project
from app.models.user import User

DEFAULT_PASSWORD = "demo123"


async def _ensure_user(
    session, email: str, full_name: str, role: str
) -> User:
    u = (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()
    if u is None:
        u = User(
            email=email,
            full_name=full_name,
            role=role,
            is_active=True,
            password_hash=hash_password(DEFAULT_PASSWORD),
        )
        session.add(u)
        await session.flush()
        print(f"  + создан {role}: {email} / {DEFAULT_PASSWORD}")
    else:
        u.full_name = full_name
        u.role = role
        u.is_active = True
        u.password_hash = hash_password(DEFAULT_PASSWORD)
        await session.flush()
        print(f"  ↻ обновлён {role}: {email}")
    return u


async def main() -> None:
    async with SessionLocal() as session:
        # CoreTeam (full read-only)
        await _ensure_user(
            session,
            "coreteam@demo.local",
            "Демо Пользователь CoreTeam",
            "core_team",
        )

        # PM продукта — закрепляется на двух демо-проектах из seed_projects
        pm = await _ensure_user(
            session,
            "pm@demo.local",
            "Демо Пользователь PM",
            "manager",
        )

        # назначаем PM на проекты по коду (если они есть)
        pm_project_codes = ["U230008409", "M-001"]
        upd = await session.execute(
            update(Project)
            .where(Project.code.in_(pm_project_codes))
            .values(product_manager_id=pm.id)
        )
        await session.commit()
        print(
            f"  → PM закреплён на {upd.rowcount} проектах: "
            f"{', '.join(pm_project_codes)}"
        )


if __name__ == "__main__":
    asyncio.run(main())
