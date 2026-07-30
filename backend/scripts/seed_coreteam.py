"""Демо-пользователь CoreTeam — full read-only access.

Создаёт coreteam@demo.local / demo123 (если ещё не создан).

Запуск:  uv run python -m scripts.seed_coreteam
"""
import asyncio

from sqlalchemy import select

from app.core.security import hash_password
from app.db import SessionLocal
from app.models.user import User

EMAIL = "coreteam@demo.local"
FULL_NAME = "Демо Пользователь CoreTeam"
PASSWORD = "demo123"


async def main() -> None:
    async with SessionLocal() as session:
        existing = (
            await session.execute(select(User).where(User.email == EMAIL))
        ).scalar_one_or_none()
        if existing:
            existing.role = "core_team"
            existing.full_name = FULL_NAME
            existing.password_hash = hash_password(PASSWORD)
            existing.is_active = True
            await session.commit()
            print(f"Обновлён CoreTeam-пользователь: {EMAIL}")
            return
        u = User(
            email=EMAIL,
            full_name=FULL_NAME,
            password_hash=hash_password(PASSWORD),
            role="core_team",
            is_active=True,
        )
        session.add(u)
        await session.commit()
        print(f"Создан CoreTeam-пользователь: {EMAIL} / {PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
