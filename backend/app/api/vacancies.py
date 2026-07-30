"""Вакансии: CRUD + генерация шаблона требований по role+grade+project."""
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, MutatorUser, SessionDep
from app.models.candidate import CandidateProfile
from app.models.department import Department
from app.models.mpk import (
    Competency,
    Grade,
    ProficiencyLevel,
    Role,
    RoleProfile,
    role_key_competencies,
)
from app.models.project import Project, ProjectCompetency
from app.models.user import User
from app.models.vacancy import Vacancy
from app.schemas.vacancy import (
    RequirementsTemplate,
    RequirementsTemplateRequest,
    VacancyCreate,
    VacancyListItem,
    VacancyPublic,
    VacancyStatus,
    VacancyUpdate,
)

router = APIRouter(prefix="/vacancies", tags=["vacancies"])


# ---------- helpers ----------


async def _to_public(session, v: Vacancy) -> VacancyPublic:
    project_name = None
    department_name = None
    role_name = None
    grade_code = None
    if v.project_id:
        proj = await session.get(Project, v.project_id)
        project_name = proj.name if proj else None
    if v.department_id:
        d = await session.get(Department, v.department_id)
        department_name = d.name if d else None
    if v.role_id:
        r = await session.get(Role, v.role_id)
        role_name = r.name if r else None
    if v.grade_id:
        g = await session.get(Grade, v.grade_id)
        grade_code = g.code if g else None
    creator = await session.get(User, v.created_by_id)

    cnt_q = await session.execute(
        select(func.count(CandidateProfile.id)).where(
            CandidateProfile.vacancy_id == v.id
        )
    )
    cnt = int(cnt_q.scalar() or 0)

    return VacancyPublic(
        id=v.id,
        title=v.title,
        project_id=v.project_id,
        project_name=project_name,
        department_id=v.department_id,
        department_name=department_name,
        role_id=v.role_id,
        role_name=role_name,
        grade_id=v.grade_id,
        grade_code=grade_code,
        requirements_md=v.requirements_md,
        status=v.status,
        created_by_id=v.created_by_id,
        created_by_name=creator.full_name if creator else None,
        created_at=v.created_at,
        updated_at=v.updated_at,
        closed_at=v.closed_at,
        candidates_count=cnt,
    )


