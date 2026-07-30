from fastapi import APIRouter
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import CurrentUser, SessionDep
from app.models.employee import Employee
from app.models.user import User
from app.schemas.project import EmployeeSearchItem

router = APIRouter(tags=["employees-search"])


@router.get("/employees-search", response_model=list[EmployeeSearchItem])
async def search_employees(
    session: SessionDep,
    current_user: CurrentUser,
    q: str = "",
    limit: int = 20,
):
    """Поиск сотрудников среди ВСЕХ руководителей — для добавления в проект.
    Возвращает только публичные поля. Без q возвращает первые limit."""
    qry = (
        select(Employee, User.full_name)
        .options(selectinload(Employee.role), selectinload(Employee.grade))
        .join(User, User.id == Employee.owner_id)
        .where(Employee.kind == "employee")
    )
    if q.strip():
        like = f"%{q.strip()}%"
        qry = qry.where(or_(Employee.full_name.ilike(like), Employee.email.ilike(like)))
    qry = qry.order_by(Employee.full_name).limit(min(max(limit, 1), 50))
    rows = (await session.execute(qry)).all()
    return [
        EmployeeSearchItem(
            id=emp.id,
            full_name=emp.full_name,
            role_name=emp.role.name if emp.role else None,
            grade_code=emp.grade.code if emp.grade else None,
            owner_id=emp.owner_id,
            owner_name=owner_name,
            is_yours=emp.owner_id == current_user.id,
        )
        for emp, owner_name in rows
    ]
