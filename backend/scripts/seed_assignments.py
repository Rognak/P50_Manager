"""Демо-поручения с разными статусами и адресатами.

Покрывает основные сценарии:
  • CoreTeam → руководитель отдела (наиболее частый кейс)
  • CoreTeam → конкретный сотрудник
  • Руководитель отдела → свой сотрудник
  • Руководитель отдела → коллега-руководитель

Покрытые статусы: open, in_progress, pending_review (для проверки кнопок
подтверждения), done, cancelled. Просрочка / приближающийся срок — в датах.

Идемпотентно: удаляет ВСЕ существующие поручения и создаёт заново.

Запуск:  uv run python -m scripts.seed_assignments
"""
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from typing import Optional

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.assignment import Assignment
from app.models.employee import Employee
from app.models.user import User


def _at(days: int, hour: int = 18) -> datetime:
    """Дата сегодня + days, в указанный час UTC."""
    return datetime.now(UTC).replace(
        hour=hour, minute=0, second=0, microsecond=0
    ) + timedelta(days=days)


async def _user(session, email: str) -> Optional[User]:
    return (
        await session.execute(select(User).where(User.email == email))
    ).scalar_one_or_none()


async def _employee(session, email: str) -> Optional[Employee]:
    return (
        await session.execute(
            select(Employee).where(Employee.email == email)
        )
    ).scalar_one_or_none()


def _assignment(
    *,
    title: str,
    description: str,
    creator: User,
    due_at: Optional[datetime],
    status: str,
    assignee_user: Optional[User] = None,
    assignee_employee: Optional[Employee] = None,
    completed_at: Optional[datetime] = None,
) -> Assignment:
    return Assignment(
        title=title,
        description_md=description,
        due_at=due_at,
        status=status,
        created_by_id=creator.id,
        assignee_user_id=assignee_user.id if assignee_user else None,
        assignee_employee_id=assignee_employee.id if assignee_employee else None,
        completed_at=completed_at,
    )


