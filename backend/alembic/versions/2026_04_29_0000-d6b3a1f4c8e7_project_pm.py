"""project.product_manager_id

Revision ID: d6b3a1f4c8e7
Revises: c5e2a8d4f9a1
Create Date: 2026-04-29 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd6b3a1f4c8e7'
down_revision: Union[str, None] = 'c5e2a8d4f9a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'projects',
        sa.Column('product_manager_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_projects_product_manager_id_users',
        'projects',
        'users',
        ['product_manager_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        op.f('ix_projects_product_manager_id'),
        'projects',
        ['product_manager_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_projects_product_manager_id'), table_name='projects')
    op.drop_constraint(
        'fk_projects_product_manager_id_users', 'projects', type_='foreignkey'
    )
    op.drop_column('projects', 'product_manager_id')
