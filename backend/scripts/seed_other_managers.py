"""Демо-данные для других руководителей: создаёт пару доп. пользователей-руководителей,
их сотрудников с историей оценок и добавляет их в существующие проекты админа.

Идемпотентно: пользователи находятся по email (создаются если нет, пароль не трогается),
сотрудники указанных руководителей перезаливаются заново; членство в проектах
добавляется только если ещё нет (UniqueConstraint на (project_id, employee_id)).

Использование:
    uv run python -m scripts.seed_other_managers
"""

import asyncio
import random
import sys
from datetime import date

from sqlalchemy import delete, select

from app.core.security import hash_password
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
from app.models.project import Project, ProjectMember
from app.models.user import User

DEFAULT_PASSWORD = "demo123"

MANAGERS: list[dict] = [
    {
        "email": "lead_qa@demo.local",
        "full_name": "Демо Руководитель QA",
        "password": DEFAULT_PASSWORD,
        "employees": [
            {
                "full_name": "Демо Сотрудник QA01",
                "position": "Главный специалист по тестированию",
                "email": "zaharova@demo.local",
                "role": "Тестировщик",
                "grade": "Senior",
                "perf": 0.15,
                "n": 4,
            },
            {
                "full_name": "Демо Сотрудник QA02",
                "position": "Ведущий специалист по тестированию",
                "email": "grigoriev@demo.local",
                "role": "Тестировщик",
                "grade": "Middle+",
                "perf": 0.30,
                "n": 3,
            },
            {
                "full_name": "Демо Сотрудник QA03",
                "position": "Ведущий специалист по тестированию",
                "email": "semenova@demo.local",
                "role": "Тестировщик",
                "grade": "Middle",
                "perf": 0.10,
                "n": 3,
            },
            {
                "full_name": "Демо Сотрудник QA04",
                "position": "Специалист по тестированию",
                "email": "tarasov@demo.local",
                "role": "Тестировщик",
                "grade": "Junior+",
                "perf": 0.45,
                "n": 2,
            },
            {
                "full_name": "Демо Сотрудник SA01",
                "position": "Ведущий системный аналитик",
                "email": "efimova@demo.local",
                "role": "Системный аналитик",
                "grade": "Middle",
                "perf": 0.20,
                "n": 3,
            },
        ],
    },
    {
        "email": "lead_mobile@demo.local",
        "full_name": "Демо Руководитель Mobile",
        "password": DEFAULT_PASSWORD,
        "employees": [
            {
                "full_name": "Демо Сотрудник Mobile01",
                "position": "Главный специалист по разработке",
                "email": "belyaev@demo.local",
                "role": "Mobile iOS разработчик",
                "grade": "Senior",
                "perf": 0.10,
                "n": 4,
            },
            {
                "full_name": "Демо Сотрудник Java01",
                "position": "Главный специалист по разработке",
                "email": "zhukov@demo.local",
                "role": "Backend Java разработчик",
                "grade": "Senior+",
                "perf": 0.05,
                "n": 4,
            },
            {
                "full_name": "Демо Сотрудник Java02",
                "position": "Ведущий специалист по разработке",
                "email": "gavrilov@demo.local",
                "role": "Backend Java разработчик",
                "grade": "Middle",
                "perf": 0.25,
                "n": 3,
            },
            {
                "full_name": "Демо Сотрудник Java03",
                "position": "Специалист по разработке",
                "email": "romanov@demo.local",
                "role": "Backend Java разработчик",
                "grade": "Junior",
                "perf": 0.50,
                "n": 2,
            },
            {
                "full_name": "Демо Сотрудник DevOps01",
                "position": "Ведущий DevOps-инженер",
                "email": "zaitseva@demo.local",
                "role": "DevOps инженер",
                "grade": "Middle",
                "perf": 0.15,
                "n": 3,
            },
        ],
    },
]

# (email сотрудника, project.code, role_in_project, joined_at)
PROJECT_PLACEMENTS: list[tuple[str, str, str, date]] = [
    # QA-AUTO — усиление команды тестирования
    ("zaharova@demo.local", "QA-AUTO", "Senior QA", date(2026, 1, 12)),
    ("grigoriev@demo.local", "QA-AUTO", "QA Automation", date(2026, 1, 20)),
    ("tarasov@demo.local", "QA-AUTO", "Junior QA", date(2026, 2, 15)),
    # ГибрИМА — внешняя QA + DevOps
    ("semenova@demo.local", "U190001633", "QA", date(2025, 4, 1)),
    ("zaitseva@demo.local", "U190001633", "DevOps", date(2025, 6, 10)),
    # Уберизация НТЦ — аналитик + усиление Java/Python
    ("efimova@demo.local", "U230008409", "Системный аналитик", date(2025, 9, 5)),
    ("zhukov@demo.local", "U230008409", "Backend (Java интеграции)", date(2025, 10, 1)),
    ("gavrilov@demo.local", "U230008409", "Backend Developer", date(2025, 11, 15)),
    # Mobile-приложение
    ("belyaev@demo.local", "M-001", "iOS Developer", date(2025, 6, 10)),
    ("romanov@demo.local", "M-001", "Junior Backend (Java)", date(2025, 9, 1)),
    ("zaitseva@demo.local", "M-001", "DevOps (part-time)", date(2025, 7, 1)),
]


