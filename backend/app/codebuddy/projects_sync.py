"""Авто-синхронизация проектов из CodeBuddy.

CodeBuddy на каждом MR-элементе возвращает `projectId` и `projectName`.
Этот модуль преобразует пары (projectId, projectName) → строки в таблице
`projects` и добавляет сотрудника в `project_members`, если ещё нет.

Вызывается из двух точек:
  1. Read-хук на GET /employees/{id}/dev-metrics и /pull-requests — мгновенное
     появление проекта при первом просмотре карточки сотрудника.
  2. Cron `codebuddy_sync_projects` (раз в сутки) — пакетная синхронизация
     по всем сотрудникам с gitlab-username.

Владельцем (`created_by`) ставится первый найденный admin-пользователь.
Идемпотентно: повторный вызов не создаёт дубликатов.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Iterable
from urllib.parse import urlparse

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.employee import Employee
from app.models.project import Product, ProductMember, Project, ProjectMember
from app.models.user import User

logger = logging.getLogger(__name__)


# Один кортеж = одна «встреча» сотрудника с проектом в CodeBuddy:
# (gitlab_project_id, project_name, first_seen_at, mr_url).
# mr_url нужен, чтобы извлечь GitLab-группу (см. _extract_gitlab_group).
ProjectSeen = tuple[int, str | None, datetime | None, str | None]


def _extract_gitlab_group(mr_url: str | None) -> str | None:
    """Из URL merge-request'а вытащить путь группы (без имени репо).

    GitLab MR URL: `https://<host>/<group>/[<subgroup>/...]/<repo>/-/merge_requests/<iid>`.
    Возвращает `<group>/[<subgroup>]` или None, если URL не GitLab-формата.
    """
    if not mr_url:
        return None
    try:
        u = urlparse(mr_url)
    except Exception:  # noqa: BLE001
        return None
    path = (u.path or "").lstrip("/")
    if not path:
        return None
    # GitLab MR URL содержит маркер '/-/merge_requests/'. Берём всё до него.
    before_marker = path.split("/-/", 1)[0]
    if not before_marker or before_marker == path:
        return None
    parts = [p for p in before_marker.split("/") if p]
    if len(parts) < 2:
        # `/standalone-repo/-/merge_requests/...` — группы нет.
        return None
    return "/".join(parts[:-1])


async def _get_admin_user_id(session: AsyncSession) -> int | None:
    """Найти любого админа для `Project.created_by`. None если админов нет."""
    q = await session.execute(
        select(User.id).where(User.is_admin.is_(True)).order_by(User.id).limit(1)
    )
    return q.scalar_one_or_none()


async def sync_projects_from_codebuddy(
    session: AsyncSession,
    employee: Employee,
    seen: Iterable[ProjectSeen],
) -> dict:
    """Создать недостающие Project + ProjectMember.

    Returns:
        {"created_projects": int, "added_members": int, "skipped": int}
    """
    result = {
        "created_projects": 0,
        "added_members": 0,
        "added_product_members": 0,
        "skipped": 0,
    }
    pairs = list(seen)
    if not pairs:
        return result

    # Дедупликация по gitlab_project_id: оставляем самое раннее first_seen
    # как кандидат на joined_at, и любое непустое имя/группу.
    by_pid: dict[int, tuple[str | None, datetime | None, str | None]] = {}
    for pid, pname, first_seen, mr_url in pairs:
        if not pid:
            continue
        group = _extract_gitlab_group(mr_url)
        old = by_pid.get(pid)
        if old is None:
            by_pid[pid] = (pname, first_seen, group)
            continue
        old_name, old_seen, old_group = old
        new_name = pname or old_name
        new_seen = old_seen
        if first_seen and (not old_seen or first_seen < old_seen):
            new_seen = first_seen
        new_group = old_group or group
        by_pid[pid] = (new_name, new_seen, new_group)
    if not by_pid:
        return result

    admin_id = await _get_admin_user_id(session)
    if admin_id is None:
        # Нет ни одного админа — нечем заполнить NOT NULL created_by.
        # Тихо выходим (БД должна как минимум содержать admin).
        logger.warning("sync_projects_from_codebuddy: no admin user found, skipping")
        result["skipped"] = len(by_pid)
        return result

    today = date.today()

    # 1а) Обеспечиваем Product для каждой группы (упорядоченно, идемпотентно).
    groups_needed = {g for (_n, _t, g) in by_pid.values() if g}
    if groups_needed:
        prod_rows = [
            {
                "name": g.rsplit("/", 1)[-1] or g,
                "status": "active",
                "created_by": admin_id,
                "gitlab_group": g,
            }
            for g in groups_needed
        ]
        ins_prod = pg_insert(Product).values(prod_rows)
        ins_prod = ins_prod.on_conflict_do_nothing(index_elements=["gitlab_group"])
        await session.execute(ins_prod)

    group_to_product_id: dict[str, int] = {}
    if groups_needed:
        gq = await session.execute(
            select(Product.gitlab_group, Product.id).where(Product.gitlab_group.in_(groups_needed))
        )
        group_to_product_id = {g: pid for g, pid in gq.all()}

    # 1б) Подтягиваем существующие Project (для backfill product_id).
    pre_existing_q = await session.execute(
        select(Project).where(Project.gitlab_project_id.in_(by_pid.keys()))
    )
    pre_existing: dict[int, Project] = {
        p.gitlab_project_id: p for p in pre_existing_q.scalars() if p.gitlab_project_id is not None
    }

    # 1в) Решаем какой product_id ставить каждому pid. Для одиночек (group=None)
    # — Product 1:1, переиспользуем существующий, иначе создаём.
    pid_to_product_id: dict[int, int] = {}
    for pid, (pname, _first_seen, group) in by_pid.items():
        if group:
            prod_id = group_to_product_id.get(group)
            if prod_id is not None:
                pid_to_product_id[pid] = prod_id
                continue
        # group отсутствует или не нашёлся → 1:1 Product
        existing_proj = pre_existing.get(pid)
        if existing_proj and existing_proj.product_id is not None:
            pid_to_product_id[pid] = existing_proj.product_id
            continue
        single = Product(
            name=(pname or f"GitLab project #{pid}")[:255],
            status="active",
            created_by=admin_id,
            gitlab_group=None,
        )
        session.add(single)
        await session.flush()
        pid_to_product_id[pid] = single.id

    # 2) Bulk-insert проектов с ON CONFLICT DO NOTHING.
    proj_rows = [
        {
            "gitlab_project_id": pid,
            "name": (pname or f"GitLab project #{pid}")[:255],
            "status": "active",
            "created_by": admin_id,
            "started_at": first_seen.date() if first_seen else today,
            "gitlab_group": group,
            "product_id": pid_to_product_id.get(pid),
        }
        for pid, (pname, first_seen, group) in by_pid.items()
    ]
    ins_proj = pg_insert(Project).values(proj_rows)
    ins_proj = ins_proj.on_conflict_do_nothing(
        index_elements=["gitlab_project_id"],
        index_where=Project.__table__.c.gitlab_project_id.isnot(None),
    )
    res = await session.execute(ins_proj)
    if not isinstance(res, CursorResult):
        raise RuntimeError("Ожидался CursorResult при создании проектов")
    result["created_projects"] = int(res.rowcount or 0)

    # 3) Подтянуть актуальные Project и сделать backfill product_id / group.
    existing_q = await session.execute(
        select(Project).where(Project.gitlab_project_id.in_(by_pid.keys()))
    )
    existing: dict[int, Project] = {
        p.gitlab_project_id: p for p in existing_q.scalars() if p.gitlab_project_id is not None
    }
    for pid, (_pname, _first_seen, group) in by_pid.items():
        proj = existing.get(pid)
        if proj is None:
            continue
        if proj.product_id is None and pid in pid_to_product_id:
            proj.product_id = pid_to_product_id[pid]
        if group and not proj.gitlab_group:
            proj.gitlab_group = group

    # 4) Bulk-insert ProjectMember с ON CONFLICT DO NOTHING по UNIQUE
    #    (project_id, employee_id) — повторный синк не плодит дубликатов.
    mem_rows = []
    for pid, (_pname, first_seen, _group) in by_pid.items():
        proj = existing.get(pid)
        if proj is None:
            continue
        mem_rows.append(
            {
                "project_id": proj.id,
                "employee_id": employee.id,
                "role_in_project": None,
                "joined_at": first_seen.date() if first_seen else today,
                "left_at": None,
            }
        )
    if mem_rows:
        ins_mem = pg_insert(ProjectMember).values(mem_rows)
        ins_mem = ins_mem.on_conflict_do_nothing(index_elements=["project_id", "employee_id"])
        res = await session.execute(ins_mem)
        if not isinstance(res, CursorResult):
            raise RuntimeError("Ожидался CursorResult при добавлении участников")
        result["added_members"] = int(res.rowcount or 0)

    # 5) Материализуем ProductMember (агрегат по продукту). Синк заводит
    #    ProjectMember по каждому репо, но UI продукта, performance и история
    #    сотрудника читают product_members. Без этого шага сотрудник виден
    #    только в тех продуктах, куда его добавили руками/миграцией — хотя
    #    PR-ы у него в нескольких. joined_at = min(first_seen) по репо продукта.
    prod_joined: dict[int, date] = {}
    for pid, (_pname, first_seen, _group) in by_pid.items():
        proj = existing.get(pid)
        if proj is None or proj.product_id is None:
            continue
        joined = first_seen.date() if first_seen else today
        cur = prod_joined.get(proj.product_id)
        if cur is None or joined < cur:
            prod_joined[proj.product_id] = joined
    if prod_joined:
        pmem_rows = [
            {
                "product_id": prod_id,
                "employee_id": employee.id,
                "role_in_project": None,
                "joined_at": joined,
                "left_at": None,
            }
            for prod_id, joined in prod_joined.items()
        ]
        ins_pmem = pg_insert(ProductMember).values(pmem_rows)
        ins_pmem = ins_pmem.on_conflict_do_nothing(index_elements=["product_id", "employee_id"])
        res = await session.execute(ins_pmem)
        if not isinstance(res, CursorResult):
            raise RuntimeError("Ожидался CursorResult при добавлении участников продукта")
        result["added_product_members"] = int(res.rowcount or 0)

    await session.commit()
    return result
