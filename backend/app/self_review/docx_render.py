"""DOCX → HTML и DOCX → plain text через mammoth.

`docx-preview` (frontend) даёт лучший pixel-perfect рендер на простых документах,
но падает на сложных таблицах (узкие колонки, фигурные размеры). Mammoth выдаёт
аккуратный семантический HTML — теряет точные шрифты/поля, но структура остаётся."""

import io

import mammoth

# Маппинг стилей шаблона Self-Review на читаемые HTML-теги.
STYLE_MAP = """
p[style-name='Title'] => h1.sr-title:fresh
p[style-name='Subtitle'] => p.sr-subtitle:fresh
p[style-name='Heading 1'] => h2.sr-h1:fresh
p[style-name='Heading 2'] => h3.sr-h2:fresh
p[style-name='Heading 3'] => h4.sr-h3:fresh
p[style-name='List Paragraph'] => li:fresh
b => strong
i => em
"""


def render_docx_to_html(blob: bytes) -> str:
    with io.BytesIO(blob) as buf:
        result = mammoth.convert_to_html(buf, style_map=STYLE_MAP)
    return result.value


def extract_docx_text(blob: bytes) -> str:
    with io.BytesIO(blob) as buf:
        result = mammoth.extract_raw_text(buf)
    return result.value or ""
