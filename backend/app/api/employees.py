import logging

from fastapi import APIRouter, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.admin.settings import is_codebuddy_live
from app.api.deps import (
    CurrentUser,
    MutatorUser,
    SessionDep,
    can_view_employee_owned_by,
    is_core_team,
)
from app.employees.import_xlsx import parse_xlsx
from app.models.department import Department
from app.models.employee import Employee
from app.models.mpk import (
    Assessment,
    AssessmentScore,
    Competency,
    RoleProfile,
)
from app.redis_pool import get_pool
from app.schemas.employee import (
    EmployeeCreate,
    EmployeeImportCommit,
    EmployeeImportPreview,
    EmployeeImportResult,
    EmployeeListItem,
    EmployeeProjectHistoryItem,
    EmployeePublic,
    EmployeeUpdate,
)
from app.schemas.mpk import (
    GradePublic,
    MpkProfile,
    MpkProfileAssessmentRef,
    MpkProfileItem,
    RolePublic,
)
from app.schemas.mpk_history import HistoryCompetency, HistoryPoint, MpkHistory

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/employees", tags=["employees"])


async def _load_employee(session, employee_id: int, current_user) -> Employee:
    """Сотрудник, видимый текущему пользователю (свой или любой для core_team).
    Кандидаты сюда не подпадают — у них своё API /candidates."""
    q = await session.execute(
        select(Employee)
        .options(
            selectinload(Employee.role),
            selectinload(Employee.grade),
            selectinload(Employee.department),
            selectinload(Employee.owner),
        )
        .where(Employee.id == employee_id, Employee.kind == "employee")
    )
    employee = q.scalar_one_or_none()
    if employee is None or not can_view_employee_owned_by(current_user, employee.owner_id):
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    return employee


# Старое имя оставляем для совместимости с другими модулями. Для мутаций
# дополнительно вешается MutatorUser, поэтому core_team не доходит сюда.
_get_owned_employee = _load_employee


@router.get("", response_model=list[EmployeeListItem])
async def list_employees(session: SessionDep, current_user: CurrentUser):
    stmt = (
        select(Employee)
        .options(
            selectinload(Employee.role),
            selectinload(Employee.grade),
            selectinload(Employee.department),
            selectinload(Employee.owner),
        )
        .where(Employee.kind == "employee")
        .order_by(Employee.full_name)
    )
    if not is_core_team(current_user):
        stmt = stmt.where(Employee.owner_id == current_user.id)
    q = await session.execute(stmt)
    return list(q.scalars())


async def _enqueue_codebuddy_sync(
    session: SessionDep,
    employee_ids: list[int],
    all_time: bool = True,
) -> None:
    """Поставить в ARQ-очередь синк проектов для каждого сотрудника.

    Без побочных эффектов на основной commit: ошибки логируем и проглатываем
    (CodeBuddy выключен, Redis не поднят, и т.п. не должны валить create/import).
    """
    if not employee_ids:
        return
    try:
        if not await is_codebuddy_live(session):
            return
        pool = get_pool()
    except Exception as e:  # noqa: BLE001
        logger.warning("codebuddy sync enqueue skipped: %s", e)
        return
    for eid in employee_ids:
        try:
            await pool.enqueue_job("run_codebuddy_sync_projects", eid, all_time)
        except Exception as e:  # noqa: BLE001
            logger.warning("enqueue codebuddy sync for emp #%s failed: %s", eid, e)


@router.post("", response_model=EmployeePublic, status_code=status.HTTP_201_CREATED)
async def create_employee(
    payload: EmployeeCreate, session: SessionDep, current_user: MutatorUser
) -> Employee:
    employee = Employee(
        full_name=payload.full_name,
        email=payload.email,
        position=payload.position,
        owner_id=current_user.id,
        hired_at=payload.hired_at,
    )
    session.add(employee)
    await session.commit()
    await session.refresh(employee, attribute_names=["role", "grade", "department", "owner"])
    # Запускаем фоновый all-time синк проектов из CodeBuddy.
    await _enqueue_codebuddy_sync(session, [employee.id], all_time=True)
    return employee


@router.get("/{employee_id}", response_model=EmployeePublic)
async def get_employee(employee_id: int, session: SessionDep, current_user: CurrentUser):
    return await _load_employee(session, employee_id, current_user)


@router.patch("/{employee_id}", response_model=EmployeePublic)
async def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    session: SessionDep,
    current_user: MutatorUser,
):
    employee = await _load_employee(session, employee_id, current_user)
    if employee.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Нет прав на редактирование")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(employee, key, value)
    await session.commit()
    await session.refresh(employee, attribute_names=["role", "grade", "department", "owner"])
    return employee


