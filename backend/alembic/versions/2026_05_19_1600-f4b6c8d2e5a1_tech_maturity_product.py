"""tech_maturity_surveys.product_id (тех.зрелость теперь на уровне Product).

Revision ID: f4b6c8d2e5a1
Revises: e3f5a7b9c2d4
Create Date: 2026-05-19 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f4b6c8d2e5a1'
down_revision: Union[str, None] = 'e3f5a7b9c2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'tech_maturity_surveys',
        sa.Column('product_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_tech_maturity_surveys_product_id',
        'tech_maturity_surveys', 'products',
        ['product_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(
        'ix_tech_maturity_surveys_product_id',
        'tech_maturity_surveys', ['product_id'],
    )
    op.create_unique_constraint(
        'uq_tech_maturity_surveys_product_period',
        'tech_maturity_surveys', ['product_id', 'period'],
    )
    # project_id становится nullable (legacy для старых опросников).
    op.alter_column('tech_maturity_surveys', 'project_id', nullable=True)

    # Бэкфилл: tech_maturity_surveys.product_id = projects.product_id.
    op.execute("""
        UPDATE tech_maturity_surveys s
        SET product_id = p.product_id
        FROM projects p
        WHERE s.project_id = p.id AND p.product_id IS NOT NULL;
    """)


def downgrade() -> None:
    op.alter_column('tech_maturity_surveys', 'project_id', nullable=False)
    op.drop_constraint(
        'uq_tech_maturity_surveys_product_period',
        'tech_maturity_surveys', type_='unique',
    )
    op.drop_index(
        'ix_tech_maturity_surveys_product_id',
        table_name='tech_maturity_surveys',
    )
    op.drop_constraint(
        'fk_tech_maturity_surveys_product_id',
        'tech_maturity_surveys', type_='foreignkey',
    )
    op.drop_column('tech_maturity_surveys', 'product_id')
