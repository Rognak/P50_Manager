"""self_reviews

Revision ID: 4d7e91a8c3b5
Revises: 9b2e8f5dab12
Create Date: 2026-04-27 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '4d7e91a8c3b5'
down_revision: Union[str, None] = '9b2e8f5dab12'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'self_reviews',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='draft'),
        sa.Column('source_filename', sa.String(length=255), nullable=True),
        sa.Column('source_content_type', sa.String(length=100), nullable=True),
        sa.Column('source_size_bytes', sa.Integer(), nullable=True),
        sa.Column('source_uploaded_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('source_data', sa.LargeBinary(), nullable=True),
        sa.Column('source_text', sa.Text(), nullable=True),
        sa.Column('project_score', sa.Integer(), nullable=True),
        sa.Column('company_score', sa.Integer(), nullable=True),
        sa.Column('manager_notes_md', sa.Text(), nullable=True),
        sa.Column('ai_topics_md', sa.Text(), nullable=True),
        sa.Column('ai_comparison_md', sa.Text(), nullable=True),
        sa.Column('ai_burnout_md', sa.Text(), nullable=True),
        sa.Column('ai_calibration_md', sa.Text(), nullable=True),
        sa.Column('ai_drafting_md', sa.Text(), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('employee_id', 'year'),
    )
    op.create_index(op.f('ix_self_reviews_employee_id'), 'self_reviews', ['employee_id'], unique=False)
    op.create_index(op.f('ix_self_reviews_status'), 'self_reviews', ['status'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_self_reviews_status'), table_name='self_reviews')
    op.drop_index(op.f('ix_self_reviews_employee_id'), table_name='self_reviews')
    op.drop_table('self_reviews')
