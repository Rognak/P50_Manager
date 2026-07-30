"""Демо-данные Self-Review для сотрудников админа.

Создаёт ревью за 2026 (текущий) у всех в разных статусах, и за 2025 у части
сотрудников (`closed` с заметками руководителя). У оставшихся — только 2026
(имитация недавно нанятых).

Идемпотентно: удаляет существующие ревью админа перед заливкой.

Запуск:
    uv run python -m scripts.seed_self_reviews
"""
import asyncio
import random
from datetime import UTC, datetime, timedelta
from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.employee import Employee
from app.models.self_review import SelfReview
from app.models.user import User
ADMIN_EMAIL = "admin@example.com"

CLOSED_NOTES_2025 = [
    "Сильный год: уверенно вытянул(а) сложный legacy-рефакторинг. План на 26 — больше менторства.",
    "Несколько раз сорванных сроков, но в итоге восстановил(а)сь. Поработать над оценкой задач.",
    "Хорошая команда, стабильный вклад. Готовится к Senior+ во второй половине года.",
    "Уверенный рост по архитектурной части. Обсудили запрос на System Design курс.",
    "Перегруз во втором полугодии — договорились о буфере на квартал и о делегировании.",
    None,
    None,
]

CLOSED_NOTES_2026 = [
    "Цели согласованы, план развития подписан.",
    "Зафиксировали договорённость о смене проекта в Q3.",
    "Согласовали старт менторства новых сотрудников.",
]

SUBMITTED_NOTES_2026 = [
    None,
    "Обсудить плановый старт нового проекта.",
    "Посмотреть на расхождения с МПК-уровнями перед 1:1.",
    "Запросил курс по System Design — согласовать с HR.",
]


async def main() -> None:
    random.seed(42)
    today = datetime.now(UTC)

    async with SessionLocal() as session:
        admin_q = await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        admin = admin_q.scalar_one_or_none()
        if admin is None:
            print(f"!! не найден {ADMIN_EMAIL} — сначала seed-admin")
            return

        emps_q = await session.execute(
            select(Employee).where(Employee.owner_id == admin.id).order_by(Employee.id)
        )
        emps = list(emps_q.scalars())
        if not emps:
            print("!! у админа нет сотрудников — сначала seed-demo")
            return

        # очистка предыдущих ревью этих сотрудников
        await session.execute(
            delete(SelfReview).where(SelfReview.employee_id.in_([e.id for e in emps]))
        )
        await session.commit()

        n_2025 = 0
        n_2026 = 0

        # детерминированный пропуск 2025 у ~30% сотрудников
        # (например, недавно нанятые, прошлый год не оценивался)
        skip_2025_idx = {i for i in range(len(emps)) if i % 4 == 1}

        for i, emp in enumerate(emps):
            has_2025 = i not in skip_2025_idx
            if has_2025:
                rv25 = SelfReview(
                    employee_id=emp.id,
                    year=2025,
                    status="closed",
                    project_score=random.randint(6, 9),
                    company_score=random.randint(5, 9),
                    manager_notes_md=random.choice(CLOSED_NOTES_2025),
                    submitted_at=today - timedelta(days=random.randint(70, 220)),
                    closed_at=today - timedelta(days=random.randint(50, 180)),
                    created_by=admin.id,
                )
                session.add(rv25)
                n_2025 += 1

            # ----- 2026 (текущий) у всех -----
            r = random.random()
            if r < 0.3:
                status_26 = "draft"
                proj, comp = None, None
                submitted_at, closed_at = None, None
                notes = None
            elif r < 0.8:
                status_26 = "submitted"
                proj = random.randint(6, 9)
                comp = random.randint(5, 9)
                submitted_at = today - timedelta(days=random.randint(2, 30))
                closed_at = None
                notes = random.choice(SUBMITTED_NOTES_2026)
            else:
                status_26 = "closed"
                proj = random.randint(7, 10)
                comp = random.randint(6, 9)
                submitted_at = today - timedelta(days=random.randint(15, 40))
                closed_at = today - timedelta(days=random.randint(1, 14))
                notes = random.choice(CLOSED_NOTES_2026)

            kwargs = dict(
                employee_id=emp.id,
                year=2026,
                status=status_26,
                project_score=proj,
                company_score=comp,
                manager_notes_md=notes,
                submitted_at=submitted_at,
                closed_at=closed_at,
                created_by=admin.id,
            )

            session.add(SelfReview(**kwargs))
            n_2026 += 1

        await session.commit()

    print("Self-Review демо-данные загружены:")
    print(f"  ревью за 2025:  {n_2025} (closed, с заметками)")
    print(f"  ревью за 2026:  {n_2026} (микс draft/submitted/closed)")
    print(f"  без 2025:       {len(emps) - n_2025} сотрудников (только текущий год)")


if __name__ == "__main__":
    asyncio.run(main())
