"""Демо-вакансии: 3–4 открытые позиции, привязанные к существующим проектам.

Идемпотентно: удаляет ранее загруженные вакансии (по created_by=admin)
и пересоздаёт. Существующие кандидаты получают привязку к первой
подходящей открытой вакансии.

Запуск:  uv run python -m scripts.seed_vacancies
"""

import asyncio
import sys

from sqlalchemy import delete, select, update

from app.db import SessionLocal
from app.models.candidate import CandidateProfile
from app.models.department import Department
from app.models.employee import Employee
from app.models.mpk import Grade, Role
from app.models.project import Project
from app.models.user import User
from app.models.vacancy import Vacancy

ADMIN_EMAIL = "admin@example.com"


REQUIREMENTS_PYTHON_SENIOR = """## Что мы ищем

**Позиция:** Senior Backend Python — Уберизация НТЦ

## Принцип отбора

**Сильный инженер > узкоспециальное соответствие.** Кандидат может не иметь опыта с конкретным фреймворком из нашего стека (FastAPI, asyncpg, Alembic) — это не блокер. Главное — глубина мышления, способность быстро разобраться в новом, инженерный кругозор и зрелость.

## Целевой профиль

- **L4** · Программирование (асинхронность, чистая архитектура)
- **L4** · Базы данных (Postgres, оптимизация запросов, схемы)
- **L3** · Автоматизация обновлений (CI/CD)
- **L3** · Системы контроля версий (git-flow, code review)
- **L3** · Управление качеством (тестирование на разных уровнях)

## Стек проекта (плюс, не требование)

- Python 3.11+, FastAPI / asyncpg
- PostgreSQL 16, Redis
- Docker, GitLab CI

## Soft-skills

- Самостоятельность, способность ставить себе задачу
- Коммуникабельность, готовность к парной работе
- Умение читать чужой код и оставлять понятные ревью
"""


REQUIREMENTS_FRONTEND_MIDDLE = """## Что мы ищем

**Позиция:** Middle Frontend — Гибридная информационно-моделирующая архитектура

## Принцип отбора

**Сильный инженер > узкоспециальное соответствие.** Опыт с React или с Angular — не важно. Главное — понимание того, как работают компоненты, состояние, реактивность, производительность.

## Целевой профиль

- **L3** · Программирование (TypeScript / JavaScript)
- **L4** · Разработка Front (React, Angular или Qt)
- **L3** · Системы контроля версий
- **L2** · Управление качеством

## Стек проекта (плюс, не требование)

- React 18 / TypeScript
- Redux Toolkit, React Query
- Vite, Vitest

## Soft-skills

- UX-вкус и внимание к деталям
- Способность спорить аргументами на code review
- Готовность работать с дизайнером и бэкендом
"""


REQUIREMENTS_QA_LEAD = """## Что мы ищем

**Позиция:** Lead QA — Автоматизация регресса

## Принцип отбора

**Сильный инженер с QA-mindset.** Конкретный инструмент (Cypress, Playwright, pytest, Selenium) — не важно. Важна способность строить стратегию тестирования, читать код продукта, видеть риски.

## Целевой профиль

- **L4** · Управление тестированием
- **L4** · Авто-тестирование
- **L3** · Управление качеством

## Стек проекта (плюс, не требование)

- Pytest + Allure
- Cypress / Playwright
- GitLab CI, Docker

## Soft-skills

- Стратегическое мышление
- Способность аргументированно отказывать релизам
- Опыт работы с разработчиками без конфронтации
"""


REQUIREMENTS_ANALYST = """## Что мы ищем

**Позиция:** Системный аналитик — практика SA / UX

## Принцип отбора

**Сильный аналитик > знание конкретной нотации.** Опыт с C4, UML или просто Mermaid — не важно. Главное — умение задавать правильные вопросы, видеть бизнес-процесс целиком и переводить его в техническое задание.

## Целевой профиль

- **L4** · Системный анализ
- **L3** · Анализ интеграционных решений
- **L3** · Разработка документации для релиза

## Soft-skills

- Способность переспрашивать и не бояться «выглядеть глупо»
- Умение фасилитировать встречи между бизнесом и разработкой
- Внимание к структуре документа: чтобы его можно было прочесть подряд
"""


