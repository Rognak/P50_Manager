"""product_performance_reviews.content_json — структурированный AI-разбор.

Revision ID: b9d3f5a7c2e4
Revises: a8c2e4f6b9d3
Create Date: 2026-05-21 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'b9d3f5a7c2e4'
down_revision: Union[str, None] = 'a8c2e4f6b9d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'product_performance_reviews',
        sa.Column('content_json', postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('product_performance_reviews', 'content_json')
