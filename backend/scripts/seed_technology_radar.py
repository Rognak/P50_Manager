"""Идемпотентные demo-данные для Technology Radar.

Запуск: uv run python -m scripts.seed_technology_radar
"""
import asyncio
from datetime import date, timedelta

from sqlalchemy import select

from app.db import SessionLocal
from app.models.employee import Employee
from app.models.project import Product
from app.models.technology import (
    Technology,
    TechnologyCategory,
    TechnologyDecision,
    TechnologyLink,
    TechnologyMember,
    TechnologyProduct,
)
from app.models.user import User

TECHNOLOGIES = [
    ("development", "C#", "adopt", "Основной язык для ряда production-систем."),
    ("development", "Python", "adopt", "Используется для backend-сервисов и автоматизации."),
    ("development", "TypeScript", "adopt", "Базовый язык frontend-разработки."),
    ("development", "Delphi", "hold", "Сохраняется только в legacy-решениях."),
    ("data", "PostgreSQL", "adopt", "Основная реляционная СУБД."),
    ("data", "Redis", "trial", "Апробируется для кэшей и оперативных данных."),
    ("data", "Kafka", "adopt", "Платформа событийной интеграции."),
    ("data", "Oracle", "hold", "Новые внедрения не рекомендуются."),
    ("infrastructure", "Docker", "adopt", "Стандарт упаковки приложений."),
    ("infrastructure", "DeckHouse", "adopt", "Платформа управления Kubernetes."),
    ("infrastructure", "OpenShift", "trial", "Оценивается в отдельных контурах."),
    ("frameworks_tools", "FastAPI", "adopt", "Стандарт для новых Python API."),
    ("frameworks_tools", "ReactJS", "adopt", "Основной frontend-фреймворк."),
    ("frameworks_tools", "Flask", "hold", "Для новых сервисов выбран FastAPI."),
    ("methods_practices", "Architecture as Code", "trial", "Практика проходит пилотирование."),
    ("methods_practices", "Архитектурные шаблоны C4", "assess", "Формируется единый подход к описанию архитектуры."),
    ("methods_practices", "Docs as Code", "adopt", "Документация хранится и ревьюится вместе с кодом."),
]


async def main() -> None:
    async with SessionLocal() as session:
        user = (await session.execute(
            select(User).where(User.is_admin.is_(True)).order_by(User.id)
        )).scalars().first()
        if user is None:
            user = (await session.execute(select(User).order_by(User.id))).scalars().first()
        if user is None:
            print("Нет пользователей: сначала выполните seed-admin")
            return
        categories = {c.code: c for c in (await session.execute(select(TechnologyCategory))).scalars()}
        existing = {t.name: t for t in (await session.execute(select(Technology))).scalars()}
        created = 0
        for code, name, technology_status, reason in TECHNOLOGIES:
            category = categories.get(code)
            if category is None:
                continue
            technology = existing.get(name)
            if technology is None:
                technology = Technology(
                    category_id=category.id, name=name, status=technology_status,
                    status_reason_md=reason,
                    description_md=f"Демонстрационная запись для **{name}**.",
                    next_review_at=date.today() + timedelta(days=180),
                    created_by=user.id, updated_by=user.id,
                )
                session.add(technology)
                await session.flush()
                session.add(TechnologyDecision(
                    technology_id=technology.id, event_kind="created",
                    to_status=technology_status, summary_md=reason,
                    next_review_at=technology.next_review_at, created_by=user.id,
                ))
                existing[name] = technology
                created += 1
            else:
                technology.category_id = category.id
                technology.is_active = True

        products = list((await session.execute(
            select(Product).order_by(Product.id).limit(4)
        )).scalars())
        if products:
            for index, name in enumerate(("PostgreSQL", "TypeScript", "Docker", "FastAPI")):
                technology = existing.get(name)
                if technology and await session.get(TechnologyProduct, (technology.id, products[index % len(products)].id)) is None:
                    session.add(TechnologyProduct(
                        technology_id=technology.id,
                        product_id=products[index % len(products)].id,
                        usage_type="production", created_by=user.id,
                    ))
            hold = existing.get("Delphi")
            active_product = next((p for p in products if p.status == "active"), None)
            if hold and active_product and await session.get(TechnologyProduct, (hold.id, active_product.id)) is None:
                session.add(TechnologyProduct(
                    technology_id=hold.id, product_id=active_product.id,
                    usage_type="legacy", notes="Демо technology debt",
                    created_by=user.id,
                ))

        employees = list((await session.execute(
            select(Employee).where(Employee.kind == "employee", Employee.left_at.is_(None))
            .order_by(Employee.id).limit(6)
        )).scalars())
        expert_names = ["PostgreSQL", "TypeScript", "Docker", "FastAPI", "Kafka"]
        for index, name in enumerate(expert_names):
            technology = existing.get(name)
            if technology and employees:
                employee = employees[index % len(employees)]
                duplicate = (await session.execute(select(TechnologyMember).where(
                    TechnologyMember.technology_id == technology.id,
                    TechnologyMember.employee_id == employee.id,
                ))).scalar_one_or_none()
                if duplicate is None:
                    session.add(TechnologyMember(
                        technology_id=technology.id, employee_id=employee.id,
                        role="leader" if index == 0 else "expert",
                        source="manual", notes="Демонстрационное назначение",
                        created_by=user.id,
                    ))
        practitioner_names = ["Python", "C#", "ReactJS", "Redis", "Docs as Code"]
        for index, name in enumerate(practitioner_names):
            technology = existing.get(name)
            if technology and employees:
                employee = employees[(index + 2) % len(employees)]
                duplicate = (
                    await session.execute(
                        select(TechnologyMember).where(
                            TechnologyMember.technology_id == technology.id,
                            TechnologyMember.employee_id == employee.id,
                        )
                    )
                ).scalar_one_or_none()
                if duplicate is None:
                    session.add(
                        TechnologyMember(
                            technology_id=technology.id,
                            employee_id=employee.id,
                            role="practitioner",
                            source="manual",
                            notes="Демонстрационный носитель технологии",
                            created_by=user.id,
                        )
                    )

        fastapi = existing.get("FastAPI")
        if fastapi:
            link = (await session.execute(select(TechnologyLink).where(
                TechnologyLink.technology_id == fastapi.id,
                TechnologyLink.url == "https://fastapi.tiangolo.com/",
            ))).scalar_one_or_none()
            if link is None:
                session.add(TechnologyLink(
                    technology_id=fastapi.id, kind="documentation",
                    title="Документация FastAPI", url="https://fastapi.tiangolo.com/",
                    created_by=user.id,
                ))
        await session.commit()
        print(f"Technology Radar: создано {created}, всего demo-технологий {len(TECHNOLOGIES)}")


if __name__ == "__main__":
    asyncio.run(main())
