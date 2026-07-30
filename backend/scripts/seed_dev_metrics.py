"""Сид mock-данных по dev-метрикам.

Для каждого активного сотрудника генерирует:
  • DevMetricsSnapshot на последние 90 дней
  • 5..20 PullRequest-ов (распределённых по его проектам)
  • ExtractedCompetency-записи на 4..7 компетенций (с привязкой к PR-ам)

Идемпотентно: чистит существующие записи и пересоздаёт.

Запуск:  uv run python -m scripts.seed_dev_metrics
"""
from __future__ import annotations

import asyncio
import random
import sys
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models.dev_metrics import (
    DevMetricsSnapshot,
    ExtractedCompetency,
    PullRequest,
)
from app.models.employee import Employee
from app.models.mpk import Competency, role_key_competencies
from app.models.project import Project, ProjectMember
from app.models.user import User

ADMIN_EMAIL = "admin@example.com"


# Шаблоны заголовков PR по типам — добавляют реалистичности.
PR_TITLE_TEMPLATES: list[tuple[str, list[str]]] = [
    (
        "feat",
        [
            "Добавить ручку POST /{resource}",
            "Реализовать экспорт {resource} в Excel",
            "Поддержать новые поля в /{resource}",
            "Кэш для часто запрашиваемых {resource}",
            "AI-задача для генерации {resource}",
            "Новая вкладка «{resource}» в карточке сотрудника",
        ],
    ),
    (
        "fix",
        [
            "Поправить N+1 на /{resource}/list",
            "Не падать на пустом {resource}",
            "Исправить округление gap-score",
            "Корректно SET NULL при удалении {resource}",
            "Дедуп уведомлений по {resource}",
        ],
    ),
    (
        "refactor",
        [
            "Вынести _build_{resource}_context в отдельный модуль",
            "Перевести {resource} на Pydantic v2",
            "Убрать дубликаты в queries {resource}",
            "Async session вместо sync для {resource}",
        ],
    ),
    (
        "test",
        [
            "Покрыть тестами {resource}-flow",
            "Интеграционные тесты для {resource}",
            "Регрессионные тесты после фикса {resource}",
        ],
    ),
    (
        "docs",
        [
            "Документация для {resource}-API",
            "README по {resource}-настройке",
        ],
    ),
]
RESOURCES = [
    "vacancies",
    "candidates",
    "self-review",
    "rotations",
    "projects",
    "employees",
    "mpk-profile",
    "assignments",
    "notifications",
    "departments",
]


def _pick_size_bucket(rnd: random.Random) -> tuple[str, int]:
    """Возвращает (size_bucket, total_changes_approximate)."""
    r = rnd.random()
    if r < 0.25:
        return "XS", rnd.randint(5, 49)
    if r < 0.55:
        return "S", rnd.randint(50, 199)
    if r < 0.80:
        return "M", rnd.randint(200, 499)
    if r < 0.92:
        return "L", rnd.randint(500, 999)
    return "XL", rnd.randint(1000, 2500)


def _mock_signals(
    rnd: random.Random, size_bucket: str, has_tests: bool
) -> dict:
    small = size_bucket in ("XS", "S")
    return {
        "small_size": small,
        "has_description": rnd.random() > 0.2,
        "minimal_rework": rnd.random() > 0.3,
        "has_review_discussion": rnd.random() > 0.25,
        "has_tests": has_tests,
    }


def _quality_ratio(signals: dict) -> float:
    keys = (
        "small_size",
        "has_description",
        "minimal_rework",
        "has_review_discussion",
        "has_tests",
    )
    return round(sum(1 for k in keys if signals.get(k)) / len(keys), 2)


async def _competencies_for_employee(
    session, employee: Employee, all_competencies: list[Competency]
) -> list[Competency]:
    """Подобрать 4..7 компетенций для извлечения.
    Если у сотрудника задана роль — берём её ключевые. Иначе случайные.
    """
    if employee.role_id is None:
        return random.sample(all_competencies, k=min(5, len(all_competencies)))
    q = await session.execute(
        select(Competency)
        .join(role_key_competencies, role_key_competencies.c.competency_id == Competency.id)
        .where(role_key_competencies.c.role_id == employee.role_id)
    )
    keys = list(q.scalars())
    if not keys:
        return random.sample(all_competencies, k=min(5, len(all_competencies)))
    # Берём 4..6 из ключевых + 0..1 неключевую (как бы "расширил кругозор")
    sample = random.sample(keys, k=min(random.randint(4, 6), len(keys)))
    non_key = [c for c in all_competencies if c not in keys]
    if non_key and random.random() > 0.5:
        sample.append(random.choice(non_key))
    return sample


