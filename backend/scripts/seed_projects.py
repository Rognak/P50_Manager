"""Тестовые проекты с участниками и тех.стеком.
Идемпотентно: удаляет всех существующих проектов админа и пересоздаёт.

Запуск:
    uv run python -m scripts.seed_projects
"""
import asyncio
import sys
from datetime import date

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.employee import Employee
from app.models.mpk import Competency
from app.models.project import Project, ProjectCompetency, ProjectMember
from app.models.user import User
from app.models.vacancy import Vacancy

ADMIN_EMAIL = "admin@example.com"

PROJECTS: list[dict] = [
    {
        "code": "U230008409",
        "name": "Уберизация НТЦ",
        "description": "Backend-сервис для оперативного распределения задач в НТЦ. Высокая нагрузка, нужен надёжный Python-стек.",
        "status": "active",
        "started_at": date(2025, 9, 1),
        "finished_at": None,
        "stack": [
            ("Программирование", 4),
            ("Разработка Back (Python)", 4),
            ("Базы данных", 3),
            ("Автоматизация обновлений (CI/CD)", 3),
            ("Системы контроля версий", 3),
            ("Управление качеством (тестирование)", 2),
        ],
        "members": [
            ("kuznetsov@demo.local", "Tech Lead", date(2025, 9, 1), None),
            ("ivanov@demo.local", "Backend Developer", date(2025, 9, 15), None),
            ("novikov@demo.local", "Junior Backend", date(2025, 11, 1), None),
            ("sidorov@demo.local", "DevOps", date(2025, 9, 10), None),
            # Ушёл по итогам ротации в M-001 (Mobile)
            (
                "kozlov@demo.local",
                "Backend (Python)",
                date(2025, 9, 1),
                date(2026, 1, 15),
            ),
        ],
    },
    {
        "code": "U190001633",
        "name": "ГибрИМА",
        "description": "Гибридная информационно-моделирующая архитектура. Web-портал + backend + интеграции.",
        "status": "active",
        "started_at": date(2024, 1, 15),
        "finished_at": None,
        "stack": [
            ("Разработка Front (Angular, React, QT)",4),
            ("Программирование", 3),
            ("Базы данных", 2),
            ("Системы контроля версий", 3),
            ("Управление качеством (тестирование)", 3),
            ("Автоматизация обновлений (CI/CD)", 2),
            ("Анализ интеграционных решений", 3),
        ],
        "members": [
            ("petrova@demo.local", "Frontend Lead", date(2024, 1, 15), None),
            ("lebedev@demo.local", "Frontend Developer", date(2024, 3, 1), None),
            ("sidorov@demo.local", "DevOps (part-time)", date(2024, 6, 1), None),
            ("morozova@demo.local", "QA", date(2024, 8, 12), None),
            # Уходила в декрет / закончился контракт
            (
                "volkova@demo.local",
                "QA (ручное)",
                date(2024, 4, 1),
                date(2025, 11, 30),
            ),
        ],
    },
    {
        "code": "QA-AUTO",
        "name": "Автоматизация регресса",
        "description": "Покрытие критичных сценариев авто-тестами. Цель — сократить регресс с недели до дня.",
        "status": "active",
        "started_at": date(2026, 1, 10),
        "finished_at": None,
        "stack": [
            ("Управление тестированием", 4),
            ("Авто тестирование", 3),
            ("Управление качеством (тестирование)", 3),
            ("Системы контроля версий", 2),
        ],
        "members": [
            ("morozova@demo.local", "QA Lead", date(2026, 1, 10), None),
            ("volkova@demo.local", "QA Engineer", date(2026, 2, 1), None),
        ],
    },
    {
        "code": "M-001",
        "name": "Mobile-приложение для оперативного управления",
        "description": "iOS-клиент для полевых задач. Backend на Java + Python-микросервис аналитики.",
        "status": "active",
        "started_at": date(2025, 6, 1),
        "finished_at": None,
        "stack": [
            ("Разработка Mobile (IOS)", 3),
            ("Разработка Back (Java)", 4),
            ("Разработка Back (Python)", 3),
            ("Базы данных", 3),
            ("Автоматизация обновлений (CI/CD)", 3),
            ("Системы контроля версий", 3),
        ],
        "members": [
            ("sokolova@demo.local", "iOS Lead", date(2025, 6, 1), None),
            ("kozlov@demo.local", "Backend (Java)", date(2026, 1, 15), None),
            (
                "kuznetsov@demo.local",
                "Backend (Python, Аналитика)",
                date(2025, 8, 20),
                None,
            ),
        ],
    },
    {
        "code": "RND-2026",
        "name": "RND: Платформа для МПК",
        "description": "Прототип платформы автоматизации МПК-оценок. Завершён, документация передана.",
        "status": "completed",
        "started_at": date(2024, 9, 1),
        "finished_at": date(2025, 12, 31),
        "stack": [
            ("Программирование", 3),
            ("Разработка Front (Angular, React, QT)",3),
            ("Базы данных", 2),
        ],
        "members": [
            ("ivanov@demo.local", "Tech Lead", date(2024, 9, 1), date(2025, 12, 31)),
            ("lebedev@demo.local", "Frontend", date(2024, 11, 1), date(2025, 12, 31)),
            (
                "kuznetsov@demo.local",
                "Backend Python",
                date(2024, 9, 1),
                date(2025, 8, 19),
            ),
        ],
    },
]


