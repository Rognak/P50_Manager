"""dev metrics + extracted competencies + digital profile

Revision ID: d9f3a1c4e7b2
Revises: c8a4b2e9f6d7
Create Date: 2026-05-12 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = 'd9f3a1c4e7b2'
down_revision: Union[str, None] = 'c8a4b2e9f6d7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # dev_metrics_snapshots
    op.create_table(
        'dev_metrics_snapshots',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'employee_id', sa.Integer(),
            sa.ForeignKey('employees.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('period_start', sa.Date(), nullable=False),
        sa.Column('period_end', sa.Date(), nullable=False),
        sa.Column('total_commits', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('total_mrs', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('lines_added', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('lines_removed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('mr_size_xs', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('mr_size_s', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('mr_size_m', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('mr_size_l', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('mr_size_xl', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('mr_with_tests', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('mr_with_description', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('mr_with_review_discussion', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('avg_iterations', sa.Float(), nullable=False, server_default='0'),
        sa.Column('avg_time_to_merge_hours', sa.Float(), nullable=True),
        sa.Column('avg_quality_ratio', sa.Float(), nullable=False, server_default='0'),
        sa.Column('comments_given', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('comments_received', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('wip_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('stale_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('employee_id', 'period_start', 'period_end',
                            name='uq_dev_metrics_employee_period'),
    )

    # pull_requests
    op.create_table(
        'pull_requests',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('external_id', sa.String(64), nullable=False, index=True),
        sa.Column(
            'employee_id', sa.Integer(),
            sa.ForeignKey('employees.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column(
            'project_id', sa.Integer(),
            sa.ForeignKey('projects.id', ondelete='SET NULL'),
            nullable=True, index=True,
        ),
        sa.Column('title', sa.String(500), nullable=False),
        sa.Column('url', sa.String(500), nullable=True),
        sa.Column('state', sa.String(20), nullable=False),
        sa.Column('created_at_ext', sa.DateTime(timezone=True), nullable=False),
        sa.Column('merged_at_ext', sa.DateTime(timezone=True), nullable=True),
        sa.Column('additions', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('deletions', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('files_changed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('tests_changed', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('size_bucket', sa.String(4), nullable=False, server_default='S'),
        sa.Column('iterations', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('comments_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('time_to_merge_hours', sa.Float(), nullable=True),
        sa.Column('signals', JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('quality_ratio', sa.Float(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('external_id', 'project_id', name='uq_pull_request_ext_proj'),
    )

    # extracted_competencies
    op.create_table(
        'extracted_competencies',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'employee_id', sa.Integer(),
            sa.ForeignKey('employees.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column(
            'competency_id', sa.Integer(),
            sa.ForeignKey('competencies.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('frequency', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('pr_examples', JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('source', sa.String(20), nullable=False, server_default='ai'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('employee_id', 'competency_id', name='uq_extracted_comp_emp_comp'),
    )

    # digital_profiles
    op.create_table(
        'digital_profiles',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column(
            'employee_id', sa.Integer(),
            sa.ForeignKey('employees.id', ondelete='CASCADE'),
            nullable=False, index=True,
        ),
        sa.Column('generated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('content_md', sa.Text(), nullable=False),
        sa.Column('input_summary', JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column('model', sa.String(50), nullable=False, server_default='mock'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.UniqueConstraint('employee_id', name='uq_digital_profile_employee'),
    )


def downgrade() -> None:
    op.drop_table('digital_profiles')
    op.drop_table('extracted_competencies')
    op.drop_table('pull_requests')
    op.drop_table('dev_metrics_snapshots')
