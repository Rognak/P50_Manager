"""rotations

Revision ID: e7a23f5cb91d
Revises: c07c12ad286f
Create Date: 2026-04-27 11:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = 'e7a23f5cb91d'
down_revision: Union[str, None] = 'c07c12ad286f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'project_members',
        sa.Column('rotation_locked', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    op.add_column(
        'project_members',
        sa.Column('rotation_lock_note', sa.Text(), nullable=True),
    )

    op.create_table(
        'rotations',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('from_project_id', sa.Integer(), nullable=False),
        sa.Column('to_project_id', sa.Integer(), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='proposed'),
        sa.Column('reason_md', sa.Text(), nullable=True),
        sa.Column('initiated_by_id', sa.Integer(), nullable=False),
        sa.Column('proposed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('cancelled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reverted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reverted_by_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['from_project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['to_project_id'], ['projects.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['initiated_by_id'], ['users.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['reverted_by_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_rotations_employee_id'), 'rotations', ['employee_id'], unique=False)
    op.create_index(op.f('ix_rotations_from_project_id'), 'rotations', ['from_project_id'], unique=False)
    op.create_index(op.f('ix_rotations_to_project_id'), 'rotations', ['to_project_id'], unique=False)
    op.create_index(op.f('ix_rotations_status'), 'rotations', ['status'], unique=False)

    op.create_table(
        'rotation_approvals',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('rotation_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('decision', sa.String(length=20), nullable=True),
        sa.Column('decided_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['rotation_id'], ['rotations.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('rotation_id', 'user_id'),
    )
    op.create_index(op.f('ix_rotation_approvals_rotation_id'), 'rotation_approvals', ['rotation_id'], unique=False)
    op.create_index(op.f('ix_rotation_approvals_user_id'), 'rotation_approvals', ['user_id'], unique=False)

    op.create_table(
        'rotation_suggestions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('from_project_id', sa.Integer(), nullable=False),
        sa.Column('rationale_md', sa.Text(), nullable=False),
        sa.Column(
            'target_project_ids',
            postgresql.ARRAY(sa.Integer()),
            server_default=sa.text("'{}'::integer[]"),
            nullable=False,
        ),
        sa.Column('model', sa.String(length=50), nullable=True),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['from_project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('employee_id', 'from_project_id'),
    )
    op.create_index(op.f('ix_rotation_suggestions_employee_id'), 'rotation_suggestions', ['employee_id'], unique=False)
    op.create_index(op.f('ix_rotation_suggestions_from_project_id'), 'rotation_suggestions', ['from_project_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_rotation_suggestions_from_project_id'), table_name='rotation_suggestions')
    op.drop_index(op.f('ix_rotation_suggestions_employee_id'), table_name='rotation_suggestions')
    op.drop_table('rotation_suggestions')

    op.drop_index(op.f('ix_rotation_approvals_user_id'), table_name='rotation_approvals')
    op.drop_index(op.f('ix_rotation_approvals_rotation_id'), table_name='rotation_approvals')
    op.drop_table('rotation_approvals')

    op.drop_index(op.f('ix_rotations_status'), table_name='rotations')
    op.drop_index(op.f('ix_rotations_to_project_id'), table_name='rotations')
    op.drop_index(op.f('ix_rotations_from_project_id'), table_name='rotations')
    op.drop_index(op.f('ix_rotations_employee_id'), table_name='rotations')
    op.drop_table('rotations')

    op.drop_column('project_members', 'rotation_lock_note')
    op.drop_column('project_members', 'rotation_locked')
