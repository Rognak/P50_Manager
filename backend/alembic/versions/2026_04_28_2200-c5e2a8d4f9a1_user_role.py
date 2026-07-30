"""user.role column

Revision ID: c5e2a8d4f9a1
Revises: a4f1c2e9d6b3
Create Date: 2026-04-28 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c5e2a8d4f9a1'
down_revision: Union[str, None] = 'a4f1c2e9d6b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'role',
            sa.String(length=20),
            nullable=False,
            server_default='department_head',
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'role')
