from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import Index as sa_Index
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Competency(Base):
    __tablename__ = "competencies"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    criteria: Mapped[list["CompetencyCriterion"]] = relationship(
        back_populates="competency",
        cascade="all, delete-orphan",
        order_by="CompetencyCriterion.order_num",
    )


class CompetencyCriterion(Base):
    __tablename__ = "competency_criteria"
    __table_args__ = (UniqueConstraint("competency_id", "order_num"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    competency_id: Mapped[int] = mapped_column(
        ForeignKey("competencies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_num: Mapped[int] = mapped_column(Integer, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)

    competency: Mapped[Competency] = relationship(back_populates="criteria")


class ProficiencyLevel(Base):
    __tablename__ = "proficiency_levels"

    code: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    theory: Mapped[str | None] = mapped_column(Text, nullable=True)
    practice: Mapped[str | None] = mapped_column(Text, nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)


role_key_competencies = Table(
    "role_key_competencies",
    Base.metadata,
    Column(
        "role_id",
        ForeignKey("roles.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "competency_id",
        ForeignKey("competencies.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    specialization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    direction: Mapped[str | None] = mapped_column(String(255), nullable=True)

    key_competencies: Mapped[list["Competency"]] = relationship(secondary="role_key_competencies")


class Grade(Base):
    __tablename__ = "grades"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False)


class RoleProfile(Base):
    __tablename__ = "role_profiles"
    __table_args__ = (
        CheckConstraint(
            "required_level >= 0 AND required_level <= 5", name="ck_role_profile_level"
        ),
    )

    role_id: Mapped[int] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    grade_id: Mapped[int] = mapped_column(
        ForeignKey("grades.id", ondelete="CASCADE"), primary_key=True
    )
    competency_id: Mapped[int] = mapped_column(
        ForeignKey("competencies.id", ondelete="CASCADE"), primary_key=True
    )
    required_level: Mapped[int] = mapped_column(Integer, nullable=False)


class LearningResource(Base):
    __tablename__ = "learning_resources"

    id: Mapped[int] = mapped_column(primary_key=True)
    competency_id: Mapped[int] = mapped_column(
        ForeignKey("competencies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    levels: Mapped[list[int]] = mapped_column(ARRAY(Integer), nullable=False)
    format: Mapped[str | None] = mapped_column(String(100), nullable=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str | None] = mapped_column(String(255), nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    evaluation: Mapped[str | None] = mapped_column(Text, nullable=True)


class Assessment(Base, TimestampMixin):
    __tablename__ = "assessments"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assessed_at: Mapped[date] = mapped_column(
        Date, nullable=False, server_default=func.current_date()
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    scores: Mapped[list["AssessmentScore"]] = relationship(
        back_populates="assessment",
        cascade="all, delete-orphan",
    )
    meetings: Mapped[list["Meeting"]] = relationship(
        secondary="assessment_meetings",
        back_populates="assessments",
    )


assessment_meetings = Table(
    "assessment_meetings",
    Base.metadata,
    Column(
        "assessment_id",
        ForeignKey("assessments.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "meeting_id",
        ForeignKey("meetings.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class MpkProcedure(Base, TimestampMixin):
    __tablename__ = "mpk_procedures"
    __table_args__ = (
        sa_Index(
            "ix_mpk_procedures_one_open_per_employee",
            "employee_id",
            unique=True,
            postgresql_where=text("status = 'open'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    period_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open")
    summary_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    role_snapshot: Mapped[str | None] = mapped_column(String(255), nullable=True)
    grade_snapshot: Mapped[str | None] = mapped_column(String(20), nullable=True)
    preparation_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    meetings: Mapped[list["Meeting"]] = relationship(
        back_populates="procedure",
        order_by="Meeting.scheduled_at",
    )


class Meeting(Base, TimestampMixin):
    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    procedure_id: Mapped[int | None] = mapped_column(
        ForeignKey("mpk_procedures.id", ondelete="SET NULL"), nullable=True, index=True
    )
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="planned")
    agenda_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_questions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ai_tasks: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    procedure: Mapped["MpkProcedure | None"] = relationship(back_populates="meetings")
    assessments: Mapped[list["Assessment"]] = relationship(
        secondary=assessment_meetings,
        back_populates="meetings",
    )


class AIJob(Base, TimestampMixin):
    """Запись о запланированной/выполняющейся/завершённой AI-задаче.

    Источник истины для UI и для отладки в БД.
    Один и тот же `kind` всегда обозначает один и тот же тип AI-операции.
    `target_kind` + `target_id` — ссылка на сущность, которую задача обновит
    после завершения (meeting / procedure / employee). FK не делаем, чтобы
    одна таблица обслуживала разные типы целей.
    """

    __tablename__ = "ai_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    # kind: meeting_questions | meeting_tasks | meeting_summary
    #     | procedure_preparation | employee_recommendation
    kind: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    # status: queued | running | done | error
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="queued", index=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_kind: Mapped[str | None] = mapped_column(String(30), nullable=True)
    target_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class Recommendation(Base, TimestampMixin):
    """AI-рекомендации по развитию (ИПР). Индивидуальный план развития сотрудника,
    сгенерированный на основе его текущей МПК, истории оценок, артефактов встреч
    и доступных ресурсов обучения."""

    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(primary_key=True)
    employee_id: Mapped[int] = mapped_column(
        ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True
    )
    procedure_id: Mapped[int | None] = mapped_column(
        ForeignKey("mpk_procedures.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content_md: Mapped[str] = mapped_column(Text, nullable=False)
    context_summary: Mapped[dict] = mapped_column(JSONB, nullable=False)
    model: Mapped[str] = mapped_column(String(50), nullable=False)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class MeetingArtifact(Base, TimestampMixin):
    """Артефакт встречи: ответ сотрудника, его код, комментарий руководителя.
    Самостоятельная сущность — переживает перегенерацию AI-items.
    Привязка к конкретному AI-вопросу/заданию — через ai_item_uid (опциональная)."""

    __tablename__ = "meeting_artifacts"
    __table_args__ = (
        # одна запись на комбинацию (встреча, тип артефакта, AI-item).
        # для not-null ai_item_uid; NULL-значения не конфликтуют в PG.
        UniqueConstraint(
            "meeting_id",
            "kind",
            "ai_item_uid",
            name="uq_meeting_artifacts_meeting_kind_itemuid",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    meeting_id: Mapped[int] = mapped_column(
        ForeignKey("meetings.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    ai_item_uid: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    competency_id: Mapped[int | None] = mapped_column(
        ForeignKey("competencies.id", ondelete="SET NULL"), nullable=True
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )


class AssessmentScore(Base):
    __tablename__ = "assessment_scores"
    __table_args__ = (
        UniqueConstraint("assessment_id", "competency_id"),
        CheckConstraint("level >= 0 AND level <= 5", name="ck_assessment_score_level"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("assessments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    competency_id: Mapped[int] = mapped_column(
        ForeignKey("competencies.id", ondelete="CASCADE"), nullable=False
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    assessment: Mapped[Assessment] = relationship(back_populates="scores")
