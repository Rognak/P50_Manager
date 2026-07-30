"""product_performance_reviews — AI-обзоры performance продукта.

Revision ID: a8c2e4f6b9d3
Revises: f4b6c8d2e5a1
Create Date: 2026-05-21 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a8c2e4f6b9d3'
down_revision: Union[str, None] = 'f4b6c8d2e5a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'product_performance_reviews',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column(
            'status', sa.String(length=20), nullable=False,
            server_default='queued',
        ),
        sa.Column('period_from', sa.Date(), nullable=True),
        sa.Column('period_to', sa.Date(), nullable=True),
        sa.Column('content_md', sa.Text(), nullable=True),
        sa.Column('model', sa.String(length=50), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'created_at', sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['product_id'], ['products.id'], ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['created_by'], ['users.id'], ondelete='RESTRICT'
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_product_performance_reviews_product_id',
        'product_performance_reviews', ['product_id'],
    )
    op.create_index(
        'ix_product_performance_reviews_status',
        'product_performance_reviews', ['status'],
    )


def downgrade() -> None:
    op.drop_index(
        'ix_product_performance_reviews_status',
        table_name='product_performance_reviews',
    )
    op.drop_index(
        'ix_product_performance_reviews_product_id',
        table_name='product_performance_reviews',
    )
    op.drop_table('product_performance_reviews')
