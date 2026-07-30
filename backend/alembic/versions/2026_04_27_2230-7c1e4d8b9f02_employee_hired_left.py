"""employee hired_at / left_at

Revision ID: 7c1e4d8b9f02
Revises: 4d7e91a8c3b5
Create Date: 2026-04-27 22:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '7c1e4d8b9f02'
down_revision: Union[str, None] = '4d7e91a8c3b5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('employees', sa.Column('hired_at', sa.Date(), nullable=True))
    op.add_column('employees', sa.Column('left_at', sa.Date(), nullable=True))
    op.create_index(op.f('ix_employees_left_at'), 'employees', ['left_at'], unique=False)
    # backfill: для существующих сотрудников hired_at = дата создания записи
    op.execute("UPDATE employees SET hired_at = created_at::date WHERE hired_at IS NULL")


def downgrade() -> None:
    op.drop_index(op.f('ix_employees_left_at'), table_name='employees')
    op.drop_column('employees', 'left_at')
    op.drop_column('employees', 'hired_at')
