"""Сгенерировать демо-данные: 10 сотрудников с ролями, грейдами и историей оценок.

Все сотрудники принадлежат админу (admin@example.com). Скрипт идемпотентный
в смысле ФИО/email: при повторном запуске удаляет всех существующих сотрудников
админа и создаёт набор заново (для чистой демонстрации).

Использование:
    uv run python -m scripts.seed_demo
"""

import asyncio
import random
import sys
from datetime import date, timedelta

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.employee import Employee
from app.models.mpk import (
    Assessment,
    AssessmentScore,
    Competency,
    Grade,
    Role,
    RoleProfile,
)
from app.models.user import User

ADMIN_EMAIL = "admin@example.com"

DEMO: list[dict] = [
    # perf: +/-0.X — шаг роста уровня между оценками (+ растёт / − проседает)
    # hired_at указывается в годах назад от текущей даты (на момент запуска seed)
    {
        "full_name": "Демо Сотрудник 01",
        "position": "Ведущий специалист по разработке",
        "email": "ivanov@demo.local",
        "role": "Backend Python разработчик",
        "grade": "Middle",
        "perf": 0.25,
        "n": 3,
        "hired_years_ago": 2.5,
    },
    {
        "full_name": "Демо Сотрудник 02",
        "position": "Главный специалист по разработке",
        "email": "petrova@demo.local",
        "role": "Frontend web разработчик",
        "grade": "Senior",
        "perf": 0.20,
        "n": 4,
        "hired_years_ago": 5.5,
    },
    {
        "full_name": "Демо Сотрудник 03",
        "position": "Ведущий специалист по разработке",
        "email": "sidorov@demo.local",
        "role": "DevOps инженер",
        "grade": "Middle+",
        "perf": -0.30,
        "n": 3,
        "hired_years_ago": 4.0,
    },
    {
        "full_name": "Демо Сотрудник 04",
        "position": "Специалист по разработке",
        "email": "volkova@demo.local",
        "role": "Системный аналитик",
        "grade": "Junior+",
        "perf": 0.40,
        "n": 2,
        "hired_years_ago": 1.2,
    },
    {
        "full_name": "Демо Сотрудник 05",
        "position": "Главный специалист по разработке",
        "email": "kozlov@demo.local",
        "role": "Backend Java разработчик",
        "grade": "Senior+",
        "perf": 0.10,
        "n": 4,
        "hired_years_ago": 7.0,
    },
    {
        "full_name": "Демо Сотрудник 06",
        "position": "Ведущий специалист по разработке",
        "email": "morozova@demo.local",
        "role": "Тестировщик",
        "grade": "Middle",
        "perf": 0.00,
        "n": 3,
        "hired_years_ago": 3.0,
    },
    {
        "full_name": "Демо Сотрудник 07",
        "position": "Специалист по разработке",
        "email": "novikov@demo.local",
        "role": "Backend Python разработчик",
        "grade": "Junior",
        "perf": 0.50,
        "n": 2,
        "hired_years_ago": 0.4,
    },
    {
        "full_name": "Демо Сотрудник 08",
        "position": "Ведущий специалист по разработке",
        "email": "sokolova@demo.local",
        "role": "Mobile iOS разработчик",
        "grade": "Middle+",
        "perf": 0.15,
        "n": 3,
        "hired_years_ago": 3.8,
    },
    {
        "full_name": "Демо Сотрудник 09",
        "position": "Ведущий специалист по разработке",
        "email": "lebedev@demo.local",
        "role": "Frontend web разработчик",
        "grade": "Middle",
        "perf": -0.40,
        "n": 3,
        "hired_years_ago": 2.2,
        "left_months_ago": 0.5,
    },
    {
        "full_name": "Демо Сотрудник 10",
        "position": "Главный специалист по разработке",
        "email": "kuznetsov@demo.local",
        "role": "Backend Python разработчик",
        "grade": "Senior",
        "perf": 0.05,
        "n": 4,
        "hired_years_ago": 6.5,
    },
]


def quarter_middle(offset_q: int) -> date:
    """Середина (N + offset_q)-го квартала, где N — текущий."""
    today = date.today()
    q0 = (today.month - 1) // 3
    q = q0 + offset_q
    y = today.year + q // 4
    q = q % 4
    return date(y, q * 3 + 2, 15)


async def main() -> None:
    random.seed(42)

    async with SessionLocal() as session:
        admin = (
            await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        ).scalar_one_or_none()
        if admin is None:
            print(f"не найден пользователь {ADMIN_EMAIL} — сначала seed-admin", file=sys.stderr)
            sys.exit(1)

        roles = {r.name: r for r in (await session.execute(select(Role))).scalars().all()}
        grades = {g.code: g for g in (await session.execute(select(Grade))).scalars().all()}
        comps = (await session.execute(select(Competency))).scalars().all()
        profile_map: dict[tuple[int, int, int], int] = {
            (p.role_id, p.grade_id, p.competency_id): p.required_level
            for p in (await session.execute(select(RoleProfile))).scalars().all()
        }
        if not comps or not roles or not grades:
            print("справочник МПК пуст — сначала запустите import_mpk", file=sys.stderr)
            sys.exit(1)

        # wipe admin's employees (каскад снесёт их assessments)
        await session.execute(delete(Employee).where(Employee.owner_id == admin.id))
        await session.flush()

        emps_n = 0
        asmts_n = 0
        scores_n = 0
        for item in DEMO:
            role = roles.get(item["role"])
            grade = grades.get(item["grade"])
            if role is None or grade is None:
                print(
                    f"!! пропуск {item['full_name']}: роль/грейд не найдены ({item['role']}/{item['grade']})"
                )
                continue

            today = date.today()
            hired_at = today - timedelta(days=int(item["hired_years_ago"] * 365))
            left_at: date | None = None
            if "left_months_ago" in item:
                left_at = today - timedelta(days=int(item["left_months_ago"] * 30))
            emp = Employee(
                full_name=item["full_name"],
                email=item["email"],
                position=item["position"],
                owner_id=admin.id,
                role_id=role.id,
                grade_id=grade.id,
                hired_at=hired_at,
                left_at=left_at,
            )
            session.add(emp)
            await session.flush()
            emps_n += 1

            n = item["n"]
            perf = item["perf"]
            for i in range(n):
                offset_q = -(n - 1 - i)  # самая старая → -(n-1), самая новая → 0
                a = Assessment(
                    employee_id=emp.id,
                    author_id=admin.id,
                    assessed_at=quarter_middle(offset_q),
                    source="manual",
                    notes=f"демо-оценка Q{offset_q:+d}",
                )
                for c in comps:
                    req = profile_map.get((role.id, grade.id, c.id), 0)
                    if req == 0:
                        continue  # компетенция не требуется для этой роли/грейда
                    base = req - 0.3 + perf * i
                    noise = random.gauss(0, 0.65)
                    lvl = max(0, min(5, round(base + noise)))
                    a.scores.append(AssessmentScore(competency_id=c.id, level=lvl))
                    scores_n += 1
                session.add(a)
                asmts_n += 1

        await session.commit()

    print("Демо-данные загружены:")
    print(f"  сотрудников: {emps_n}")
    print(f"  оценок:      {asmts_n}")
    print(f"  score-строк: {scores_n}")
    print(f"  владелец:    {ADMIN_EMAIL}")


if __name__ == "__main__":
    asyncio.run(main())
