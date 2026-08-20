"""Список пользователей (руководителей) — нужен для выбора согласующих в ротации.

В программе «для своих» все пользователи равноценны, поэтому фильтра по ролям нет.
Возвращаем активных пользователей, отсортированных по ФИО."""

from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import CurrentUser, SessionDep
from app.models.user import User
from app.schemas.user import UserPublic

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserPublic])
async def list_users(session: SessionDep, _current_user: CurrentUser):
    q = await session.execute(select(User).where(User.is_active.is_(True)).order_by(User.full_name))
    return [UserPublic.model_validate(u) for u in q.scalars()]
