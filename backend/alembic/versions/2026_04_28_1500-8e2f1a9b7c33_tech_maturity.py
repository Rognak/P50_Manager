"""tech_maturity_surveys

Revision ID: 8e2f1a9b7c33
Revises: 5a8f3e2c9d44
Create Date: 2026-04-28 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = '8e2f1a9b7c33'
down_revision: Union[str, None] = '5a8f3e2c9d44'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tech_maturity_surveys',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('period', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='draft'),
        sa.Column('template_version', sa.String(length=20), nullable=False),
        sa.Column('info', JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('answers', JSONB(astext_type=sa.Text()), nullable=False, server_default='{}'),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('project_id', 'period'),
    )
    op.create_index(
        op.f('ix_tech_maturity_surveys_project_id'),
        'tech_maturity_surveys',
        ['project_id'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f('ix_tech_maturity_surveys_project_id'),
        table_name='tech_maturity_surveys',
    )
    op.drop_table('tech_maturity_surveys')
