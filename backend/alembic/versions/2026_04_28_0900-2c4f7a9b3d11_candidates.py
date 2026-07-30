"""employee.kind + candidate_profiles

Revision ID: 2c4f7a9b3d11
Revises: 7c1e4d8b9f02
Create Date: 2026-04-28 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '2c4f7a9b3d11'
down_revision: Union[str, None] = '7c1e4d8b9f02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'employees',
        sa.Column(
            'kind',
            sa.String(length=20),
            nullable=False,
            server_default='employee',
        ),
    )
    op.create_index(op.f('ix_employees_kind'), 'employees', ['kind'], unique=False)

    op.create_table(
        'candidate_profiles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('stage', sa.String(length=20), nullable=False, server_default='new'),
        sa.Column('source', sa.String(length=100), nullable=True),
        sa.Column('expected_role_id', sa.Integer(), nullable=True),
        sa.Column('expected_grade_id', sa.Integer(), nullable=True),
        # резюме
        sa.Column('resume_filename', sa.String(length=255), nullable=True),
        sa.Column('resume_content_type', sa.String(length=100), nullable=True),
        sa.Column('resume_size_bytes', sa.Integer(), nullable=True),
        sa.Column('resume_uploaded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resume_data', sa.LargeBinary(), nullable=True),
        sa.Column('resume_text', sa.Text(), nullable=True),
        # AI-артефакты
        sa.Column('ai_resume_summary_md', sa.Text(), nullable=True),
        sa.Column('ai_feedback_md', sa.Text(), nullable=True),
        # решение
        sa.Column('feedback_decision', sa.String(length=20), nullable=True),
        sa.Column('rejection_reason_md', sa.Text(), nullable=True),
        # тайм-штампы
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['expected_role_id'], ['roles.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['expected_grade_id'], ['grades.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('employee_id'),
    )
    op.create_index(
        op.f('ix_candidate_profiles_stage'),
        'candidate_profiles',
        ['stage'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_candidate_profiles_stage'), table_name='candidate_profiles')
    op.drop_table('candidate_profiles')
    op.drop_index(op.f('ix_employees_kind'), table_name='employees')
    op.drop_column('employees', 'kind')
