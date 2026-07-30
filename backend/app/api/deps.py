from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_access_token
from app.db import get_session
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

SessionDep = Annotated[AsyncSession, Depends(get_session)]
TokenDep = Annotated[str, Depends(oauth2_scheme)]


async def get_current_user(session: SessionDep, token: TokenDep) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Не удалось проверить учётные данные",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        raise credentials_exc

    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_exc
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


# ---------- role helpers ----------


def is_core_team(user: User) -> bool:
    return user.role == "core_team"


def is_product_manager(user: User) -> bool:
    return user.role == "manager"


def is_department_head(user: User) -> bool:
    return user.role == "department_head"


def is_read_only(user: User) -> bool:
    """Может только читать. Сейчас это core_team."""
    return user.role == "core_team"


def can_view_employee_owned_by(user: User, owner_id: int) -> bool:
    """core_team видит чужие данные; обычный пользователь — только свои.
    Менеджер продукта не имеет своих сотрудников, поэтому видит только тех,
    кто в его проектах — но эта проверка делается отдельно."""
    return is_core_team(user) or owner_id == user.id


async def require_mutator(current_user: CurrentUser) -> User:
    """Зависимость для мутирующих эндпоинтов: запрещает core_team."""
    if is_read_only(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CoreTeam-доступ только на чтение",
        )
    return current_user


MutatorUser = Annotated[User, Depends(require_mutator)]


async def require_admin(current_user: CurrentUser) -> User:
    """Зависимость для админ-эндпоинтов: требует User.is_admin=True."""
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ только для администраторов",
        )
    return current_user


AdminUser = Annotated[User, Depends(require_admin)]


def effective_owner_id(current_user: User, manager_id: int | None) -> int | None:
    """Какого владельца смотрит дашборд / список:
      • non-core-team: всегда сам себя, manager_id игнорируется;
      • core_team   : manager_id (None — значит «никто не выбран» → empty).
    """
    if is_core_team(current_user):
        return manager_id
    return current_user.id
