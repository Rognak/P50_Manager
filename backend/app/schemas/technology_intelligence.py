from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TechnologyCompetencyCreate(BaseModel):
    competency_id: int
    weight: int = Field(default=3, ge=1, le=5)
    notes: str | None = None


class TechnologyCompetencyPublic(TechnologyCompetencyCreate):
    competency_name: str


class TechnologyCandidatePublic(BaseModel):
    employee_id: int
    full_name: str
    department_id: int | None
    department_name: str | None
    suggested_role: Literal["expert", "practitioner"]
    max_mpk_level: int | None
    matched_competencies: list[str]
    product_count: int
    pr_count: int
    reasons: list[str]


class TechnologyBusFactorPublic(BaseModel):
    leaders: int
    experts: int
    practitioners: int
    active_products: int
    single_expert_risk: bool
    low_carrier_coverage: bool
    departed_experts: int
    signals: list[str]


class PackageMappingCreate(BaseModel):
    ecosystem: str = Field(min_length=1, max_length=30)
    package_name: str = Field(min_length=1, max_length=255)


class PackageMappingPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    ecosystem: str
    package_name: str


class VersionEvidenceCreate(BaseModel):
    package_mapping_id: int
    project_id: int
    version: str = Field(min_length=1, max_length=100)
    source: str = "manual"


class VersionEvidenceUpdate(BaseModel):
    version: str | None = Field(default=None, min_length=1, max_length=100)
    source: str | None = Field(default=None, min_length=1, max_length=30)


class VulnerabilityCreate(BaseModel):
    advisory_id: str
    severity: Literal["critical", "high", "medium", "low", "unknown"]
    summary: str
    url: str | None = None
    is_kev: bool = False
    epss: float | None = Field(default=None, ge=0, le=1)
    affected: bool = True


class VulnerabilityPublic(VulnerabilityCreate):
    model_config = ConfigDict(from_attributes=True)
    id: int
    fetched_at: datetime


class VersionEvidencePublic(BaseModel):
    id: int
    package_mapping_id: int
    ecosystem: str
    package_name: str
    project_id: int
    project_name: str
    product_id: int | None
    product_name: str | None
    version: str
    source: str
    detected_at: datetime
    vulnerabilities: list[VulnerabilityPublic]


class SecuritySummaryPublic(BaseModel):
    critical: int
    high: int
    medium: int
    low: int
    kev: int
    affected_products: int
    evidence: list[VersionEvidencePublic]


class NewsSourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    feed_url: str = Field(min_length=1)


class NewsSourcePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    feed_url: str
    is_active: bool
    last_fetched_at: datetime | None


class NewsItemCreate(BaseModel):
    title: str
    url: str
    source: str
    published_at: datetime
    summary: str | None = None


class NewsItemPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    url: str
    source: str
    published_at: datetime
    summary: str | None


class ProposalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    category_id: int
    rationale_md: str = Field(min_length=1)


class ProposalDecision(BaseModel):
    status: Literal["assessing", "approved", "rejected"]
    decision_md: str = Field(min_length=1)


class ProposalPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category_id: int
    rationale_md: str
    status: str
    decision_md: str | None
    proposed_by: int
    decided_by: int | None
    technology_id: int | None
    created_at: datetime
