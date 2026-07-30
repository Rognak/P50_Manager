"""digital_profiles.content_json (structured AI output)

Revision ID: e1f8a2b6c4d9
Revises: d9f3a1c4e7b2
Create Date: 2026-05-12 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision: str = 'e1f8a2b6c4d9'
down_revision: Union[str, None] = 'd9f3a1c4e7b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # JSONB-структура — основной носитель данных для UI. content_md остаётся
    # для legacy / экспорта в .docx.
    op.add_column(
        'digital_profiles',
        sa.Column('content_json', JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('digital_profiles', 'content_json')
