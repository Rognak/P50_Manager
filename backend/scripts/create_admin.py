import asyncio
import sys
from getpass import getpass

from sqlalchemy import select

from app.core.security import hash_password
from app.db import SessionLocal
from app.models.user import User


async def create(email: str, full_name: str, password: str) -> None:
    async with SessionLocal() as session:
        existing = await session.execute(select(User).where(User.email == email))
        if existing.scalar_one_or_none():
            print(f"Пользователь {email} уже существует", file=sys.stderr)
            sys.exit(1)
        user = User(
            email=email,
            full_name=full_name,
            password_hash=hash_password(password),
        )
        session.add(user)
        await session.commit()
        print(f"Создан пользователь #{user.id}: {user.email}")


def main() -> None:
    if len(sys.argv) == 4:
        email, full_name, password = sys.argv[1:]
    else:
        email = input("Email: ").strip().lower()
        full_name = input("ФИО: ").strip()
        password = getpass("Пароль: ")
    if len(password) < 6:
        print("Пароль должен быть не короче 6 символов", file=sys.stderr)
        sys.exit(1)
    asyncio.run(create(email.lower(), full_name, password))


if __name__ == "__main__":
    main()