async def main() -> None:
    async with SessionLocal() as session:
        admin = (
            await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        ).scalar_one_or_none()
        if admin is None:
            print(f"!! не найден {ADMIN_EMAIL} — сначала seed_admin", file=sys.stderr)
            sys.exit(1)

        # карта email → employee
        emp_q = await session.execute(select(Employee))
        emp_by_email: dict[str, Employee] = {
            e.email: e for e in emp_q.scalars() if e.email
        }

        # карта name → competency
        comp_q = await session.execute(select(Competency))
        comp_by_name: dict[str, Competency] = {c.name: c for c in comp_q.scalars()}

        # Удаляем существующие проекты админа. Сначала чистим вакансии,
        # привязанные к этим проектам, иначе ON DELETE SET NULL роняет CHECK
        # (project_id IS NOT NULL OR department_id IS NOT NULL).
        proj_ids_q = await session.execute(
            select(Project.id).where(Project.created_by == admin.id)
        )
        proj_ids = [pid for (pid,) in proj_ids_q.all()]
        if proj_ids:
            await session.execute(
                delete(Vacancy).where(Vacancy.project_id.in_(proj_ids))
            )
        del_q = await session.execute(
            select(Project).where(Project.created_by == admin.id)
        )
        for p in del_q.scalars():
            await session.delete(p)
        await session.flush()

        created_projects = 0
        created_members = 0
        created_stack = 0

        for spec in PROJECTS:
            proj = Project(
                code=spec["code"],
                name=spec["name"],
                description=spec["description"],
                status=spec["status"],
                started_at=spec["started_at"],
                finished_at=spec["finished_at"],
                created_by=admin.id,
            )
            session.add(proj)
            await session.flush()
            created_projects += 1

            for comp_name, target in spec["stack"]:
                comp = comp_by_name.get(comp_name)
                if comp is None:
                    print(f"!! компетенция не найдена: {comp_name}")
                    continue
                session.add(
                    ProjectCompetency(
                        project_id=proj.id,
                        competency_id=comp.id,
                        target_level=target,
                    )
                )
                created_stack += 1

            # Если проект завершён, проставляем left_at = finished_at для тех,
            # у кого он не задан явно. Так сотрудник честно попадёт в «историю».
            project_left_default = (
                spec["finished_at"] if spec["status"] == "completed" else None
            )
            for entry in spec["members"]:
                if len(entry) == 4:
                    email, role_in_project, joined_at, left_at = entry
                else:
                    email, role_in_project, joined_at = entry  # старый формат
                    left_at = None
                emp = emp_by_email.get(email)
                if emp is None:
                    print(f"!! сотрудник не найден: {email}")
                    continue
                session.add(
                    ProjectMember(
                        project_id=proj.id,
                        employee_id=emp.id,
                        role_in_project=role_in_project,
                        joined_at=joined_at,
                        left_at=left_at or project_left_default,
                    )
                )
                created_members += 1

        await session.commit()

    print("Тестовые проекты загружены:")
    print(f"  проектов:       {created_projects}")
    print(f"  участников:     {created_members}")
    print(f"  стек-связок:    {created_stack}")


if __name__ == "__main__":
    asyncio.run(main())
