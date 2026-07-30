"""unique projects.gitlab_project_id (partial — только когда не NULL)

Защита от race-condition в codebuddy_sync_projects: параллельные ARQ-задачи
не должны плодить дубли. В нашей DB после ручного merge'а на 2026-05-19
дубликатов нет — индекс создаётся без CONCURRENTLY (это в транзакции миграции).

Revision ID: b8c4d6e9f3a2
Revises: a7b3c5e8f2d1
Create Date: 2026-05-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


revision: str = 'b8c4d6e9f3a2'
down_revision: Union[str, None] = 'a7b3c5e8f2d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Partial unique: позволяет NULL у проектов, заведённых вручную (без
    # привязки к GitLab), и при этом запрещает дубли по конкретному
    # GitLab project_id.
    op.execute(
        'CREATE UNIQUE INDEX uq_projects_gitlab_project_id '
        'ON projects (gitlab_project_id) '
        'WHERE gitlab_project_id IS NOT NULL'
    )


def downgrade() -> None:
    op.execute('DROP INDEX IF EXISTS uq_projects_gitlab_project_id')
