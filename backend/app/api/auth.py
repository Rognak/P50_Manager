from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select

from app.admin.settings import (
    get_external_links,
    get_nav_visibility,
    is_nav_visible_for_role,
)
from app.api.deps import CurrentUser, SessionDep
from app.core.security import create_access_token, verify_password
from app.models.user import User
from app.schemas.auth import Token
from app.schemas.user import UserMe, UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=Token)
async def login(
    session: SessionDep,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
) -> Token:
    q = await session.execute(select(User).where(User.email == form_data.username.lower()))
    user = q.scalar_one_or_none()
    if user is None or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    return Token(access_token=create_access_token(user.id))


# Список nav-ключей известных UI. Дублируется с api.admin.NAV_KEYS, чтобы не
# создавать круговой import (auth → admin → settings).
_NAV_KEYS = [
    "dashboard",
    "employees",
    "projects",
    "departments",
    "assignments",
    "rotations",
    "self_review",
    "hiring",
    "vacancies",
    "mpk_reference",
]


@router.get("/me", response_model=UserMe)
async def me(session: SessionDep, current_user: CurrentUser) -> UserMe:
    """Профиль + карта видимости nav + внешние ссылки для шапки (один round-trip)."""
    visibility = await get_nav_visibility(session)
    nav: dict[str, bool] = {
        k: is_nav_visible_for_role(k, current_user.role, visibility)
        for k in _NAV_KEYS
    }
    links = await get_external_links(session)
    return UserMe(
        **UserPublic.model_validate(current_user).model_dump(),
        nav_visibility=nav,
        external_links=links,
    )
