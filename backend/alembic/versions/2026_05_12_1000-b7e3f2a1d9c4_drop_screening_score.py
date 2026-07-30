"""drop ai_screening_score (qualitative screening only)

Revision ID: b7e3f2a1d9c4
Revises: a4b8c1e7d2f5
Create Date: 2026-05-12 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7e3f2a1d9c4'
down_revision: Union[str, None] = 'a4b8c1e7d2f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column('candidate_profiles', 'ai_screening_score')


def downgrade() -> None:
    op.add_column(
        'candidate_profiles',
        sa.Column('ai_screening_score', sa.Integer(), nullable=True),
    )
