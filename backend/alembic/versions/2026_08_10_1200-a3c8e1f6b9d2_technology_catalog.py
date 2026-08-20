"""Add the administrator-only technology detection catalog.

Revision ID: a3c8e1f6b9d2
Revises: 52d9492a8b4a
Create Date: 2026-08-10 12:00:00
"""

import csv
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a3c8e1f6b9d2"
down_revision: Union[str, None] = "52d9492a8b4a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    catalog = op.create_table(
        "technology_catalog",
        sa.Column("technology_id", sa.String(length=50), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("aliases", sa.Text(), nullable=True),
        sa.Column("ecosystem", sa.String(length=50), nullable=False),
        sa.Column("detectability", sa.String(length=20), nullable=False),
        sa.Column("manifest_signals", sa.Text(), nullable=True),
        sa.Column("code_signals", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "detectability IN ('high', 'medium', 'low')",
            name="ck_technology_catalog_detectability",
        ),
    )
    op.create_index("ix_technology_catalog_name", "technology_catalog", ["name"])
    op.create_index("ix_technology_catalog_type", "technology_catalog", ["type"])
    op.create_index("ix_technology_catalog_ecosystem", "technology_catalog", ["ecosystem"])
    op.create_index(
        "ix_technology_catalog_detectability",
        "technology_catalog",
        ["detectability"],
    )

    source = Path(__file__).resolve().parents[2] / "data" / "technologies.csv"
    with source.open(encoding="utf-8-sig", newline="") as file:
        rows = [
            {key: value or None for key, value in row.items()}
            for row in csv.DictReader(file)
        ]
    op.bulk_insert(catalog, rows)


def downgrade() -> None:
    op.drop_index("ix_technology_catalog_detectability", table_name="technology_catalog")
    op.drop_index("ix_technology_catalog_ecosystem", table_name="technology_catalog")
    op.drop_index("ix_technology_catalog_type", table_name="technology_catalog")
    op.drop_index("ix_technology_catalog_name", table_name="technology_catalog")
    op.drop_table("technology_catalog")
