"""Контекст для AI-скрининга кандидата.

Включает:
  • резюме кандидата (текст из .docx),
  • требования вакансии (если задана),
  • информацию о проекте (имя, описание, стек),
  • ожидаемые role/grade (как fallback если вакансии нет),
  • явную философию «сильный инженер > узкоспециальное соответствие».
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.candidate import CandidateProfile
from app.models.employee import Employee
from app.models.mpk import Competency, Grade, Role
from app.models.project import Project, ProjectCompetency
from app.models.vacancy import Vacancy


PHILOSOPHY = (
    "Главный принцип отбора — сильный инженер ВАЖНЕЕ узкоспециального "
    "соответствия. Мы ищем глубину мышления и инженерный кругозор. "
    "Если кандидат работал с Flask, но не с FastAPI — это НЕ проблема. "
    "Если кандидат писал на Java, но не на C# — это тоже НЕ проблема. "
    "Конкретные фреймворки/библиотеки — приятный плюс, но НЕ требование. "
    "Учитывайте: способность быстро разобраться в новом, качество прошлых "
    "решений (архитектура, тестирование, скоупинг), коммуникацию, "
    "продуктовое мышление, уровень самостоятельности. Не отказывайте "
    "из-за «не тот стек» — отказывайте за слабую инженерную базу."
)


async def build_screening_context(
    session: AsyncSession, emp: Employee, prof: CandidateProfile
) -> str:
    lines: list[str] = []
    lines.append("===== ПРИНЦИП ОТБОРА =====")
    lines.append(PHILOSOPHY)
    lines.append("")

    lines.append("===== КАНДИДАТ =====")
    lines.append(f"ФИО: {emp.full_name}")
    lines.append(f"Желаемая должность: {emp.position or '—'}")
    lines.append(f"Источник: {prof.source or '—'}")

    # вакансия и её требования
    vacancy: Vacancy | None = None
    if prof.vacancy_id:
        vacancy = await session.get(Vacancy, prof.vacancy_id)

    role_id = vacancy.role_id if vacancy and vacancy.role_id else prof.expected_role_id
    grade_id = vacancy.grade_id if vacancy and vacancy.grade_id else prof.expected_grade_id

    role_name: str | None = None
    grade_code: str | None = None
    if role_id:
        r = await session.get(Role, role_id)
        role_name = r.name if r else None
    if grade_id:
        g = await session.get(Grade, grade_id)
        grade_code = g.code if g else None
    lines.append(f"Целевая позиция: роль {role_name or '—'}, грейд {grade_code or '—'}")
    lines.append("")

    if vacancy:
        lines.append("===== ВАКАНСИЯ =====")
        lines.append(f"Название: {vacancy.title}")
        if vacancy.requirements_md:
            lines.append("")
            lines.append("===== ТРЕБОВАНИЯ К ПОЗИЦИИ =====")
            lines.append(vacancy.requirements_md[:6000])
            lines.append("")

        # проект, если задан
        if vacancy.project_id:
            proj = await session.get(Project, vacancy.project_id)
            if proj is not None:
                lines.append("===== ПРОЕКТ =====")
                lines.append(f"Название: {proj.name}")
                if proj.code:
                    lines.append(f"Код: {proj.code}")
                if proj.description:
                    lines.append(f"Описание: {proj.description}")
                # стек проекта (как плюс, не требование)
                pc_q = await session.execute(
                    select(ProjectCompetency, Competency)
                    .join(Competency, Competency.id == ProjectCompetency.competency_id)
                    .where(ProjectCompetency.project_id == proj.id)
                    .order_by(ProjectCompetency.target_level.desc())
                )
                stack = list(pc_q.all())
                if stack:
                    lines.append("Тех.стек проекта (плюс, не требование):")
                    for pc, comp in stack[:12]:
                        lines.append(f"  • {comp.name} — целевой L{pc.target_level}")
                lines.append("")
    else:
        lines.append(
            "(Вакансия не привязана — оценивайте по общей инженерной силе и желаемой позиции.)"
        )
        lines.append("")

    lines.append("===== ТЕКСТ РЕЗЮМЕ =====")
    lines.append((prof.resume_text or "(резюме не приложено)")[:15000])

    return "\n".join(lines)