async def main() -> None:
    async with SessionLocal() as session:
        # — Подгружаем ключевых пользователей и сотрудников из ранее загруженных сидов
        admin = await _user(session, "admin@example.com")
        ct = await _user(session, "coreteam@demo.local")
        lead_qa = await _user(session, "lead_qa@demo.local")
        lead_mobile = await _user(session, "lead_mobile@demo.local")
        lead_frontend = await _user(session, "lead_frontend@demo.local")
        lead_sa = await _user(session, "lead_sa@demo.local")
        pm = await _user(session, "pm@demo.local")

        if not all([admin, ct, lead_qa, lead_mobile]):
            print(
                "!! отсутствуют ключевые пользователи "
                "(admin/coreteam/lead_qa/lead_mobile) — сначала seed_admin + seed_others + seed_roles",
                file=sys.stderr,
            )
            sys.exit(1)

        # сотрудники admin (Python-практика)
        ivanov = await _employee(session, "ivanov@demo.local")
        kuznetsov = await _employee(session, "kuznetsov@demo.local")
        sidorov = await _employee(session, "sidorov@demo.local")
        novikov = await _employee(session, "novikov@demo.local")
        # сотрудники lead_qa
        zaharova = await _employee(session, "zaharova@demo.local")
        grigoriev = await _employee(session, "grigoriev@demo.local")
        # сотрудник lead_mobile
        belyaev = await _employee(session, "belyaev@demo.local")

        # очистка
        await session.execute(delete(Assignment))
        await session.commit()

        items: list[Assignment] = []

        # ----- CoreTeam → руководители (наиболее типичный сценарий) -----
        items.append(
            _assignment(
                title="Подготовить квартальный отчёт по Python-практике",
                description=(
                    "Нужны:\n"
                    "- агрегаты по тех.зрелости (рейтинг + динамика)\n"
                    "- статистика по найму и ротациям\n"
                    "- список ключевых сотрудников и факторов риска\n\n"
                    "Формат — DOCX. Шаблон в общем диске."
                ),
                creator=ct,
                due_at=_at(7),
                status="open",
                assignee_user=admin,
            )
        )
        items.append(
            _assignment(
                title="Согласовать план обучения QA-практики на 2026",
                description="Список тем митапов, бюджет на конференции, "
                "целевая структура компетенций.",
                creator=ct,
                due_at=_at(3),
                status="in_progress",
                assignee_user=lead_qa,
            )
        )
        items.append(
            _assignment(
                title="Разработать методику оценки junior-разработчиков",
                description="По итогу — методика, опубликованная в Confluence, "
                "и пилотное применение на 2-3 сотрудниках.",
                creator=ct,
                due_at=_at(-2),  # просрочено
                status="in_progress",
                assignee_user=lead_frontend,
            )
        )
        items.append(
            _assignment(
                title="Внедрить процесс еженедельных технических ревью",
                description="Шаблон агенды, регламент, первая встреча проведена.",
                creator=ct,
                due_at=_at(-5),
                status="pending_review",  # ждёт подтверждения
                assignee_user=lead_sa,
            )
        )
        items.append(
            _assignment(
                title="Провести аудит критичных компонентов",
                description="Список компонентов с bus-factor=1, план митигации.",
                creator=ct,
                due_at=_at(-30),
                status="done",
                assignee_user=lead_mobile,
                completed_at=_at(-25, hour=11),
            )
        )

        # ----- Admin (Python lead) → свои сотрудники -----
        if ivanov:
            items.append(
                _assignment(
                    title="Подготовить тех.дизайн нового модуля сервиса",
                    description="ADR + диаграммы C4, согласовать с архитектором.",
                    creator=admin,
                    due_at=_at(5),
                    status="in_progress",
                    assignee_employee=ivanov,
                )
            )
        if kuznetsov:
            items.append(
                _assignment(
                    title="Провести 1:1 с командой по итогам Self-Review",
                    description="С каждым тимлидом — 30 мин, обсудить итоги ревью.",
                    creator=admin,
                    due_at=_at(10),
                    status="open",
                    assignee_employee=kuznetsov,
                )
            )
        if sidorov:
            items.append(
                _assignment(
                    title="Обновить onboarding-плейбук для нового DevOps",
                    description="Чек-лист первой недели + контакты + список систем.",
                    creator=admin,
                    due_at=_at(-1),
                    status="pending_review",
                    assignee_employee=sidorov,
                )
            )
        if novikov:
            items.append(
                _assignment(
                    title="Закрыть техдолг по логированию",
                    description="Привести логи к structured-формату, "
                    "добавить request_id в трейсинг.",
                    creator=admin,
                    due_at=_at(-15),
                    status="done",
                    assignee_employee=novikov,
                    completed_at=_at(-10, hour=14),
                )
            )

        # ----- lead_qa → своему сотруднику -----
        if zaharova:
            items.append(
                _assignment(
                    title="Покрыть автотестами регрессионный сценарий №42",
                    description="Сценарий описан в Jira QA-1024.",
                    creator=lead_qa,
                    due_at=_at(4),
                    status="in_progress",
                    assignee_employee=zaharova,
                )
            )
        if grigoriev:
            items.append(
                _assignment(
                    title="Подготовить выступление на митапе по Cypress",
                    description="20 минут, кейс из реальной практики.",
                    creator=lead_qa,
                    due_at=_at(14),
                    status="open",
                    assignee_employee=grigoriev,
                )
            )

        # ----- lead_mobile → своему сотруднику -----
        if belyaev:
            items.append(
                _assignment(
                    title="Перевести iOS-клиент на новый SDK аналитики",
                    description="Оценить трудозатраты, обновить Sentry-интеграцию.",
                    creator=lead_mobile,
                    due_at=_at(20),
                    status="open",
                    assignee_employee=belyaev,
                )
            )

        # ----- Руководитель → коллега-руководитель -----
        items.append(
            _assignment(
                title="Передать сотрудника на ротацию в QA",
                description="Согласовать кандидата для участия в QA-AUTO в Q3.",
                creator=admin,
                due_at=_at(7),
                status="open",
                assignee_user=lead_qa,
            )
        )

        # ----- Отменённое (для полноты) -----
        if ivanov:
            items.append(
                _assignment(
                    title="Подготовить демо для конференции (отменено)",
                    description="Заменили на доклад другого спикера.",
                    creator=admin,
                    due_at=_at(-50),
                    status="cancelled",
                    assignee_employee=ivanov,
                )
            )

        # ----- Поручение от CoreTeam напрямую сотруднику -----
        if kuznetsov:
            items.append(
                _assignment(
                    title="Поделиться лучшими практиками наставничества",
                    description="Короткая заметка/чек-лист для интернал-блога.",
                    creator=ct,
                    due_at=_at(30),
                    status="open",
                    assignee_employee=kuznetsov,
                )
            )

        # — добавляем PM-руководителю
        if pm:
            items.append(
                _assignment(
                    title="Согласовать план релиза на Q2",
                    description="С учётом ёмкости бэкенд-команды.",
                    creator=ct,
                    due_at=_at(2),
                    status="in_progress",
                    assignee_user=pm,
                )
            )

        for a in items:
            session.add(a)
        await session.commit()

    print(f"Загружено демо-поручений: {len(items)}")
    by_status: dict[str, int] = {}
    for a in items:
        by_status[a.status] = by_status.get(a.status, 0) + 1
    for s, n in sorted(by_status.items()):
        print(f"  {s:18s}: {n}")


if __name__ == "__main__":
    asyncio.run(main())
