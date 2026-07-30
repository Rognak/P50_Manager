"""Этап 2a: product_members + product_competencies + бэкфилл.

Бэкфилл из project_members:
  • один (product_id, employee_id) — одна запись
  • joined_at = min(joined_at)
  • left_at = NULL если хотя бы одно репо активно, иначе max(left_at)
  • rotation_locked = OR
  • role_in_project / rotation_lock_note = первое непустое

Бэкфилл из project_competencies:
  • один (product_id, competency_id) — одна запись
  • target_level = max(target_level)

Старые таблицы project_members и project_competencies остаются
до этапа 5 для безопасного rollback.

Revision ID: d2e4f6a8b1c5
Revises: c1d3e5f7a9b4
Create Date: 2026-05-19 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd2e4f6a8b1c5'
down_revision: Union[str, None] = 'c1d3e5f7a9b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ===== product_members =====
    op.create_table(
        'product_members',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('role_in_project', sa.String(length=100), nullable=True),
        sa.Column('joined_at', sa.Date(), nullable=True),
        sa.Column('left_at', sa.Date(), nullable=True),
        sa.Column(
            'rotation_locked', sa.Boolean(), server_default='false', nullable=False
        ),
        sa.Column('rotation_lock_note', sa.Text(), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['employee_id'], ['employees.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('product_id', 'employee_id'),
    )
    op.create_index('ix_product_members_product_id', 'product_members', ['product_id'])
    op.create_index('ix_product_members_employee_id', 'product_members', ['employee_id'])

    # Бэкфилл с агрегацией.
    # DISTINCT ON для role_in_project / rotation_lock_note — берём из «лучшей»
    # строки (где значение не пустое); если у всех NULL — итог NULL.
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
        GROUP BY p.product_id, pm.employee_id;
    """)

    # ===== product_competencies =====
    op.create_table(
        'product_competencies',
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('competency_id', sa.Integer(), nullable=False),
        sa.Column(
            'target_level', sa.Integer(), nullable=False, server_default='3'
        ),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(
            ['competency_id'], ['competencies.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('product_id', 'competency_id'),
    )

    op.execute("""
        INSERT INTO product_competencies (product_id, competency_id, target_level)
        SELECT
            p.product_id,
            pc.competency_id,
            MAX(pc.target_level) AS target_level
        FROM project_competencies pc
        JOIN projects p ON p.id = pc.project_id
        WHERE p.product_id IS NOT NULL
        GROUP BY p.product_id, pc.competency_id;
    """)


def downgrade() -> None:
    op.drop_table('product_competencies')
    op.drop_index('ix_product_members_employee_id', table_name='product_members')
    op.drop_index('ix_product_members_product_id', table_name='product_members')
    op.drop_table('product_members')
