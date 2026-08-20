"""Извлечение текста из резюме (DOCX/PDF) для AI.

DOCX — через mammoth (тот же стек, что и self-review).
PDF — через pypdf, который тянем из transitive-deps. Если нет — фолбэк
на pdfminer.six нет, чтобы не плодить зависимости; кандидат сможет загрузить
DOCX вместо PDF, или PDF, который успешно прочтётся pypdf.
"""

import io


def extract_resume_text(blob: bytes, content_type: str | None, filename: str) -> str:
    name = (filename or "").lower()
    is_pdf = name.endswith(".pdf") or (content_type or "").lower() == "application/pdf"
    is_docx = name.endswith(".docx") or "wordprocessingml" in (content_type or "").lower()

    if is_docx:
        import mammoth

        with io.BytesIO(blob) as buf:
            return (mammoth.extract_raw_text(buf).value or "").strip()

    if is_pdf:
        try:
            from pypdf import PdfReader  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "Нет библиотеки для PDF (pypdf). Загрузите резюме в формате .docx."
            ) from e
        reader = PdfReader(io.BytesIO(blob))
        parts: list[str] = []
        for page in reader.pages:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n\n".join(p.strip() for p in parts if p and p.strip())

    raise RuntimeError("Поддерживаются только .docx и .pdf")