@router.delete("/{employee_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_employee(employee_id: int, session: SessionDep, current_user: MutatorUser):
    employee = await _load_employee(session, employee_id, current_user)
    if employee.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Нет прав на удаление")
    await session.delete(employee)
    await session.commit()


async def _validate_owned_department(
    session, department_id: int | None, current_user
) -> int | None:
    """Принимает department_id или None. Если задан — проверяет, что отдел
    принадлежит текущему пользователю. Возвращает валидированный id."""
    if department_id is None:
        return None
    dept = await session.get(Department, department_id)
    if dept is None or dept.owner_id != current_user.id:
        raise HTTPException(
            status_code=400,
            detail="Отдел не найден или принадлежит другому руководителю",
        )
    return department_id


@router.post("/import-xlsx/preview", response_model=EmployeeImportPreview)
async def preview_import_xlsx(
    file: UploadFile,
    session: SessionDep,
    current_user: MutatorUser,
    department_id: int | None = Form(default=None),
):
    """Парсит Excel-файл и возвращает preview без записи в БД.

    Ожидаемый формат: заголовки в первой строке, дальше — данные.
    Поля, которые мы умеем распознавать:
    ФИО, Email, Должность, Основной профиль роли, Стаж работы, Навыки.

    `department_id` — отдел текущего DH, к которому будут привязаны все
    импортируемые сотрудники (в Excel не парсится).

    Дедуп: сотрудники с уже занятым email (или ФИО без email) у текущего DH
    получают `action='skip'`.
    """
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Ожидается файл .xlsx")
    dept_id = await _validate_owned_department(session, department_id, current_user)
    content = await file.read()
    try:
        rows = await parse_xlsx(content, session, owner_id=current_user.id, department_id=dept_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return EmployeeImportPreview(
        total_rows=len(rows),
        to_create=sum(1 for r in rows if r.action == "create"),
        to_skip=sum(1 for r in rows if r.action == "skip"),
        errors=sum(1 for r in rows if r.action == "error"),
        rows=rows,
    )


@router.post("/import-xlsx/commit", response_model=EmployeeImportResult)
async def commit_import_xlsx(
    payload: EmployeeImportCommit,
    session: SessionDep,
    current_user: MutatorUser,
):
    """Создать сотрудников из preview. UI присылает только строки,
    которые пользователь хочет создать (`action='create'`)."""
    # Любой department_id в строках должен принадлежать current_user.
    dept_ids = {r.department_id for r in payload.rows if r.department_id is not None}
    if dept_ids:
        owned_q = await session.execute(
            select(Department.id).where(
                Department.id.in_(dept_ids), Department.owner_id == current_user.id
            )
        )
        owned = {did for (did,) in owned_q.all()}
        bad = dept_ids - owned
        if bad:
            raise HTTPException(
                status_code=400,
                detail=f"Отделы {sorted(bad)} вам не принадлежат",
            )

    created = 0
    skipped = 0
    errors: list[str] = []
    new_employees: list[Employee] = []
    for r in payload.rows:
        if r.action != "create":
            skipped += 1
            continue
        if not r.full_name:
            errors.append(f"строка {r.row}: пустое ФИО")
            continue
        emp = Employee(
            full_name=r.full_name.strip(),
            email=(r.email or "").strip() or None,
            position=(r.position or "").strip() or None,
            owner_id=current_user.id,
            department_id=r.department_id,
            hired_at=r.hired_at,
            kind="employee",
        )
        session.add(emp)
        new_employees.append(emp)
        created += 1
    await session.commit()
    # all-time синк проектов для всех новеньких в фоне (ARQ-очередь).
    await _enqueue_codebuddy_sync(session, [e.id for e in new_employees], all_time=True)
    return EmployeeImportResult(created=created, skipped=skipped, errors=errors)


@router.get("/{employee_id}/mpk-profile", response_model=MpkProfile)
async def mpk_profile(employee_id: int, session: SessionDep, current_user: CurrentUser):
    employee = await _get_owned_employee(session, employee_id, current_user)

    # Итоговый уровень по компетенции = самая свежая score по ней во всей истории оценок.
    # Это позволяет оценивать МПК частями на нескольких встречах — каждая компетенция
    # берёт свой самый актуальный уровень. Если компетенцию переоценили — побеждает новая.
    current_q = await session.execute(
        select(AssessmentScore.competency_id, AssessmentScore.level)
        .join(Assessment, Assessment.id == AssessmentScore.assessment_id)
        .where(Assessment.employee_id == employee.id)
        .order_by(
            AssessmentScore.competency_id,
            Assessment.assessed_at.desc(),
            Assessment.id.desc(),
        )
        .distinct(AssessmentScore.competency_id)
    )
    current_by_comp: dict[int, int] = {cid: lvl for cid, lvl in current_q.all()}

    # Шапка профиля показывает дату последней по времени оценки как "последнее обновление".
    last_q = await session.execute(
        select(Assessment)
        .where(Assessment.employee_id == employee.id)
        .order_by(Assessment.assessed_at.desc(), Assessment.id.desc())
        .limit(1)
    )
    last_assessment = last_q.scalar_one_or_none()

    required_by_comp: dict[int, int] = {}
    if employee.role_id and employee.grade_id:
        prof_q = await session.execute(
            select(RoleProfile).where(
                RoleProfile.role_id == employee.role_id,
                RoleProfile.grade_id == employee.grade_id,
            )
        )
        for p in prof_q.scalars():
            required_by_comp[p.competency_id] = p.required_level

    comps_q = await session.execute(
        select(Competency).order_by(Competency.sort_order, Competency.id)
    )
    items: list[MpkProfileItem] = []
    for c in comps_q.scalars():
        cur = current_by_comp.get(c.id)
        req = required_by_comp.get(c.id)
        # Если оценки нет — gap неизвестен. Без оценки мы не знаем фактический
        # уровень, поэтому не выдаём отрицательную дельту "+req".
        gap = (req - cur) if (req is not None and cur is not None) else None
        items.append(
            MpkProfileItem(
                competency_id=c.id,
                competency_name=c.name,
                sort_order=c.sort_order,
                current_level=cur,
                required_level=req,
                gap=gap,
            )
        )

    return MpkProfile(
        items=items,
        last_assessment=(
            MpkProfileAssessmentRef(
                id=last_assessment.id, assessed_at=str(last_assessment.assessed_at)
            )
            if last_assessment
            else None
        ),
        role=RolePublic.model_validate(employee.role) if employee.role else None,
        grade=GradePublic.model_validate(employee.grade) if employee.grade else None,
    )


@router.get(
    "/{employee_id}/projects",
    response_model=list[EmployeeProjectHistoryItem],
)
async def employee_projects(employee_id: int, session: SessionDep, current_user: CurrentUser):
    """История продуктов сотрудника: текущие (left_at IS NULL) + завершённые.
    Сортировка: текущие первыми (по joined_at desc), затем прошлые (по left_at desc).
    """
    from app.models.project import Product, ProductMember

    await _get_owned_employee(session, employee_id, current_user)

    q = await session.execute(
        select(ProductMember, Product)
        .join(Product, Product.id == ProductMember.product_id)
        .where(ProductMember.employee_id == employee_id)
    )
    rows = list(q.all())

    items = [
        EmployeeProjectHistoryItem(
            product_id=p.id,
            product_name=p.name,
            product_status=p.status,
            gitlab_group=p.gitlab_group,
            role_in_project=m.role_in_project,
            joined_at=m.joined_at,
            left_at=(
                m.left_at
                if m.left_at is not None
                else (p.finished_at if p.status == "completed" else None)
            ),
            rotation_locked=m.rotation_locked,
            rotation_lock_note=m.rotation_lock_note,
            is_current=m.left_at is None and p.status != "completed",
        )
        for m, p in rows
    ]
    # Сортировка: сначала текущие по joined_at desc, потом прошедшие по left_at desc
    items.sort(
        key=lambda i: (
            0 if i.is_current else 1,
            -(i.joined_at.toordinal() if i.is_current and i.joined_at else 0),
            -(i.left_at.toordinal() if (not i.is_current) and i.left_at else 0),
        )
    )
    return items


@router.get("/{employee_id}/mpk-history", response_model=MpkHistory)
async def mpk_history(employee_id: int, session: SessionDep, current_user: CurrentUser):
    await _get_owned_employee(session, employee_id, current_user)

    q = await session.execute(
        select(
            Assessment.assessed_at,
            AssessmentScore.competency_id,
            Competency.name,
            Competency.sort_order,
            AssessmentScore.level,
        )
        .join(AssessmentScore, AssessmentScore.assessment_id == Assessment.id)
        .join(Competency, Competency.id == AssessmentScore.competency_id)
        .where(Assessment.employee_id == employee_id)
        .order_by(Competency.sort_order, Competency.id, Assessment.assessed_at)
    )

    by_comp: dict[int, HistoryCompetency] = {}
    for assessed_at, comp_id, name, sort_order, level in q.all():
        if comp_id not in by_comp:
            by_comp[comp_id] = HistoryCompetency(
                competency_id=comp_id,
                name=name,
                sort_order=sort_order,
                points=[],
            )
        by_comp[comp_id].points.append(HistoryPoint(assessed_at=assessed_at, level=level))

    return MpkHistory(competencies=list(by_comp.values()))
