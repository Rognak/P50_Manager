"""assignments

Revision ID: e8d2f4a9b6c5
Revises: d6b3a1f4c8e7
Create Date: 2026-04-29 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e8d2f4a9b6c5'
down_revision: Union[str, None] = 'd6b3a1f4c8e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'assignments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=255), nullable=False),
        sa.Column('description_md', sa.Text(), nullable=True),
        sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            'status',
            sa.String(length=20),
            nullable=False,
            server_default='open',
        ),
        sa.Column('created_by_id', sa.Integer(), nullable=False),
        sa.Column('assignee_user_id', sa.Integer(), nullable=True),
        sa.Column('assignee_employee_id', sa.Integer(), nullable=True),
        sa.Column('attachment_filename', sa.String(length=255), nullable=True),
        sa.Column('attachment_content_type', sa.String(length=100), nullable=True),
        sa.Column('attachment_size_bytes', sa.Integer(), nullable=True),
        sa.Column(
            'attachment_uploaded_at',
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column('attachment_data', sa.LargeBinary(), nullable=True),
        sa.Column(
            'completed_at',
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.text('now()'),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ['created_by_id'], ['users.id'], ondelete='RESTRICT'
        ),
        sa.ForeignKeyConstraint(
            ['assignee_user_id'], ['users.id'], ondelete='CASCADE'
        ),
        sa.ForeignKeyConstraint(
            ['assignee_employee_id'], ['employees.id'], ondelete='CASCADE'
        ),
        sa.CheckConstraint(
            '(assignee_user_id IS NULL) <> (assignee_employee_id IS NULL)',
            name='ck_assignments_one_assignee',
        ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_assignments_due_at'), 'assignments', ['due_at'], unique=False
    )
    op.create_index(
        op.f('ix_assignments_status'), 'assignments', ['status'], unique=False
    )
    op.create_index(
        op.f('ix_assignments_created_by_id'),
        'assignments',
        ['created_by_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_assignments_assignee_user_id'),
        'assignments',
        ['assignee_user_id'],
        unique=False,
    )
    op.create_index(
        op.f('ix_assignments_assignee_employee_id'),
        'assignments',
        ['assignee_employee_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_assignments_assignee_employee_id'), table_name='assignments'
    )
    op.drop_index(
        op.f('ix_assignments_assignee_user_id'), table_name='assignments'
    )
    op.drop_index(
        op.f('ix_assignments_created_by_id'), table_name='assignments'
    )
    op.drop_index(op.f('ix_assignments_status'), table_name='assignments')
    op.drop_index(op.f('ix_assignments_due_at'), table_name='assignments')
    op.drop_table('assignments')
