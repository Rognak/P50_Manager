"""Этап 1: вводим сущность Product + Project.product_id.

Бэкфилл:
- Для каждого уникального Project.gitlab_group → один Product с этим
  gitlab_group. Имя Product = последний сегмент group_path (`isup` из
  `devzone/NonProgram/isup`).
- Для Project без gitlab_group → 1:1 Product с именем из самого
  Project (`name`). gitlab_group=NULL.
- created_by, product_manager_id, status — копируем из первого Project в
  группе.

Revision ID: c1d3e5f7a9b4
Revises: b8c4d6e9f3a2
Create Date: 2026-05-19 13:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c1d3e5f7a9b4'
down_revision: Union[str, None] = 'b8c4d6e9f3a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) products table
    op.create_table(
        'products',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column(
            'status', sa.String(length=20), nullable=False, server_default='active'
        ),
        sa.Column('started_at', sa.Date(), nullable=True),
        sa.Column('finished_at', sa.Date(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('product_manager_id', sa.Integer(), nullable=True),
        sa.Column('gitlab_group', sa.String(length=255), nullable=True),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            'updated_at',
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(
            ['product_manager_id'], ['users.id'], ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('gitlab_group', name='uq_products_gitlab_group'),
    )
    op.create_index(
        'ix_products_product_manager_id', 'products', ['product_manager_id']
    )
    op.create_index('ix_products_gitlab_group', 'products', ['gitlab_group'])

    # 2) projects.product_id (nullable на этапе миграции)
    op.add_column(
        'projects',
        sa.Column('product_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_projects_product_id', 'projects', 'products',
        ['product_id'], ['id'], ondelete='CASCADE',
    )
    op.create_index('ix_projects_product_id', 'projects', ['product_id'])

    # 3) backfill: для каждого уникального gitlab_group → один Product
    op.execute("""
        INSERT INTO products (
            name, status, created_by, product_manager_id, gitlab_group
        )
        SELECT
            -- Имя = последний сегмент group_path. Если group_path = 'a/b/c',
            -- берём 'c'. Лёгко переименовать руками потом.
            split_part(p.gitlab_group, '/', array_length(string_to_array(p.gitlab_group, '/'), 1)),
            p.status,
            p.created_by,
            p.product_manager_id,
            p.gitlab_group
        FROM (
            SELECT DISTINCT ON (gitlab_group)
                gitlab_group, status, created_by, product_manager_id
            FROM projects
            WHERE gitlab_group IS NOT NULL
            ORDER BY gitlab_group, id
        ) p;
    """)

    # 4) backfill: для Project без gitlab_group → индивидуальный Product 1:1
    op.execute("""
        INSERT INTO products (
            name, status, created_by, product_manager_id, gitlab_group
        )
        SELECT p.name, p.status, p.created_by, p.product_manager_id, NULL
        FROM projects p
        WHERE p.gitlab_group IS NULL;
    """)

    # 5) projects.product_id → связываем с созданными Product'ами.
    # Для group'-ов: связываем все Project одной группы с одним Product.
    op.execute("""
        UPDATE projects p
        SET product_id = pr.id
        FROM products pr
        WHERE p.gitlab_group IS NOT NULL AND p.gitlab_group = pr.gitlab_group;
    """)
    # Для одиночек (gitlab_group=NULL): привязываем по имени+created_by.
    # Связь берем только с Product без gitlab_group (чтобы не наврать).
    op.execute("""
        UPDATE projects p
        SET product_id = pr.id
        FROM products pr
        WHERE p.gitlab_group IS NULL
          AND pr.gitlab_group IS NULL
          AND pr.name = p.name
          AND pr.created_by = p.created_by
          AND p.product_id IS NULL;
    """)


def downgrade() -> None:
    op.drop_index('ix_projects_product_id', table_name='projects')
    op.drop_constraint('fk_projects_product_id', 'projects', type_='foreignkey')
    op.drop_column('projects', 'product_id')
    op.drop_index('ix_products_gitlab_group', table_name='products')
    op.drop_index('ix_products_product_manager_id', table_name='products')
    op.drop_table('products')
