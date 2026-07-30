"""rotation replacement_employee_id

Revision ID: 9b2e8f5dab12
Revises: 3a8f2b4cd1a7
Create Date: 2026-04-27 18:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9b2e8f5dab12'
down_revision: Union[str, None] = '3a8f2b4cd1a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'rotations',
        sa.Column('replacement_employee_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_rotations_replacement_employee_id',
        'rotations',
        'employees',
        ['replacement_employee_id'],
        ['id'],
        ondelete='SET NULL',
    )


def downgrade() -> None:
    op.drop_constraint(
        'fk_rotations_replacement_employee_id', 'rotations', type_='foreignkey'
    )
    op.drop_column('rotations', 'replacement_employee_id')
