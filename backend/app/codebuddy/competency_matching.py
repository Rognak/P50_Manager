"""Связка `competency.top_signals` ↔ `PR.feature_keys`.

CodeBuddy в `/developers/{u}/competencies` возвращает несколько разных типов
signals на каждую компетенцию:

  • `feature_key` — точный feature_key (`react.useState`).
  • `feature_prefix` — обрезанный префикс (`react.`, `ts.`).
  • `feature_category` — категория из feature-catalog (`modern_syntax`,
    `async`, `react_core`).
  • `language_group` — группа языка (`python`, `frontend`, `dotnet`).
  • `comment_category` — категория AI-комментариев (`style`, `documentation`)
    — НЕ связана с feature_keys PR.

Для `feature_category` и `language_group` нужно разрешать в set реальных
`feature_keys` через `/feature-catalog`. Этот модуль делает это.
"""

from __future__ import annotations


def build_catalog_index(catalog: dict) -> dict[str, dict[str, set[str]]]:
    """Индексы по catalog: {category → set(featureKey)} и {language → set(featureKey)}."""
    feats = catalog.get("features") or []
    by_category: dict[str, set[str]] = {}
    by_language: dict[str, set[str]] = {}
    for f in feats:
        fk = f.get("featureKey")
        if not fk:
            continue
        cat = f.get("category")
        if cat:
            by_category.setdefault(cat, set()).add(fk)
        lang = f.get("language")
        if lang:
            by_language.setdefault(lang, set()).add(fk)
    return {"by_category": by_category, "by_language": by_language}


# Эвристика: CodeBuddy /competencies использует group-имена, которые не
# 1-в-1 совпадают с language из catalog (csharp/python/typescript/tsx/any).
_LANGUAGE_GROUP_EXPAND: dict[str, list[str]] = {
    "python": ["python"],
    "frontend": ["typescript", "tsx"],
    "backend": ["csharp", "python"],
    "dotnet": ["csharp"],
    "csharp": ["csharp"],
    "typescript": ["typescript", "tsx"],
    "tsx": ["tsx"],
    "any": ["any"],
}


def _signal_prefix_match(signal: str, feature_key: str) -> bool:
    """Fallback для signal_type=feature_key/feature_prefix (без catalog)."""
    if not signal or not feature_key:
        return False
    s = signal.lower()
    fk = feature_key.lower()
    if s == fk:
        return True
    if s.endswith(".") and fk.startswith(s):
        return True
    if fk.startswith(s + ".") or fk.startswith(s + "_"):
        return True
    if s.startswith(fk + ".") or s.startswith(fk + "_"):
        return True
    return False


def resolve_signal_to_feature_keys(
    signal: str,
    signal_type: str,
    idx: dict[str, dict[str, set[str]]],
) -> set[str] | None:
    """Возвращает множество feature_keys, покрываемых signal через catalog.
    None — если для этого типа catalog не помогает (fallback на prefix-match).
    Пустое множество — signal не связан с feature_keys (например comments).
    """
    if signal_type == "feature_category":
        return idx["by_category"].get(signal, set())
    if signal_type == "language_group":
        langs = _LANGUAGE_GROUP_EXPAND.get(signal, [signal])
        out: set[str] = set()
        for lang in langs:
            out |= idx["by_language"].get(lang, set())
        return out
    if signal_type == "comment_category":
        return set()  # сигналы про комментарии, не про feature_keys
    return None  # feature_key / feature_prefix → fallback на prefix-match


def pr_matches_signals(
    pr_feature_keys: list[str],
    signals: list[tuple[str, str]],
    catalog_idx: dict[str, dict[str, set[str]]],
) -> bool:
    """True, если хотя бы один signal покрывает хотя бы один feature_key PR.

    signals: список `(signal_name, signal_type)`.
    """
    if not pr_feature_keys:
        return False
    fk_set = set(pr_feature_keys)
    for sig, sig_type in signals:
        resolved = resolve_signal_to_feature_keys(sig, sig_type, catalog_idx)
        if resolved is not None:
            if fk_set & resolved:
                return True
        else:
            for fk in pr_feature_keys:
                if _signal_prefix_match(sig, fk):
                    return True
    return False
