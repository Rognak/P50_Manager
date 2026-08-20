"""Демо-отделы (практики) и история их опросников техзрелости.

Демо-руководители создаются по необходимости. Кроме того, существующие сотрудники прикрепляются к
соответствующим отделам — чтобы у каждого отдела был «свой» состав.

Идемпотентно:
  • удаляет ранее загруженные отделы и пересоздаёт;
  • переназначает employee.department_id у всех сотрудников.

Запуск:  uv run python -m scripts.seed_departments
"""

import asyncio
import random
import sys
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.engine import CursorResult

from app.core.security import hash_password
from app.db import SessionLocal
from app.department.scoring import load_template
from app.models.department import Department, DeptMaturitySurvey
from app.models.employee import Employee
from app.models.user import User

ADMIN_EMAIL = "admin@example.com"
DEFAULT_PASSWORD = "demo123"

# ---------- сценарии заполнения уровней ----------
# Каждый кортеж — доля выполнения по уровням 1..5; список — от старого к новому.

SCENARIO_MATURE = [
    (0.95, 0.85, 0.55, 0.20, 0.00),
    (1.00, 0.90, 0.65, 0.30, 0.05),
    (1.00, 0.95, 0.75, 0.45, 0.15),
    (1.00, 1.00, 0.85, 0.55, 0.25),
]
SCENARIO_GROWING = [
    (0.75, 0.45, 0.15, 0.00, 0.00),
    (0.85, 0.60, 0.25, 0.05, 0.00),
    (0.95, 0.75, 0.40, 0.15, 0.00),
    (1.00, 0.85, 0.55, 0.25, 0.05),
]
SCENARIO_NEW = [
    (0.50, 0.20, 0.00, 0.00, 0.00),
    (0.70, 0.35, 0.10, 0.00, 0.00),
    (0.85, 0.55, 0.20, 0.00, 0.00),
]
SCENARIO_STUCK = [
    (0.65, 0.30, 0.05, 0.00, 0.00),
    (0.70, 0.35, 0.10, 0.00, 0.00),
    (0.75, 0.40, 0.10, 0.05, 0.00),
    (0.80, 0.45, 0.15, 0.05, 0.00),
]

DIRECTION_CODES = ["CON", "STU", "SKI", "IMP", "ROT", "SOR", "MET"]


# ---------- спецификация практик ----------
# `assign_owner_emails` — список email'ов *менеджеров*, ВСЕ сотрудники которых
# попадут в этот отдел. Это позволяет переиспользовать имеющихся seeds-юзеров
# и при этом отображать в UI «свой» состав у каждого отдела.

DEPARTMENTS: list[dict] = [
    {
        "name": "Практика backend-разработки Python",
        "description": "Backend-сервисы на Python: НТЦ-сервисы, аналитика, интеграции.",
        "owner_email": ADMIN_EMAIL,
        "owner_full_name": "Демо Руководитель 1",
        "scenario": SCENARIO_GROWING,
        "profile": {
            "CON": 1.0,
            "STU": 1.05,
            "SKI": 1.05,
            "IMP": 1.0,
            "ROT": 0.85,
            "SOR": 0.95,
            "MET": 1.10,
        },
        "assign_owner_emails": [ADMIN_EMAIL],
    },
    {
        "name": "Практика сборки, тестирования и развертывания ПО",
        "description": "Управление качеством, авто-тестирование и платформа CI/CD.",
        "owner_email": "lead_qa@demo.local",
        "owner_full_name": None,  # уже создан в seed_other_managers
        "scenario": SCENARIO_MATURE,
        "profile": {
            "CON": 1.20,
            "STU": 0.90,
            "SKI": 1.0,
            "IMP": 0.90,
            "ROT": 0.80,
            "SOR": 0.75,
            "MET": 1.20,
        },
        "assign_owner_emails": ["lead_qa@demo.local"],
    },
    {
        "name": "Практика backend-разработки",
        "description": "Backend на Java/C# и смежные направления (Mobile-backend, аналитика).",
        "owner_email": "lead_mobile@demo.local",
        "owner_full_name": None,
        "scenario": SCENARIO_NEW,
        "profile": {
            "CON": 0.85,
            "STU": 1.20,
            "SKI": 1.10,
            "IMP": 1.0,
            "ROT": 0.65,
            "SOR": 0.80,
            "MET": 0.85,
        },
        "assign_owner_emails": ["lead_mobile@demo.local"],
    },
    {
        "name": "Практика frontend-разработки",
        "description": "Web-портал, UI-компоненты, React/Angular/Qt.",
        "owner_email": "lead_frontend@demo.local",
        "owner_full_name": "Демо Руководитель 2",
        "scenario": SCENARIO_GROWING,
        "profile": {
            "CON": 0.95,
            "STU": 1.0,
            "SKI": 1.15,
            "IMP": 1.05,
            "ROT": 0.95,
            "SOR": 0.75,
            "MET": 0.95,
        },
        "assign_owner_emails": [],
    },
    {
        "name": "Практика системного анализа и UX/UI-проектирования",
        "description": "Системный анализ, требования, UX/UI-проектирование.",
        "owner_email": "lead_sa@demo.local",
        "owner_full_name": "Демо Руководитель 3",
        "scenario": SCENARIO_STUCK,
        "profile": {
            "CON": 1.05,
            "STU": 1.0,
            "SKI": 1.0,
            "IMP": 1.10,
            "ROT": 0.85,
            "SOR": 0.90,
            "MET": 1.0,
        },
        "assign_owner_emails": [],
    },
]


