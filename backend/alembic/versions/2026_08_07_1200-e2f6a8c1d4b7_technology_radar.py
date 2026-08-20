"""Technology Radar phase 1.

Revision ID: e2f6a8c1d4b7
Revises: c1e4d7a9f3b6
Create Date: 2026-08-07 12:00:00
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e2f6a8c1d4b7"
down_revision: Union[str, None] = "c1e4d7a9f3b6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "technology_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.bulk_insert(
        sa.table(
            "technology_categories",
            sa.column("code", sa.String()), sa.column("name", sa.String()),
            sa.column("sort_order", sa.Integer()),
        ),
        [
            {"code": "development", "name": "Разработка", "sort_order": 10},
            {"code": "data", "name": "Управление данными", "sort_order": 20},
            {"code": "infrastructure", "name": "Инфраструктура", "sort_order": 30},
            {"code": "frameworks_tools", "name": "Фреймворки и инструменты", "sort_order": 40},
            {"code": "methods_practices", "name": "Методики и подходы", "sort_order": 50},
        ],
    )
    op.create_table(
        "technologies",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("technology_categories.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False, unique=True),
        sa.Column("description_md", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("status_reason_md", sa.Text(), nullable=True),
        sa.Column("replacement_technology_id", sa.Integer(), sa.ForeignKey("technologies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status_changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_review_at", sa.Date(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("status IN ('adopt','trial','assess','hold')", name="ck_technologies_status"),
    )
    for column in ("category_id", "status", "next_review_at", "replacement_technology_id", "is_active"):
        op.create_index(f"ix_technologies_{column}", "technologies", [column])
    op.create_table(
        "technology_members",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("technology_id", sa.Integer(), sa.ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.Integer(), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("source", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("technology_id", "employee_id"),
        sa.CheckConstraint("role IN ('leader','expert','practitioner')", name="ck_technology_members_role"),
        sa.CheckConstraint("source IN ('manual','inferred')", name="ck_technology_members_source"),
    )
    op.create_index("ix_technology_members_technology_id", "technology_members", ["technology_id"])
    op.create_index("ix_technology_members_employee_id", "technology_members", ["employee_id"])
    op.create_table(
        "technology_products",
        sa.Column("technology_id", sa.Integer(), sa.ForeignKey("technologies.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("usage_type", sa.String(20), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("usage_type IN ('production','pilot','evaluation','legacy')", name="ck_technology_products_usage_type"),
    )
    op.create_index("ix_technology_products_product_id", "technology_products", ["product_id"])
    op.create_table(
        "technology_links",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("technology_id", sa.Integer(), sa.ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('documentation','methodology','guide','course','community','source','article','other')", name="ck_technology_links_kind"),
    )
    op.create_index("ix_technology_links_technology_id", "technology_links", ["technology_id"])
    op.create_table(
        "technology_decisions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("technology_id", sa.Integer(), sa.ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event_kind", sa.String(30), nullable=False),
        sa.Column("from_status", sa.String(20), nullable=True),
        sa.Column("to_status", sa.String(20), nullable=True),
        sa.Column("summary_md", sa.Text(), nullable=False),
        sa.Column("next_review_at", sa.Date(), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("event_kind IN ('created','status_changed','reviewed','archived','restored')", name="ck_technology_decisions_event_kind"),
    )
    op.create_index("ix_technology_decisions_technology_id", "technology_decisions", ["technology_id"])
    op.create_index("ix_technology_decisions_technology_created", "technology_decisions", ["technology_id", "created_at"])


def downgrade() -> None:
    op.drop_table("technology_decisions")
    op.drop_table("technology_links")
    op.drop_table("technology_products")
    op.drop_table("technology_members")
    op.drop_table("technologies")
    op.drop_table("technology_categories")
