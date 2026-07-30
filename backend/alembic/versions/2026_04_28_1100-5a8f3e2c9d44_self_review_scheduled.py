"""self_review.scheduled_1on1_at

Revision ID: 5a8f3e2c9d44
Revises: 2c4f7a9b3d11
Create Date: 2026-04-28 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5a8f3e2c9d44'
down_revision: Union[str, None] = '2c4f7a9b3d11'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'self_reviews',
        sa.Column('scheduled_1on1_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('self_reviews', 'scheduled_1on1_at')