async def _build_requirements_template(
    session,
    *,
    role_id: int | None,
    grade_id: int | None,
    project_id: int | None,
) -> str:
    """Собирает стартовый markdown с требованиями.

    Берёт ключевые компетенции из role-profile (если role+grade заданы),
    стек проекта (если задан) и общую философию.
    """
    role: Role | None = await session.get(Role, role_id) if role_id else None
    grade: Grade | None = await session.get(Grade, grade_id) if grade_id else None
    proj: Project | None = await session.get(Project, project_id) if project_id else None

    lines: list[str] = []
    lines.append("## Что мы ищем")
    lines.append("")
    if role and grade:
        lines.append(f"**Позиция:** {role.name} · уровень **{grade.code}**")
    elif role:
        lines.append(f"**Позиция:** {role.name}")
    if proj:
        lines.append(f"**Проект:** {proj.name}{(' (' + proj.code + ')') if proj.code else ''}")
        if proj.description:
            lines.append(f"_{proj.description}_")
    lines.append("")

    # Принцип отбора
    lines.append("## Принцип отбора")
    lines.append(
        "**Сильный инженер > узкоспециальное соответствие.** "
        "Кандидат может не иметь опыта с конкретным фреймворком из нашего стека "
        "— это не блокер. Главное — глубина мышления, способность быстро "
        "разобраться в новом, инженерный кругозор и зрелость."
    )
    lines.append("")

    # Из role-profile — только ключевые компетенции роли + расшифровка уровней
    used_levels: set[int] = set()
    if role_id and grade_id:
        rp_q = await session.execute(
            select(RoleProfile, Competency)
            .join(Competency, Competency.id == RoleProfile.competency_id)
            .join(
                role_key_competencies,
                (role_key_competencies.c.competency_id == Competency.id)
                & (role_key_competencies.c.role_id == role_id),
            )
            .where(
                RoleProfile.role_id == role_id,
                RoleProfile.grade_id == grade_id,
                RoleProfile.required_level > 0,
            )
            .order_by(RoleProfile.required_level.desc(), Competency.sort_order)
        )
        rows = list(rp_q.all())
        if rows:
            lines.append("## Целевой профиль (ключевые компетенции МПК)")
            lines.append(
                "_Ожидаемые уровни по ключевым компетенциям роли. "
                "Кандидат может быть ниже по одной-двум позициям, если в целом сильный инженер._"
            )
            lines.append("")
            for rp, comp in rows:
                used_levels.add(rp.required_level)
                lines.append(f"- **L{rp.required_level}** · {comp.name}")
            lines.append("")

            # Расшифровка только тех уровней, что встречаются выше — чтобы LLM
            # понимал, что стоит за L2/L3/L4 в нашей МПК.
            lvl_q = await session.execute(
                select(ProficiencyLevel)
                .where(ProficiencyLevel.code.in_(used_levels))
                .order_by(ProficiencyLevel.code)
            )
            levels = list(lvl_q.scalars().all())
            if levels:
                lines.append("### Что означают уровни")
                lines.append("")
                for lv in levels:
                    parts = [
                        s.strip()
                        for s in (lv.theory or "", lv.practice or "")
                        if s and s.strip()
                    ]
                    desc = " ".join(parts)
                    lines.append(f"- **L{lv.code} — {lv.name}.** {desc}")
                lines.append("")

    # Стек проекта
    if project_id:
        pc_q = await session.execute(
            select(ProjectCompetency, Competency)
            .join(Competency, Competency.id == ProjectCompetency.competency_id)
            .where(ProjectCompetency.project_id == project_id)
            .order_by(ProjectCompetency.target_level.desc(), Competency.sort_order)
        )
        rows = list(pc_q.all())
        if rows:
            lines.append("## Стек проекта (плюс, не требование)")
            for pc, comp in rows[:10]:
                lines.append(f"- {comp.name} (целевой L{pc.target_level})")
            lines.append("")

    lines.append("## Soft-skills")
    lines.append("- Самостоятельность, способность ставить себе задачу")
    lines.append("- Коммуникабельность, готовность к парной работе")
    lines.append("- Умение читать чужой код и оставлять понятные ревью")

    return "\n".join(lines)


# ---------- endpoints ----------


@router.post("/requirements-template", response_model=RequirementsTemplate)
async def get_requirements_template(
    payload: RequirementsTemplateRequest,
    session: SessionDep,
    _current_user: CurrentUser,
):
    """Сгенерировать стартовый шаблон требований на основе role/grade/project.
    Используется при создании вакансии — фронт получает markdown, потом юзер правит."""
    md = await _build_requirements_template(
        session,
        role_id=payload.role_id,
        grade_id=payload.grade_id,
        project_id=payload.project_id,
    )
    return RequirementsTemplate(requirements_md=md)