# (project_code, department_name_substr, role_name, grade_code, title, requirements_md, status)
VACANCIES_SPEC = [
    (
        "U230008409",
        None,
        "Backend Python разработчик",
        "Senior",
        "Senior Backend Python — Уберизация НТЦ",
        REQUIREMENTS_PYTHON_SENIOR,
        "open",
    ),
    (
        "U190001633",
        None,
        "Frontend разработчик",
        "Middle",
        "Middle Frontend — ГибрИМА",
        REQUIREMENTS_FRONTEND_MIDDLE,
        "open",
    ),
    (
        "QA-AUTO",
        None,
        "QA Lead",
        "Senior",
        "Lead QA — Автоматизация регресса",
        REQUIREMENTS_QA_LEAD,
        "open",
    ),
    (
        None,
        "системного анализа",  # общий найм на практику SA
        "Системный аналитик",
        "Middle",
        "Системный аналитик — практика SA / UX",
        REQUIREMENTS_ANALYST,
        "open",
    ),
]


async def _get_role(session, name: str) -> Role | None:
    q = await session.execute(select(Role).where(Role.name == name))
    return q.scalar_one_or_none()


async def _get_grade(session, code: str) -> Grade | None:
    q = await session.execute(select(Grade).where(Grade.code == code))
    return q.scalar_one_or_none()


async def main() -> None:
    async with SessionLocal() as session:
        admin = (
            await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        ).scalar_one_or_none()
        if admin is None:
            print(f"!! не найден {ADMIN_EMAIL}", file=sys.stderr)
            sys.exit(1)

        # отвязываем кандидатов от старых вакансий и удаляем старые
        await session.execute(update(CandidateProfile).values(vacancy_id=None))
        await session.execute(delete(Vacancy))
        await session.commit()

        created: list[Vacancy] = []
        for (
            project_code,
            dept_substr,
            role_name,
            grade_code,
            title,
            req_md,
            status,
        ) in VACANCIES_SPEC:
            project_id = None
            department_id = None
            if project_code is not None:
                pq = await session.execute(select(Project).where(Project.code == project_code))
                proj = pq.scalar_one_or_none()
                if proj is None:
                    print(f"!! проект {project_code} не найден — пропускаю '{title}'")
                    continue
                project_id = proj.id
            elif dept_substr is not None:
                dq = await session.execute(
                    select(Department).where(Department.name.ilike(f"%{dept_substr}%"))
                )
                dept = dq.scalar_one_or_none()
                if dept is None:
                    print(f"!! отдел '{dept_substr}' не найден — пропускаю '{title}'")
                    continue
                department_id = dept.id

            role = await _get_role(session, role_name)
            grade = await _get_grade(session, grade_code)

            v = Vacancy(
                title=title,
                project_id=project_id,
                department_id=department_id,
                role_id=role.id if role else None,
                grade_id=grade.id if grade else None,
                requirements_md=req_md.strip(),
                status=status,
                created_by_id=admin.id,
            )
            session.add(v)
            await session.flush()
            created.append(v)
            target = project_code or f"dept {dept_substr}" or "—"
            print(f"  + {title}  (role={role_name}/{grade_code}, target={target})")

        # Привязываем существующих демо-кандидатов к первой подходящей открытой вакансии
        # Тут эвристика для seed-данных: candidate с position 'Backend Python' → Python-vacancy и т.п.
        cands_q = await session.execute(
            select(CandidateProfile, Employee)
            .join(Employee, Employee.id == CandidateProfile.employee_id)
            .where(Employee.kind == "candidate")
        )
        rows = list(cands_q.all())
        attached = 0
        for prof, emp in rows:
            position = (emp.position or "").lower()
            for v in created:
                tlow = v.title.lower()
                if "python" in tlow and "python" in position:
                    prof.vacancy_id = v.id
                    attached += 1
                    break
                if "frontend" in tlow and "frontend" in position:
                    prof.vacancy_id = v.id
                    attached += 1
                    break
                if "qa" in tlow and "qa" in position:
                    prof.vacancy_id = v.id
                    attached += 1
                    break
                if "анал" in tlow and "анал" in position:
                    prof.vacancy_id = v.id
                    attached += 1
                    break

        await session.commit()

    print(f"\nЗагружено вакансий: {len(created)}")
    print(f"Привязано существующих кандидатов: {attached}")


if __name__ == "__main__":
    asyncio.run(main())
