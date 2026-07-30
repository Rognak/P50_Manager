"""departments + dept_maturity_surveys

Revision ID: 9d3a2b4f8e22
Revises: 8e2f1a9b7c33
Create Date: 2026-04-28 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = '9d3a2b4f8e22'
down_revision: Union[str, None] = '8e2f1a9b7c33'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'departments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('owner_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_departments_owner_id'), 'departments', ['owner_id'], unique=False)

    op.create_table(
        'dept_maturity_surveys',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('department_id', sa.Integer(), nullable=False),
        sa.Column('period', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='draft'),
        sa.Column('template_version', sa.String(length=20), nullable=False),
        sa.Column('info', JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('answers', JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['department_id'], ['departments.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('department_id', 'period'),
    )
    op.create_index(
        op.f('ix_dept_maturity_surveys_department_id'),
        'dept_maturity_surveys',
        ['department_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_dept_maturity_surveys_department_id'), table_name='dept_maturity_surveys')
    op.drop_table('dept_maturity_surveys')
    op.drop_index(op.f('ix_departments_owner_id'), table_name='departments')
    op.drop_table('departments')
