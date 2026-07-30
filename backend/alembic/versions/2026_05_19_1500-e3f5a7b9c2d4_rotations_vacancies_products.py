"""Этап 2b: product_id колонки в rotations/rotation_suggestions/vacancies + бэкфилл.

Старые project_id колонки оставляем (становятся nullable), будут удалены
в этапе 5 после полного перехода кода на product_id.

Также релакс CHECK на vacancies: target_required теперь
"project_id OR product_id OR department_id".

Revision ID: e3f5a7b9c2d4
Revises: d2e4f6a8b1c5
Create Date: 2026-05-19 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e3f5a7b9c2d4'
down_revision: Union[str, None] = 'd2e4f6a8b1c5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ===== rotations =====
    op.add_column(
        'rotations',
        sa.Column('from_product_id', sa.Integer(), nullable=True),
    )
    op.add_column(
        'rotations',
        sa.Column('to_product_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_rotations_from_product_id', 'rotations', 'products',
        ['from_product_id'], ['id'], ondelete='CASCADE',
    )
    op.create_foreign_key(
        'fk_rotations_to_product_id', 'rotations', 'products',
        ['to_product_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_rotations_from_product_id', 'rotations', ['from_product_id'])
    op.create_index('ix_rotations_to_product_id', 'rotations', ['to_product_id'])

    # rotations.from_project_id становится nullable, но FK сохраняется.
    op.alter_column('rotations', 'from_project_id', nullable=True)

    op.execute("""
        UPDATE rotations r
        SET from_product_id = p.product_id
        FROM projects p
        WHERE r.from_project_id = p.id;
    """)
    op.execute("""
        UPDATE rotations r
        SET to_product_id = p.product_id
        FROM projects p
        WHERE r.to_project_id = p.id;
    """)

    # ===== rotation_suggestions =====
    op.add_column(
        'rotation_suggestions',
        sa.Column('from_product_id', sa.Integer(), nullable=True),
    )
    op.add_column(
        'rotation_suggestions',
        sa.Column(
            'target_product_ids',
            sa.ARRAY(sa.Integer()),
            nullable=False,
            server_default='{}',
        ),
    )
    op.create_foreign_key(
        'fk_rotation_suggestions_from_product_id',
        'rotation_suggestions', 'products',
        ['from_product_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index(
        'ix_rotation_suggestions_from_product_id',
        'rotation_suggestions', ['from_product_id'],
    )
    # UNIQUE (employee_id, from_product_id) для предотвращения дублей AI-suggestions.
    op.create_unique_constraint(
        'uq_rotation_suggestions_employee_from_product',
        'rotation_suggestions', ['employee_id', 'from_product_id'],
    )

    op.alter_column('rotation_suggestions', 'from_project_id', nullable=True)

    op.execute("""
        UPDATE rotation_suggestions rs
        SET from_product_id = p.product_id
        FROM projects p
        WHERE rs.from_project_id = p.id;
    """)
    # target_product_ids — массив. Бэкфилл: для каждого target_project_id
    # из массива находим соответствующий product_id и формируем новый массив
    # (с дедупликацией, т.к. несколько repo одного product могут оказаться
    # рекомендованы → надо сжать).
    op.execute("""
        UPDATE rotation_suggestions rs
        SET target_product_ids = COALESCE(
            (
                SELECT array_agg(DISTINCT p.product_id)
                FROM projects p
                WHERE p.id = ANY(rs.target_project_ids)
                  AND p.product_id IS NOT NULL
            ),
            '{}'::integer[]
        );
    """)

    # ===== vacancies =====
    op.add_column(
        'vacancies',
        sa.Column('product_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_vacancies_product_id', 'vacancies', 'products',
        ['product_id'], ['id'], ondelete='SET NULL',
    )
    op.create_index('ix_vacancies_product_id', 'vacancies', ['product_id'])

    op.execute("""
        UPDATE vacancies v
        SET product_id = p.product_id
        FROM projects p
        WHERE v.project_id = p.id;
    """)

    # Релакс CHECK constraint: target = project_id OR product_id OR department_id.
    op.drop_constraint(
        'ck_vacancies_target_required', 'vacancies', type_='check'
    )
    op.create_check_constraint(
        'ck_vacancies_target_required',
        'vacancies',
        'project_id IS NOT NULL OR product_id IS NOT NULL OR department_id IS NOT NULL',
    )


def downgrade() -> None:
    op.drop_constraint(
        'ck_vacancies_target_required', 'vacancies', type_='check'
    )
    op.create_check_constraint(
        'ck_vacancies_target_required',
        'vacancies',
        'project_id IS NOT NULL OR department_id IS NOT NULL',
    )
    op.drop_index('ix_vacancies_product_id', table_name='vacancies')
    op.drop_constraint('fk_vacancies_product_id', 'vacancies', type_='foreignkey')
    op.drop_column('vacancies', 'product_id')

    op.drop_constraint(
        'uq_rotation_suggestions_employee_from_product',
        'rotation_suggestions', type_='unique',
    )
    op.drop_index(
        'ix_rotation_suggestions_from_product_id',
        table_name='rotation_suggestions',
    )
    op.drop_constraint(
        'fk_rotation_suggestions_from_product_id',
        'rotation_suggestions', type_='foreignkey',
    )
    op.drop_column('rotation_suggestions', 'target_product_ids')
    op.drop_column('rotation_suggestions', 'from_product_id')
    op.alter_column('rotation_suggestions', 'from_project_id', nullable=False)

    op.drop_index('ix_rotations_to_product_id', table_name='rotations')
    op.drop_index('ix_rotations_from_product_id', table_name='rotations')
    op.drop_constraint('fk_rotations_to_product_id', 'rotations', type_='foreignkey')
    op.drop_constraint(
        'fk_rotations_from_product_id', 'rotations', type_='foreignkey'
    )
    op.drop_column('rotations', 'to_product_id')
    op.drop_column('rotations', 'from_product_id')
    op.alter_column('rotations', 'from_project_id', nullable=False)