def _quarter_label(year: int, q: int) -> str:
    return f"{year}-Q{q}"


def _periods_back(today: date, count: int) -> list[str]:
    cur_q = (today.month - 1) // 3 + 1
    cur_y = today.year
    out: list[str] = []
    for offset in range(count - 1, -1, -1):
        q = cur_q - offset
        y = cur_y
        while q <= 0:
            q += 4
            y -= 1
        out.append(_quarter_label(y, q))
    return out


def _completed_at_for(period: str) -> datetime:
    y, q = period.split("-Q")
    end_month = int(q) * 3
    end_year = int(y)
    if end_month == 12:
        end = date(end_year, 12, 31)
    else:
        next_month = date(end_year, end_month + 1, 1)
        end = next_month - timedelta(days=1)
    return datetime(end.year, end.month, end.day, 18, 0, tzinfo=UTC)


def _build_answers(
    template: dict,
    level_fractions: tuple[float, ...],
    direction_profile: dict[str, float],
) -> dict[str, str]:
    """Заполняем ответы на уровне процесс×уровень×критерий.
    `level_fractions[i]` — целевая средняя доля 'yes' на уровне i+1
    (по всем процессам и критериям этого уровня) до применения direction-multiplier.
    """
    answers: dict[str, str] = {}
    for d in template["directions"]:
        dcode = d["code"]
        mul = direction_profile.get(dcode, 1.0)
        for proc in d["processes"]:
            pcode = proc["code"]
            for c in template["criteria"]:
                lvl = c["level"]
                base = level_fractions[lvl - 1] if lvl - 1 < len(level_fractions) else 0.0
                p_yes = max(0.0, min(1.0, base * mul))
                # Bernoulli — реалистичнее, чем фиксированная доля
                v = "yes" if random.random() < p_yes else "no"
                answers[f"{pcode}-{lvl}-{c['idx']}"] = v
    return answers


async def _ensure_user(session, email: str, full_name: str | None) -> User:
    """Найти/создать пользователя. Возвращает существующего если есть; если
    `full_name` задано — обновляет поле."""
    u = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if u is None:
        u = User(
            email=email,
            full_name=full_name or email.split("@")[0],
            password_hash=hash_password(DEFAULT_PASSWORD),
        )
        session.add(u)
        await session.flush()
        print(f"  + создан руководитель {email} ({u.full_name})")
    elif full_name and u.full_name != full_name:
        u.full_name = full_name
        await session.flush()
    return u


async def main() -> None:
    random.seed(11)
    template = load_template()
    today = date.today()

    async with SessionLocal() as session:
        admin = (
            await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        ).scalar_one_or_none()
        if admin is None:
            print(f"!! не найден {ADMIN_EMAIL} — сначала seed_admin", file=sys.stderr)
            sys.exit(1)
        if admin.full_name != "Демо Руководитель 1":
            admin.full_name = "Демо Руководитель 1"
            await session.flush()

        # очистка
        await session.execute(update(Employee).values(department_id=None))
        await session.execute(delete(DeptMaturitySurvey))
        await session.execute(delete(Department))
        await session.commit()

        n_dept = 0
        n_surveys = 0
        n_assigned = 0
        for spec in DEPARTMENTS:
            owner = await _ensure_user(session, spec["owner_email"], spec["owner_full_name"])
            d = Department(
                name=spec["name"],
                description=spec["description"],
                owner_id=owner.id,
            )
            session.add(d)
            await session.flush()
            n_dept += 1

            # переназначаем сотрудников указанных менеджеров
            for owner_email in spec["assign_owner_emails"]:
                u = (
                    await session.execute(select(User).where(User.email == owner_email))
                ).scalar_one_or_none()
                if u is None:
                    continue
                upd = await session.execute(
                    update(Employee)
                    .where(Employee.owner_id == u.id, Employee.kind == "employee")
                    .values(department_id=d.id)
                )
                if not isinstance(upd, CursorResult):
                    raise RuntimeError("Ожидался CursorResult при назначении отдела")
                n_assigned += upd.rowcount or 0

            scenario = spec["scenario"]
            periods = _periods_back(today, len(scenario))
            for period, level_fracs in zip(periods, scenario):
                ans = _build_answers(template, level_fracs, spec["profile"])
                is_current = period == periods[-1]
                completed = None if is_current else _completed_at_for(period)
                rv = DeptMaturitySurvey(
                    department_id=d.id,
                    period=period,
                    status="draft" if is_current else "done",
                    template_version=template["version"],
                    info={
                        "department_name": d.name,
                        "period": period,
                        "version": template["version"],
                    },
                    answers=ans,
                    completed_at=completed,
                    created_by=owner.id,
                )
                session.add(rv)
                n_surveys += 1

        await session.commit()

    print("\nТестовые отделы загружены:")
    print(f"  отделов:                {n_dept}")
    print(f"  опросников:             {n_surveys}")
    print(f"  сотрудников привязано:  {n_assigned}")
    for spec in DEPARTMENTS:
        print(
            f"  - {spec['name']:55s} : {len(spec['scenario'])} периодов "
            f"(owner={spec['owner_email']})"
        )


if __name__ == "__main__":
    asyncio.run(main())
