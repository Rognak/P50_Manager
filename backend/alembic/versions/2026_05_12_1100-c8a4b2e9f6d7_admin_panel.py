"""admin panel: users.is_admin, system_settings, cron_runs

Revision ID: c8a4b2e9f6d7
Revises: b7e3f2a1d9c4
Create Date: 2026-05-12 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = 'c8a4b2e9f6d7'
down_revision: Union[str, None] = 'b7e3f2a1d9c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # users.is_admin — ортогональный role флаг.
    op.add_column(
        'users',
        sa.Column(
            'is_admin', sa.Boolean(), nullable=False,
            server_default=sa.text('false'),
        ),
    )

    # system_settings — key/value хранилище для конфигурации админ-панели:
    # nav_visibility, enabled_notification_kinds, paused_cron_jobs и т.п.
    op.create_table(
        'system_settings',
        sa.Column('key', sa.String(length=64), primary_key=True),
        sa.Column('value', JSONB(), nullable=False),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_by',
            sa.Integer(),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
    )

    # cron_runs — история запусков cron-задач (плановых и ручных).
    op.create_table(
        'cron_runs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('cron_name', sa.String(length=64), nullable=False, index=True),
        sa.Column(
            'trigger', sa.String(length=20), nullable=False
        ),  # 'scheduled' | 'manual'
        sa.Column(
            'status', sa.String(length=20), nullable=False
        ),  # 'running' | 'ok' | 'error'
        sa.Column(
            'started_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error_msg', sa.Text(), nullable=True),
        sa.Column(
            'triggered_by',
            sa.Integer(),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
    )
    op.create_index('ix_cron_runs_started_at', 'cron_runs', ['started_at'])


def downgrade() -> None:
    op.drop_index('ix_cron_runs_started_at', table_name='cron_runs')
    op.drop_table('cron_runs')
    op.drop_table('system_settings')
    op.drop_column('users', 'is_admin')
