"""Identity-mapping для CodeBuddy.

CodeBuddy опорный ключ — `username` (GitLab login, lowercase, обычно
`familia_inicialy`). У нас в системе сотрудник идентифицируется внутренним
`id` + опционально `email`.

Резолв:
  1. Если `Employee.gitlab_username` задан явно — используем его.
  2. Иначе пробуем derive из `email` (правило: prefix до `@`, lowercase,
     точки → подчёркивания). Пример: `demo.user@example.com`
     → `demo_user`.
  3. Если email пуст или невалиден — `None` (сотрудник не сопоставлен с
     CodeBuddy, UI помечает «не сопоставлен»).

`derive_gitlab_username` — pure-функция, используется отдельно для
показа в UI «предполагаемый username» (когда поле в БД пустое).
"""
from __future__ import annotations

import re

from app.models.employee import Employee

# Username в GitLab/CodeBuddy: latin lowercase + цифры + `_`/`-`/`.`
# `=`, пробелы и кириллица — не пропускаем (значит email-prefix битый).
_VALID_USERNAME = re.compile(r"^[a-z0-9._-]{2,100}$")


def derive_gitlab_username(email: str | None) -> str | None:
    """Получить CodeBuddy username из email.

    Пример: `demo.user@example.com` → `demo_user`.
    Если email невалиден — None.
    """
    if not email:
        return None
    email = email.strip()
    if "@" not in email:
        return None
    prefix = email.split("@", 1)[0].strip()
    if not prefix:
        return None
    # lowercase + точки → подчёркивания
    candidate = prefix.lower().replace(".", "_")
    if not _VALID_USERNAME.match(candidate):
        return None
    return candidate


def resolve_gitlab_username(employee: Employee) -> str | None:
    """Получить CodeBuddy username сотрудника: явное поле → derive из email."""
    if employee.gitlab_username:
        return employee.gitlab_username.strip().lower() or None
    return derive_gitlab_username(employee.email)
