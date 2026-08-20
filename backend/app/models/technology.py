from datetime import date, datetime
from typing import Literal
from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class TechnologyCategory(Base):
    __tablename__ = "technology_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )


class TechnologyCatalogEntry(Base):
    __tablename__ = "technology_catalog"

    technology_id: Mapped[str] = mapped_column(String(50), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    aliases: Mapped[str | None] = mapped_column(Text, nullable=True)
    ecosystem: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    detectability: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    manifest_signals: Mapped[str | None] = mapped_column(Text, nullable=True)
    code_signals: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class Technology(Base, TimestampMixin):
    __tablename__ = "technologies"
    __table_args__ = (
        CheckConstraint(
            "status IN ('adopt', 'trial', 'assess', 'hold')",
            name="ck_technologies_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("technology_categories.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    icon_slug: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[Literal["adopt", "trial", "assess", "hold"]] = mapped_column(
        String(20), nullable=False, index=True
    )
    status_reason_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    replacement_technology_id: Mapped[int | None] = mapped_column(
        ForeignKey("technologies.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    last_reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    next_review_at: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true", index=True
    )


class TechnologyMember(Base, TimestampMixin):
    __tablename__ = "technology_members"
    __table_args__ = (
        UniqueConstraint("technology_id", "employee_id"),
        CheckConstraint(
            "role IN ('leader', 'expert', 'practitioner')",
            name="ck_technology_members_role",
        ),
        CheckConstraint(
            "source IN ('manual', 'inferred')",
            name="ck_technology_members_source",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    technology_id: Mapped[int] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(
        String(20), nullable=False, default="manual", server_default="manual"
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class TechnologyProduct(Base, TimestampMixin):
    __tablename__ = "technology_products"
    __table_args__ = (
        CheckConstraint(
            "usage_type IN ('production', 'pilot', 'evaluation', 'legacy')",
            name="ck_technology_products_usage_type",
        ),
    )

    technology_id: Mapped[int] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), primary_key=True
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    usage_type: Mapped[Literal["production", "pilot", "evaluation", "legacy"]] = mapped_column(
        String(20), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class TechnologyLink(Base, TimestampMixin):
    __tablename__ = "technology_links"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('documentation', 'methodology', 'guide', 'course', "
            "'community', 'source', 'article', 'other')",
            name="ck_technology_links_kind",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    technology_id: Mapped[int] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class TechnologyDecision(Base, TimestampMixin):
    __tablename__ = "technology_decisions"
    __table_args__ = (
        CheckConstraint(
            "event_kind IN ('created', 'status_changed', 'reviewed', 'archived', 'restored')",
            name="ck_technology_decisions_event_kind",
        ),
        Index("ix_technology_decisions_technology_created", "technology_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    technology_id: Mapped[int] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    summary_md: Mapped[str] = mapped_column(Text, nullable=False)
    next_review_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class TechnologyCompetency(Base, TimestampMixin):
    __tablename__ = "technology_competencies"
    __table_args__ = (
        CheckConstraint("weight >= 1 AND weight <= 5", name="ck_technology_competencies_weight"),
    )

    technology_id: Mapped[int] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), primary_key=True
    )
    competency_id: Mapped[int] = mapped_column(
        ForeignKey("competencies.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    weight: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class TechnologyPackageMapping(Base, TimestampMixin):
    __tablename__ = "technology_package_mappings"
    __table_args__ = (UniqueConstraint("ecosystem", "package_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    technology_id: Mapped[int] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    ecosystem: Mapped[str] = mapped_column(String(30), nullable=False)
    package_name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class TechnologyProjectVersionEvidence(Base, TimestampMixin):
    __tablename__ = "technology_project_version_evidence"
    __table_args__ = (UniqueConstraint("package_mapping_id", "project_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    package_mapping_id: Mapped[int] = mapped_column(
        ForeignKey("technology_package_mappings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[str] = mapped_column(String(100), nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False, default="manual")
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class TechnologyVulnerabilitySnapshot(Base, TimestampMixin):
    __tablename__ = "technology_vulnerability_snapshots"
    __table_args__ = (UniqueConstraint("version_evidence_id", "advisory_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    version_evidence_id: Mapped[int] = mapped_column(
        ForeignKey("technology_project_version_evidence.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    advisory_id: Mapped[str] = mapped_column(String(100), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_kev: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    epss: Mapped[float | None] = mapped_column(nullable=True)
    affected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TechnologyNewsSource(Base, TimestampMixin):
    __tablename__ = "technology_news_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    technology_id: Mapped[int] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    feed_url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class TechnologyNewsItem(Base, TimestampMixin):
    __tablename__ = "technology_news_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    technology_id: Mapped[int] = mapped_column(
        ForeignKey("technologies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_id: Mapped[int | None] = mapped_column(
        ForeignKey("technology_news_sources.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    source: Mapped[str] = mapped_column(String(255), nullable=False)
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class TechnologyProposal(Base, TimestampMixin):
    __tablename__ = "technology_proposals"
    __table_args__ = (
        CheckConstraint(
            "status IN ('submitted','assessing','approved','rejected','converted')",
            name="ck_technology_proposals_status",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("technology_categories.id", ondelete="RESTRICT"), nullable=False
    )
    rationale_md: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="submitted", index=True)
    decision_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposed_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    decided_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    technology_id: Mapped[int | None] = mapped_column(
        ForeignKey("technologies.id", ondelete="SET NULL"), nullable=True
    )
