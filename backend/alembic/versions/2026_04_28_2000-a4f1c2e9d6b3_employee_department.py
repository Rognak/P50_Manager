"""employees.department_id

Revision ID: a4f1c2e9d6b3
Revises: 9d3a2b4f8e22
Create Date: 2026-04-28 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a4f1c2e9d6b3'
down_revision: Union[str, None] = '9d3a2b4f8e22'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'employees',
        sa.Column('department_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_employees_department_id_departments',
        'employees',
        'departments',
        ['department_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_index(
        op.f('ix_employees_department_id'),
        'employees',
        ['department_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_employees_department_id'), table_name='employees')
    op.drop_constraint(
        'fk_employees_department_id_departments', 'employees', type_='foreignkey'
    )
    op.drop_column('employees', 'department_id')
