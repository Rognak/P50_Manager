"""Безопасная точечная сверка статуса Merge Request через GitLab API."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
import json
from typing import Literal
from urllib.parse import quote, urlparse

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.settings import get_setting
from app.config import settings
from app.redis_pool import get_pool


@dataclass(frozen=True)
class GitLabMrRef:
    project_path: str
    iid: int


@dataclass(frozen=True)
class GitLabConfig:
    base_url: str
    api_token: str
    verify_ssl: bool
    request_timeout: float
    token_source: Literal["admin", "env", "none"] = "none"


def environment_gitlab_config() -> GitLabConfig:
    token = settings.gitlab_api_token.strip()
    return GitLabConfig(
        base_url=settings.gitlab_base_url.strip(),
        api_token=token,
        verify_ssl=settings.gitlab_verify_ssl,
        request_timeout=settings.gitlab_request_timeout,
        token_source="env" if token else "none",
    )


async def resolve_gitlab_config(session: AsyncSession) -> GitLabConfig:
    """Настройка из админ-панели поверх безопасных значений из .env."""
    stored = await get_setting(session, "gitlab")
    env = environment_gitlab_config()
    stored_token = str(stored.get("api_token") or "").strip()
    return GitLabConfig(
        base_url=env.base_url,
        api_token=stored_token or env.api_token,
        verify_ssl=env.verify_ssl,
        request_timeout=env.request_timeout,
        token_source="admin" if stored_token else env.token_source,
    )


class GitLabStatusError(RuntimeError):
    pass


def _mr_ref(raw_url: str, config: GitLabConfig) -> GitLabMrRef:
    configured = urlparse(config.base_url.rstrip("/"))
    supplied = urlparse(raw_url)
    if not config.base_url or not config.api_token:
        raise GitLabStatusError("Прямой доступ к GitLab API не настроен")
    if supplied.scheme not in {"http", "https"} or supplied.netloc != configured.netloc:
        raise GitLabStatusError("Репозиторий находится вне настроенного GitLab")
    marker = "/-/merge_requests/"
    if marker not in supplied.path:
        raise GitLabStatusError("Некорректная ссылка на Merge Request")
    project_path, raw_iid = supplied.path.split(marker, 1)
    try:
        iid = int(raw_iid.strip("/").split("/", 1)[0])
    except ValueError as exc:
        raise GitLabStatusError("Некорректный номер Merge Request") from exc
    return GitLabMrRef(project_path=project_path.strip("/"), iid=iid)


def _api_url(ref: GitLabMrRef, config: GitLabConfig, *, include_mr: bool) -> str:
    base = config.base_url.rstrip("/")
    project = quote(ref.project_path, safe="")
    suffix = f"/merge_requests/{ref.iid}" if include_mr else ""
    return f"{base}/api/v4/projects/{project}{suffix}"


async def _get(url: str, config: GitLabConfig) -> dict:
    try:
        async with httpx.AsyncClient(
            timeout=config.request_timeout,
            verify=config.verify_ssl,
        ) as client:
            response = await client.get(url, headers={"PRIVATE-TOKEN": config.api_token})
    except httpx.HTTPError as exc:
        raise GitLabStatusError("Нет сетевого доступа к GitLab") from exc
    if response.status_code in {401, 403}:
        raise GitLabStatusError("Токен не имеет доступа к репозиторию")
    if response.status_code == 404:
        raise GitLabStatusError("Репозиторий или PR не найден")
    if not response.is_success:
        raise GitLabStatusError(f"GitLab ответил HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise GitLabStatusError("GitLab вернул некорректный ответ") from exc


async def check_repository_access(raw_url: str, config: GitLabConfig | None = None) -> None:
    resolved = config or environment_gitlab_config()
    ref = _mr_ref(raw_url, resolved)
    await _get(_api_url(ref, resolved, include_mr=False), resolved)


async def fetch_merge_request_status(
    raw_url: str, config: GitLabConfig | None = None
) -> tuple[str, datetime | None, datetime]:
    resolved = config or environment_gitlab_config()
    ref = _mr_ref(raw_url, resolved)
    data = await _get(_api_url(ref, resolved, include_mr=True), resolved)
    raw_state = str(data.get("state") or "").casefold()
    state = {"opened": "open", "open": "open", "merged": "merged", "closed": "closed"}.get(
        raw_state, "unknown"
    )
    merged_at = None
    if data.get("merged_at"):
        merged_at = datetime.fromisoformat(str(data["merged_at"]).replace("Z", "+00:00"))
        state = "merged"
    return state, merged_at, datetime.now(UTC)


def _status_cache_key(raw_url: str) -> str:
    return f"gl:mr-status:{sha256(raw_url.encode()).hexdigest()}"


async def cache_merge_request_status(
    raw_url: str, state: str, merged_at: datetime | None, checked_at: datetime
) -> None:
    """Сохранить результат ручной сверки на сутки, чтобы он пережил reload UI."""
    try:
        pool = get_pool()
        await pool.set(
            _status_cache_key(raw_url),
            json.dumps(
                {
                    "state": state,
                    "merged_at": merged_at.isoformat() if merged_at else None,
                    "checked_at": checked_at.isoformat(),
                }
            ),
            ex=24 * 60 * 60,
        )
    except Exception:  # noqa: BLE001 — отсутствие Redis не должно ломать sync
        return


async def cached_merge_request_statuses(raw_urls: list[str]) -> dict[str, str]:
    if not raw_urls:
        return {}
    try:
        pool = get_pool()
        values = await pool.mget([_status_cache_key(url) for url in raw_urls])
    except Exception:  # noqa: BLE001
        return {}
    result: dict[str, str] = {}
    for url, raw in zip(raw_urls, values):
        if raw is None:
            continue
        try:
            value = json.loads(raw.decode() if isinstance(raw, bytes) else raw)
            state = str(value.get("state") or "unknown")
            if state in {"open", "merged", "closed"}:
                result[url] = state
        except (TypeError, ValueError, UnicodeDecodeError):
            continue
    return result