def quarter_middle(offset_q: int) -> date:
    today = date.today()
    q0 = (today.month - 1) // 3
    q = q0 + offset_q
    y = today.year + q // 4
    q = q % 4
    return date(y, q * 3 + 2, 15)


async def upsert_user(session, email: str, full_name: str, password: str) -> User:
    existing = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing is not None:
        # имя может уточниться, пароль не трогаем
        if existing.full_name != full_name:
            existing.full_name = full_name
        return existing
    user = User(
        email=email,
        full_name=full_name,
        password_hash=hash_password(password),
    )
    session.add(user)
    await session.flush()
    return user


async def main() -> None:
    random.seed(7)

    async with SessionLocal() as session:
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

        users_n = 0
        emps_n = 0
        asmts_n = 0
        scores_n = 0
        emp_by_email: dict[str, Employee] = {}

        for mgr in MANAGERS:
            user = await upsert_user(
                session,
                email=mgr["email"],
                full_name=mgr["full_name"],
                password=mgr["password"],
            )
            users_n += 1

            # перезаливаем сотрудников этого руководителя
            await session.execute(delete(Employee).where(Employee.owner_id == user.id))
            await session.flush()

            for item in mgr["employees"]:
                role = roles.get(item["role"])
                grade = grades.get(item["grade"])
                if role is None or grade is None:
                    print(
                        f"!! пропуск {item['full_name']}: роль/грейд не найдены ({item['role']}/{item['grade']})"
                    )
                    continue

                emp = Employee(
                    full_name=item["full_name"],
                    email=item["email"],
                    position=item["position"],
                    owner_id=user.id,
                    role_id=role.id,
                    grade_id=grade.id,
                )
                session.add(emp)
                await session.flush()
                emps_n += 1
                emp_by_email[item["email"]] = emp

                n = item["n"]
                perf = item["perf"]
                for i in range(n):
                    offset_q = -(n - 1 - i)
                    a = Assessment(
                        employee_id=emp.id,
                        author_id=user.id,
                        assessed_at=quarter_middle(offset_q),
                        source="manual",
                        notes=f"демо-оценка Q{offset_q:+d}",
                    )
                    for c in comps:
                        req = profile_map.get((role.id, grade.id, c.id), 0)
                        if req == 0:
                            continue
                        base = req - 0.3 + perf * i
                        noise = random.gauss(0, 0.65)
                        lvl = max(0, min(5, round(base + noise)))
                        a.scores.append(AssessmentScore(competency_id=c.id, level=lvl))
                        scores_n += 1
                    session.add(a)
                    asmts_n += 1

        # размещение в проекты
        proj_q = await session.execute(select(Project))
        proj_by_code: dict[str, Project] = {p.code: p for p in proj_q.scalars() if p.code}

        existing_q = await session.execute(
            select(ProjectMember.project_id, ProjectMember.employee_id)
        )
        existing_pairs = {(pid, eid) for pid, eid in existing_q.all()}

        placed_n = 0
        for emp_email, code, role_in_project, joined_at in PROJECT_PLACEMENTS:
            placement_emp = emp_by_email.get(emp_email)
            proj = proj_by_code.get(code)
            if placement_emp is None:
                print(f"!! сотрудник не найден: {emp_email}")
                continue
            if proj is None:
                print(f"!! проект не найден: {code}")
                continue
            if (proj.id, placement_emp.id) in existing_pairs:
                continue
            session.add(
                ProjectMember(
                    project_id=proj.id,
                    employee_id=placement_emp.id,
                    role_in_project=role_in_project,
                    joined_at=joined_at,
                )
            )
            placed_n += 1

        await session.commit()

    print("Доп. демо-данные загружены:")
    print(f"  руководителей:    {users_n}  (пароль по умолчанию: {DEFAULT_PASSWORD})")
    print(f"  сотрудников:      {emps_n}")
    print(f"  оценок:           {asmts_n}")
    print(f"  score-строк:      {scores_n}")
    print(f"  membership добавлено: {placed_n}")
    print()
    print("Учётки:")
    for mgr in MANAGERS:
        print(f"  {mgr['email']:30s}  {mgr['full_name']}")


if __name__ == "__main__":
    asyncio.run(main())
