"""rotation planned_start_at

Revision ID: 3a8f2b4cd1a7
Revises: e7a23f5cb91d
Create Date: 2026-04-27 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3a8f2b4cd1a7'
down_revision: Union[str, None] = 'e7a23f5cb91d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'rotations',
        sa.Column('planned_start_at', sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('rotations', 'planned_start_at')
