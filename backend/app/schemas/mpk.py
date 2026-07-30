from pydantic import BaseModel, ConfigDict


class CriterionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_num: int
    description: str


class CompetencyPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: int
    name: str
    description: str | None
    sort_order: int
    criteria: list[CriterionPublic]


class LevelPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: int
    name: str
    theory: str | None
    practice: str | None
    comment: str | None


class RolePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    specialization: str | None
    direction: str | None


class GradePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    sort_order: int


class MpkProfileItem(BaseModel):
    competency_id: int
    competency_name: str
    sort_order: int
    current_level: int | None
    required_level: int | None
    gap: int | None


class MpkProfileAssessmentRef(BaseModel):
    id: int
    assessed_at: str


class MpkProfile(BaseModel):
    items: list[MpkProfileItem]
    last_assessment: MpkProfileAssessmentRef | None
    role: RolePublic | None
    grade: GradePublic | None


class RoleProfileCompetency(BaseModel):
    competency_id: int
    competency_name: str
    sort_order: int
    is_key: bool
    # key = grade_id, value = required_level (только для required_level > 0)
    levels: dict[int, int]


class RoleProfileDetail(BaseModel):
    role: RolePublic
    grades: list[GradePublic]
    competencies: list[RoleProfileCompetency]


class ProfileCellUpdate(BaseModel):
    competency_id: int
    grade_id: int
    required_level: int


class KeyCompetencyUpdate(BaseModel):
    competency_id: int
    is_key: bool
