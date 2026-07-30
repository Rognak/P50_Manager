"""project gitlab_group для группировки мультирепо-продуктов

Revision ID: a7b3c5e8f2d1
Revises: f4a2c8d9e1b3
Create Date: 2026-05-19 11:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a7b3c5e8f2d1'
down_revision: Union[str, None] = 'f4a2c8d9e1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Project.gitlab_group — путь GitLab-группы без имени репо (например
    # 'znrid/myapp' для репозиториев `znrid/myapp/backend` + `znrid/myapp/frontend`).
    # Автозаполняется при синке из URL merge-request'ов CodeBuddy.
    op.add_column(
        'projects',
        sa.Column('gitlab_group', sa.String(length=255), nullable=True),
    )
    op.create_index(
        'ix_projects_gitlab_group', 'projects', ['gitlab_group']
    )


def downgrade() -> None:
    op.drop_index('ix_projects_gitlab_group', table_name='projects')
    op.drop_column('projects', 'gitlab_group')
