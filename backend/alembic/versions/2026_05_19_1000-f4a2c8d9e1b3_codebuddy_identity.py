"""codebuddy identity: Employee.gitlab_username + Project.gitlab_project_id

Revision ID: f4a2c8d9e1b3
Revises: e1f8a2b6c4d9
Create Date: 2026-05-19 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f4a2c8d9e1b3'
down_revision: Union[str, None] = 'e1f8a2b6c4d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Employee.gitlab_username — опционально. Если null, helper выводит
    # из email-prefix (email.split('@')[0].lower().replace('.', '_')).
    op.add_column(
        'employees',
        sa.Column('gitlab_username', sa.String(length=100), nullable=True),
    )
    op.create_index(
        'ix_employees_gitlab_username', 'employees', ['gitlab_username']
    )

    # Project.gitlab_project_id — целочисленный GitLab ID. Без него
    # CodeBuddy не сможет фильтровать /developers?projectId=... — поля
    # на агрегации проекта будут пустыми.
    op.add_column(
        'projects',
        sa.Column('gitlab_project_id', sa.Integer(), nullable=True),
    )
    op.create_index(
        'ix_projects_gitlab_project_id', 'projects', ['gitlab_project_id']
    )


def downgrade() -> None:
    op.drop_index('ix_projects_gitlab_project_id', table_name='projects')
    op.drop_column('projects', 'gitlab_project_id')
    op.drop_index('ix_employees_gitlab_username', table_name='employees')
    op.drop_column('employees', 'gitlab_username')
