"""notifications

Revision ID: f3c7b9e2a8d4
Revises: e8d2f4a9b6c5
Create Date: 2026-04-29 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = 'f3c7b9e2a8d4'
down_revision: Union[str, None] = 'e8d2f4a9b6c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'notifications',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('recipient_user_id', sa.Integer(), nullable=False),
        sa.Column('kind', sa.String(length=50), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('link', sa.String(length=255), nullable=True),
        sa.Column(
            'payload',
            JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default='{}',
        ),
        sa.Column(
            'is_read',
            sa.Boolean(),
            nullable=False,
            server_default='false',
        ),
        sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['recipient_user_id'], ['users.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_notifications_recipient_user_id'),
        'notifications',
        ['recipient_user_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_notifications_kind'),
        'notifications',
        ['kind'],
        unique=False,
    )
    op.create_index(
        op.f('ix_notifications_is_read'),
        'notifications',
        ['is_read'],
        unique=False,
    )
    # композитный для запроса «непрочитанные мне, по дате»
    op.create_index(
        'ix_notifications_recipient_unread_created',
        'notifications',
        ['recipient_user_id', 'is_read', 'created_at'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        'ix_notifications_recipient_unread_created', table_name='notifications'
    )
    op.drop_index(
        op.f('ix_notifications_is_read'), table_name='notifications'
    )
    op.drop_index(op.f('ix_notifications_kind'), table_name='notifications')
    op.drop_index(
        op.f('ix_notifications_recipient_user_id'), table_name='notifications'
    )
    op.drop_table('notifications')
