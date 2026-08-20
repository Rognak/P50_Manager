"""Add official icon slug to radar technologies.

Revision ID: c4d9f2a7e1b5
Revises: a3c8e1f6b9d2
Create Date: 2026-08-16 12:00:00
"""

import csv
import re
from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4d9f2a7e1b5"
down_revision: Union[str, None] = "a3c8e1f6b9d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("technologies", sa.Column("icon_slug", sa.String(length=100), nullable=True))
    def normalize(value: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", value.lower())

    aliases: dict[str, str] = {}
    source = Path(__file__).resolve().parents[2] / "data" / "technology_icon_map.csv"
    with source.open(encoding="utf-8", newline="") as file:
        for row in csv.DictReader(file):
            for value in [row["technology_id"], row["name"], *row["aliases"].split("|")]:
                if value:
                    aliases[normalize(value)] = row["icon_slug"]
    aliases.update({
        normalize("C#"): "sharp",
        normalize("Kafka"): "apachekafka",
        normalize("OpenShift"): "redhatopenshift",
        normalize("ReactJS"): "react",
    })

    technologies = sa.table(
        "technologies",
        sa.column("id", sa.Integer()),
        sa.column("name", sa.String()),
        sa.column("icon_slug", sa.String()),
    )
    connection = op.get_bind()
    for technology_id, name in connection.execute(
        sa.select(technologies.c.id, technologies.c.name)
    ):
        icon_slug = aliases.get(normalize(name))
        if icon_slug:
            connection.execute(
                technologies.update()
                .where(technologies.c.id == technology_id)
                .values(icon_slug=icon_slug)
            )


def downgrade() -> None:
    op.drop_column("technologies", "icon_slug")