async def main() -> None:
    random.seed(42)

    async with SessionLocal() as session:
        admin = (
            await session.execute(select(User).where(User.email == ADMIN_EMAIL))
        ).scalar_one_or_none()
        if admin is None:
            print(f"!! не найден {ADMIN_EMAIL}", file=sys.stderr)
            sys.exit(1)

        employees = (
            await session.execute(
                select(Employee)
                .where(
                    Employee.kind == "employee",
                    Employee.left_at.is_(None),
                )
                .order_by(Employee.id)
            )
        ).scalars().all()

        all_competencies = (
            await session.execute(select(Competency).order_by(Competency.sort_order))
        ).scalars().all()
        projects = (
            await session.execute(select(Project))
        ).scalars().all()
        project_by_id = {p.id: p for p in projects}

        # Чистим старые данные
        emp_ids = [e.id for e in employees]
        if emp_ids:
            await session.execute(
                delete(ExtractedCompetency).where(
                    ExtractedCompetency.employee_id.in_(emp_ids)
                )
            )
            await session.execute(
                delete(PullRequest).where(PullRequest.employee_id.in_(emp_ids))
            )
            await session.execute(
                delete(DevMetricsSnapshot).where(
                    DevMetricsSnapshot.employee_id.in_(emp_ids)
                )
            )
            await session.commit()

        period_end = date.today()
        period_start = period_end - timedelta(days=90)

        total_prs = 0
        total_snapshots = 0
        total_extracted = 0

        for emp in employees:
            seed_per_emp = random.Random(emp.id * 7919)  # стабильно по сотруднику

            # Проекты этого сотрудника (только активные membership)
            mq = await session.execute(
                select(ProjectMember).where(
                    ProjectMember.employee_id == emp.id,
                    ProjectMember.left_at.is_(None),
                )
            )
            members = list(mq.scalars())
            emp_project_ids = [m.project_id for m in members if m.project_id in project_by_id]
            if not emp_project_ids:
                # Нет проектов — пропустим (нет где «работал»)
                continue

            # 1) PR-ы: 5..20 на сотрудника
            n_prs = seed_per_emp.randint(5, 20)
            prs_created: list[PullRequest] = []
            for i in range(n_prs):
                kind, templates = seed_per_emp.choice(PR_TITLE_TEMPLATES)
                resource = seed_per_emp.choice(RESOURCES)
                title = f"{kind}: {seed_per_emp.choice(templates).format(resource=resource)}"
                size_bucket, total_changes = _pick_size_bucket(seed_per_emp)
                additions = int(total_changes * seed_per_emp.uniform(0.55, 0.85))
                deletions = total_changes - additions
                files_changed = max(1, int(total_changes / seed_per_emp.uniform(30, 120)))
                # ~50% PR-ов содержат тесты
                has_tests = seed_per_emp.random() > 0.5
                tests_changed = (
                    seed_per_emp.randint(1, max(2, files_changed // 3))
                    if has_tests
                    else 0
                )
                signals = _mock_signals(seed_per_emp, size_bucket, has_tests)
                qr = _quality_ratio(signals)
                iterations = seed_per_emp.choices(
                    [1, 2, 3, 4, 5], weights=[40, 30, 15, 10, 5]
                )[0]
                state = seed_per_emp.choices(
                    ["merged", "merged", "merged", "open", "closed"],
                    weights=[60, 15, 10, 10, 5],
                )[0]
                created_days_ago = seed_per_emp.randint(1, 90)
                created_dt = datetime.combine(
                    period_end - timedelta(days=created_days_ago),
                    datetime.min.time(),
                ).replace(tzinfo=UTC)
                merged_dt: datetime | None = None
                ttm: float | None = None
                if state == "merged":
                    ttm_hours = seed_per_emp.uniform(2.0, 96.0)
                    merged_dt = created_dt + timedelta(hours=ttm_hours)
                    ttm = round(ttm_hours, 1)
                project_id = seed_per_emp.choice(emp_project_ids)
                # external_id — синтетический, чтобы был UNIQUE (external_id, project_id)
                ext_id = f"P50-{emp.id}-{i + 1}"
                pr = PullRequest(
                    external_id=ext_id,
                    employee_id=emp.id,
                    project_id=project_id,
                    title=title,
                    url=f"https://example.local/p/{project_id}/-/merge_requests/{i + 1}",
                    state=state,
                    created_at_ext=created_dt,
                    merged_at_ext=merged_dt,
                    additions=additions,
                    deletions=deletions,
                    files_changed=files_changed,
                    tests_changed=tests_changed,
                    size_bucket=size_bucket,
                    iterations=iterations,
                    comments_count=seed_per_emp.randint(0, 12),
                    time_to_merge_hours=ttm,
                    signals=signals,
                    quality_ratio=qr,
                )
                session.add(pr)
                prs_created.append(pr)
            await session.flush()
            total_prs += len(prs_created)

            # 2) Snapshot — агрегат по prs_created
            size_counts = {"XS": 0, "S": 0, "M": 0, "L": 0, "XL": 0}
            with_tests = with_descr = with_review = 0
            sum_iter = 0
            sum_qr = 0.0
            ttm_values: list[float] = []
            for p in prs_created:
                size_counts[p.size_bucket] += 1
                if p.signals.get("has_tests"):
                    with_tests += 1
                if p.signals.get("has_description"):
                    with_descr += 1
                if p.signals.get("has_review_discussion"):
                    with_review += 1
                sum_iter += p.iterations
                sum_qr += p.quality_ratio
                if p.time_to_merge_hours is not None:
                    ttm_values.append(p.time_to_merge_hours)
            n = len(prs_created)
            snapshot = DevMetricsSnapshot(
                employee_id=emp.id,
                period_start=period_start,
                period_end=period_end,
                total_commits=sum(p.iterations * seed_per_emp.randint(1, 3) for p in prs_created),
                total_mrs=n,
                lines_added=sum(p.additions for p in prs_created),
                lines_removed=sum(p.deletions for p in prs_created),
                mr_size_xs=size_counts["XS"],
                mr_size_s=size_counts["S"],
                mr_size_m=size_counts["M"],
                mr_size_l=size_counts["L"],
                mr_size_xl=size_counts["XL"],
                mr_with_tests=with_tests,
                mr_with_description=with_descr,
                mr_with_review_discussion=with_review,
                avg_iterations=round(sum_iter / n, 2) if n else 0.0,
                avg_time_to_merge_hours=(
                    round(sum(ttm_values) / len(ttm_values), 1)
                    if ttm_values
                    else None
                ),
                avg_quality_ratio=round(sum_qr / n, 2) if n else 0.0,
                comments_given=seed_per_emp.randint(5, 60),
                comments_received=sum(p.comments_count for p in prs_created),
                wip_count=sum(1 for p in prs_created if p.state == "open"),
                stale_count=seed_per_emp.randint(0, 2),
            )
            session.add(snapshot)
            total_snapshots += 1

            # 3) ExtractedCompetency — 4..7 компетенций с привязкой к 2..5 PR-ам
            comp_sample = await _competencies_for_employee(
                session, emp, all_competencies
            )
            for comp in comp_sample:
                pr_examples_n = seed_per_emp.randint(2, min(5, n))
                example_prs = seed_per_emp.sample(prs_created, k=pr_examples_n)
                last_seen = max(
                    (p.merged_at_ext or p.created_at_ext for p in example_prs),
                    default=None,
                )
                ec = ExtractedCompetency(
                    employee_id=emp.id,
                    competency_id=comp.id,
                    frequency=pr_examples_n,
                    last_seen_at=last_seen,
                    pr_examples=[
                        {
                            "pr_id": p.id,
                            "pr_external_id": p.external_id,
                            "title": p.title,
                            "url": p.url,
                            "project_id": p.project_id,
                            "evidence": (
                                f"PR с {p.additions} добавленными строками; "
                                f"в {comp.name} прослеживается через изменения "
                                f"в {p.files_changed} файлах."
                            )[:300],
                        }
                        for p in example_prs
                    ],
                    source="mock",
                )
                session.add(ec)
                total_extracted += 1

            await session.commit()
            print(
                f"  • {emp.full_name}: {n} PR-ов, {len(comp_sample)} компетенций"
            )

        print()
        print(f"Сотрудников обработано: {len(employees)}")
        print(f"Снэпшотов:              {total_snapshots}")
        print(f"PR-ов:                  {total_prs}")
        print(f"Извлечённых компетенций: {total_extracted}")


if __name__ == "__main__":
    asyncio.run(main())