@router.get("", response_model=list[VacancyListItem])
async def list_vacancies(
    session: SessionDep,
    _current_user: CurrentUser,
    status_filter: VacancyStatus | None = Query(default=None, alias="status"),
    project_id: int | None = None,
    department_id: int | None = None,
):
    stmt = select(Vacancy).order_by(Vacancy.created_at.desc())
    if status_filter:
        stmt = stmt.where(Vacancy.status == status_filter)
    if project_id is not None:
        stmt = stmt.where(Vacancy.project_id == project_id)
    if department_id is not None:
        stmt = stmt.where(Vacancy.department_id == department_id)

    rows = (await session.execute(stmt)).scalars().all()
    if not rows:
        return []

    # подгружаем сопутствующие имена одним заходом
    proj_ids = {v.project_id for v in rows if v.project_id}
    dept_ids = {v.department_id for v in rows if v.department_id}
    role_ids = {v.role_id for v in rows if v.role_id}
    grade_ids = {v.grade_id for v in rows if v.grade_id}

    pname: dict[int, str] = {}
    dname: dict[int, str] = {}
    rname: dict[int, str] = {}
    gcode: dict[int, str] = {}
    if proj_ids:
        q = await session.execute(
            select(Project.id, Project.name).where(Project.id.in_(proj_ids))
        )
        pname = dict(q.all())
    if dept_ids:
        q = await session.execute(
            select(Department.id, Department.name).where(Department.id.in_(dept_ids))
        )
        dname = dict(q.all())
    if role_ids:
        q = await session.execute(
            select(Role.id, Role.name).where(Role.id.in_(role_ids))
        )
        rname = dict(q.all())
    if grade_ids:
        q = await session.execute(
            select(Grade.id, Grade.code).where(Grade.id.in_(grade_ids))
        )
        gcode = dict(q.all())

    # candidates count per vacancy
    cnt_q = await session.execute(
        select(CandidateProfile.vacancy_id, func.count(CandidateProfile.id))
        .where(CandidateProfile.vacancy_id.in_([v.id for v in rows]))
        .group_by(CandidateProfile.vacancy_id)
    )
    cnt_map = dict(cnt_q.all())

    return [
        VacancyListItem(
            id=v.id,
            title=v.title,
            project_id=v.project_id,
            project_name=pname.get(v.project_id) if v.project_id else None,
            department_id=v.department_id,
            department_name=dname.get(v.department_id) if v.department_id else None,
            role_name=rname.get(v.role_id) if v.role_id else None,
            grade_code=gcode.get(v.grade_id) if v.grade_id else None,
            status=v.status,
            created_at=v.created_at,
            candidates_count=cnt_map.get(v.id, 0),
        )
        for v in rows
    ]


@router.post("", response_model=VacancyPublic, status_code=status.HTTP_201_CREATED)
async def create_vacancy(
    payload: VacancyCreate, session: SessionDep, current_user: MutatorUser
):
    v = Vacancy(
        title=payload.title.strip(),
        project_id=payload.project_id,
        department_id=payload.department_id,
        role_id=payload.role_id,
        grade_id=payload.grade_id,
        requirements_md=(payload.requirements_md or "").strip() or None,
        status="open",
        created_by_id=current_user.id,
    )
    session.add(v)
    await session.commit()
    await session.refresh(v)
    return await _to_public(session, v)


@router.get("/{vacancy_id}", response_model=VacancyPublic)
async def get_vacancy(
    vacancy_id: int, session: SessionDep, _current_user: CurrentUser
):
    v = await session.get(Vacancy, vacancy_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Вакансия не найдена")
    return await _to_public(session, v)


@router.patch("/{vacancy_id}", response_model=VacancyPublic)
async def update_vacancy(
    vacancy_id: int,
    payload: VacancyUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    v = await session.get(Vacancy, vacancy_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Вакансия не найдена")
    data = payload.model_dump(exclude_unset=True)
    new_status = data.pop("status", None)
    for k, val in data.items():
        if isinstance(val, str):
            val = val.strip() or None
        setattr(v, k, val)
    if new_status is not None and new_status != v.status:
        v.status = new_status
        if new_status == "closed" and v.closed_at is None:
            v.closed_at = datetime.now(UTC)
        elif new_status == "open":
            v.closed_at = None
    # после изменения проверим: хотя бы один target должен остаться
    if v.project_id is None and v.department_id is None:
        raise HTTPException(
            status_code=400,
            detail="Нужно указать project_id или department_id",
        )
    await session.commit()
    await session.refresh(v)
    return await _to_public(session, v)


@router.delete("/{vacancy_id}", status_code=204)
async def delete_vacancy(
    vacancy_id: int, session: SessionDep, _current_user: MutatorUser
):
    v = await session.get(Vacancy, vacancy_id)
    if v is None:
        raise HTTPException(status_code=404, detail="Вакансия не найдена")
    await session.delete(v)
    await session.commit()
