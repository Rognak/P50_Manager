"""Backfill product_members из project_members.

Разовая миграция d2e4f6a8b1c5 материализовала product_members один раз.
После неё авто-синк (sync_projects_from_codebuddy) продолжал заводить
project_members по репо, но НЕ материализовал product_members — поэтому
сотрудник с PR-ами в нескольких продуктах оставался виден только в одном.

Эта миграция добирает недостающие (product_id, employee_id) из project_members
с тем же агрегатом, что и d2e4f6a8b1c5. ON CONFLICT DO NOTHING — уже
существующие записи (с их ролью/заморозкой/датами) не трогаются.

Идемпотентна: повторный прогон не меняет данные.

Revision ID: c1e4d7a9f3b6
Revises: b9d3f5a7c2e4
Create Date: 2026-07-03 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c1e4d7a9f3b6'
down_revision: Union[str, None] = 'b9d3f5a7c2e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO product_members (
            product_id, employee_id, role_in_project,
            joined_at, left_at, rotation_locked, rotation_lock_note,
            created_at, updated_at
        )
        SELECT
            p.product_id,
            pm.employee_id,
            (
              SELECT pm2.role_in_project
              FROM project_members pm2
              JOIN projects p2 ON p2.id = pm2.project_id
              WHERE p2.product_id = p.product_id
                AND pm2.employee_id = pm.employee_id
                AND pm2.role_in_project IS NOT NULL
                AND TRIM(pm2.role_in_project) != ''
              ORDER BY pm2.updated_at DESC
              LIMIT 1
            ) AS role_in_project,
            MIN(pm.joined_at) AS joined_at,
            CASE WHEN bool_or(pm.left_at IS NULL) THEN NULL ELSE MAX(pm.left_at) END AS left_at,
            bool_or(pm.rotation_locked) AS rotation_locked,
            (
              SELECT pm2.rotation_lock_note
              FROM project_members pm2
              JOIN projects p2 ON p2.id = pm2.project_id
              WHERE p2.product_id = p.product_id
                AND pm2.employee_id = pm.employee_id
                AND pm2.rotation_lock_note IS NOT NULL
                AND TRIM(pm2.rotation_lock_note) != ''
              ORDER BY pm2.updated_at DESC
              LIMIT 1
            ) AS rotation_lock_note,
            MIN(pm.created_at) AS created_at,
            MAX(pm.updated_at) AS updated_at
        FROM project_members pm
        JOIN projects p ON p.id = pm.project_id
        WHERE p.product_id IS NOT NULL
        GROUP BY p.product_id, pm.employee_id
        ON CONFLICT (product_id, employee_id) DO NOTHING;
    """)


def downgrade() -> None:
    # Бэкфилл данных — откат не предусмотрен (нельзя отличить добранные
    # записи от исходных без доп. маркера).
    pass
