from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TechnologyStatus = Literal["adopt", "trial", "assess", "hold"]
TechnologyMemberRole = Literal["leader", "expert", "practitioner"]
TechnologyMemberSource = Literal["manual", "inferred"]
TechnologyUsageType = Literal["production", "pilot", "evaluation", "legacy"]
TechnologyLinkKind = Literal[
    "documentation",
    "methodology",
    "guide",
    "course",
    "community",
    "source",
    "article",
    "other",
]


class TechnologyCategoryPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    code: str
    name: str
    description: str | None
    sort_order: int


class TechnologyMetaOption(BaseModel):
    value: str
    label: str


class TechnologyMetaResponse(BaseModel):
    categories: list[TechnologyCategoryPublic]
    statuses: list[TechnologyMetaOption]
    member_roles: list[TechnologyMetaOption]
    usage_types: list[TechnologyMetaOption]
    link_kinds: list[TechnologyMetaOption]


class TechnologyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    icon_slug: str | None = Field(default=None, max_length=100)
    category_id: int
    description_md: str | None = None
    status: TechnologyStatus
    status_reason_md: str | None = None
    replacement_technology_id: int | None = None
    next_review_at: date | None = None


class TechnologyUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    icon_slug: str | None = Field(default=None, max_length=100)
    category_id: int | None = None
    description_md: str | None = None
    replacement_technology_id: int | None = None
    next_review_at: date | None = None


class TechnologyStatusChange(BaseModel):
    status: TechnologyStatus
    reason_md: str = Field(min_length=1)
    next_review_at: date | None = None
    replacement_technology_id: int | None = None


class TechnologyReviewCreate(BaseModel):
    summary_md: str = Field(min_length=1)
    next_review_at: date | None = None


class TechnologyArchiveCreate(BaseModel):
    reason_md: str = Field(min_length=1)


class TechnologyRestoreCreate(BaseModel):
    reason_md: str = "Технология восстановлена в реестре"


class TechnologyRef(BaseModel):
    id: int
    name: str
    status: TechnologyStatus


class TechnologyAttentionFlags(BaseModel):
    overdue_review: bool
    no_expertise: bool
    hold_in_active_products: bool
    has_attention: bool


class TechnologyListItem(BaseModel):
    id: int
    name: str
    icon_slug: str | None
    category: TechnologyCategoryPublic
    status: TechnologyStatus
    status_reason_md: str | None
    replacement: TechnologyRef | None
    status_changed_at: datetime
    last_reviewed_at: datetime | None
    next_review_at: date | None
    is_active: bool
    leaders_count: int
    experts_count: int
    practitioners_count: int
    products_count: int
    active_products_count: int
    attention: TechnologyAttentionFlags


class TechnologyMemberCreate(BaseModel):
    employee_id: int
    role: TechnologyMemberRole
    notes: str | None = None


class TechnologyMemberUpdate(BaseModel):
    role: TechnologyMemberRole | None = None
    notes: str | None = None


class TechnologyMemberPublic(BaseModel):
    employee_id: int
    full_name: str
    role_name: str | None
    grade_code: str | None
    department_name: str | None
    employee_active: bool
    role: TechnologyMemberRole
    source: TechnologyMemberSource
    notes: str | None


class TechnologyProductCreate(BaseModel):
    product_id: int
    usage_type: TechnologyUsageType
    notes: str | None = None


class TechnologyProductUpdate(BaseModel):
    usage_type: TechnologyUsageType | None = None
    notes: str | None = None


class TechnologyProductPublic(BaseModel):
    product_id: int
    product_name: str
    product_status: str
    usage_type: TechnologyUsageType
    notes: str | None


class TechnologyLinkCreate(BaseModel):
    kind: TechnologyLinkKind
    title: str = Field(min_length=1, max_length=255)
    url: str = Field(min_length=1)
    sort_order: int = 0


class TechnologyLinkUpdate(BaseModel):
    kind: TechnologyLinkKind | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    url: str | None = Field(default=None, min_length=1)
    sort_order: int | None = None


class TechnologyLinkPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: TechnologyLinkKind
    title: str
    url: str
    sort_order: int


class TechnologyDecisionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event_kind: Literal["created", "status_changed", "reviewed", "archived", "restored"]
    from_status: TechnologyStatus | None
    to_status: TechnologyStatus | None
    summary_md: str
    next_review_at: date | None
    created_by: int
    created_at: datetime


class TechnologyPublic(TechnologyListItem):
    description_md: str | None
    members: list[TechnologyMemberPublic]
    products: list[TechnologyProductPublic]
    links: list[TechnologyLinkPublic]
    decisions: list[TechnologyDecisionPublic]
    created_by: int
    created_at: datetime
    updated_at: datetime


class ProductTechnologyPublic(BaseModel):
    technology_id: int
    technology_name: str
    icon_slug: str | None
    category: TechnologyCategoryPublic
    status: TechnologyStatus
    usage_type: TechnologyUsageType
    notes: str | None
    attention: TechnologyAttentionFlags


class EmployeeTechnologyProductRef(BaseModel):
    product_id: int
    product_name: str
    usage_type: TechnologyUsageType


class EmployeeTechnologyPublic(BaseModel):
    technology_id: int
    technology_name: str
    icon_slug: str | None
    category: TechnologyCategoryPublic
    status: TechnologyStatus
    member_role: TechnologyMemberRole
    source: TechnologyMemberSource
    notes: str | None
    products: list[EmployeeTechnologyProductRef]
    attention: TechnologyAttentionFlags
