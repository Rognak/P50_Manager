from typing import Literal

from pydantic import BaseModel, ConfigDict

UserRole = Literal["department_head", "manager", "core_team"]


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    role: UserRole
    is_admin: bool = False


class UserMe(UserPublic):
    """Расширенная версия для /auth/me: добавляет nav_visibility-карту,
    чтобы UI знал, какие разделы показывать в сайдбаре, и список внешних
    ссылок для шапки сайдбара."""

    nav_visibility: dict[str, bool] = {}
    external_links: list[dict[str, str]] = []
