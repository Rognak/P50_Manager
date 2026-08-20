"""Клиент CodeBuddy External API.

Точки входа:
  • `token_manager`     — кэш токенов Keycloak (client_credentials).
  • `codebuddy_client`  — низкоуровневый HTTP-клиент (GET/POST).
  • `codebuddy_service` — высокий уровень: DTO→domain маппинг + Redis-кэш.
  • `resolve_gitlab_username(employee)` — резолв P50.Employee → CodeBuddy.username.
"""

from app.codebuddy.auth import token_manager
from app.codebuddy.client import codebuddy_client
from app.codebuddy.identity import (
    derive_gitlab_username,
    resolve_gitlab_username,
)
from app.codebuddy.service import codebuddy_service

__all__ = [
    "codebuddy_client",
    "codebuddy_service",
    "derive_gitlab_username",
    "resolve_gitlab_username",
    "token_manager",
]
