"""Поручения (assignments) — задачи с дедлайном и опциональным вложением.

Создатель (User) ставит поручение на User (как правило, руководителя)
либо на Employee (своего сотрудника). Видеть и менять статус — обе стороны.
Менять основные поля и удалять — только создатель.
"""

from datetime import UTC, datetime
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import or_, select

from app.api.deps import (
    CurrentUser,
    SessionDep,
    is_core_team,
    is_department_head,
)
from app.models.assignment import Assignment
from app.models.employee import Employee
from app.models.user import User
from app.notifications.service import publish_pending, record_notifications
from app.schemas.assignment import (
    AssigneeRef,
    AssignmentCreate,
    AssignmentListItem,
    AssignmentPublic,
    AssignmentStatus,
    AssignmentUpdate,
)

router = APIRouter(prefix="/assignments", tags=["assignments"])

ATTACH_MAX_BYTES = 20 * 1024 * 1024  # 20 МБ


# ---------- helpers ----------


async def _build_assignee_ref(session, a: Assignment) -> AssigneeRef:
    if a.assignee_user_id is not None:
        u = await session.get(User, a.assignee_user_id)
        return AssigneeRef(
            kind="user",
            id=a.assignee_user_id,
            full_name=u.full_name if u else "—",
        )
    emp = await session.get(Employee, a.assignee_employee_id) if a.assignee_employee_id else None
    return AssigneeRef(
        kind="employee",
        id=a.assignee_employee_id or 0,
        full_name=emp.full_name if emp else "—",
    )


async def _to_public(session, a: Assignment) -> AssignmentPublic:
    creator = await session.get(User, a.created_by_id)
    assignee = await _build_assignee_ref(session, a)
    return AssignmentPublic(
        id=a.id,
        title=a.title,
        description_md=a.description_md,
        due_at=a.due_at,
        status=a.status,
        completed_at=a.completed_at,
        created_by_id=a.created_by_id,
        created_by_name=creator.full_name if creator else None,
        assignee=assignee,
        has_attachment=a.attachment_data is not None,
        attachment_filename=a.attachment_filename,
        attachment_size_bytes=a.attachment_size_bytes,
        attachment_uploaded_at=a.attachment_uploaded_at,
        created_at=a.created_at,
        updated_at=a.updated_at,
    )


async def _to_list_item(session, a: Assignment) -> AssignmentListItem:
    creator = await session.get(User, a.created_by_id)
    assignee = await _build_assignee_ref(session, a)
    return AssignmentListItem(
        id=a.id,
        title=a.title,
        due_at=a.due_at,
        status=a.status,
        created_by_id=a.created_by_id,
        created_by_name=creator.full_name if creator else None,
        assignee=assignee,
        has_attachment=a.attachment_data is not None,
        completed_at=a.completed_at,
        created_at=a.created_at,
    )


def _can_assign_to_employee(user: User, employee: Employee) -> bool:
    """Кто может поручать сотруднику:
    • CoreTeam — любому;
    • руководитель отдела — только своему (employee.owner_id == self.id).
    """
    if is_core_team(user):
        return True
    if is_department_head(user) and employee.owner_id == user.id:
        return True
    return False


def _can_assign_to_user(_actor: User, _target: User) -> bool:
    """Поручение пользователю — может ставить любой авторизованный (актёр
    отвечает за уместность). PM-роль явно запрещаем для упрощения."""
    return True


def _can_view(actor: User, a: Assignment) -> bool:
    """Видеть могут: CoreTeam, создатель, адресат-User, владелец Employee-адресата."""
    if is_core_team(actor):
        return True
    if a.created_by_id == actor.id:
        return True
    if a.assignee_user_id == actor.id:
        return True
    return False


async def _assignee_employee_owner_id(session, a: Assignment) -> int | None:
    if a.assignee_employee_id is None:
        return None
    emp = await session.get(Employee, a.assignee_employee_id)
    return emp.owner_id if emp else None


async def _assignee_notify_targets(session, a: Assignment) -> list[int]:
    """Кому слать уведомление как 'адресату' поручения.
    Если адресат — User, ему. Если Employee — его руководителю (owner)."""
    if a.assignee_user_id is not None:
        return [a.assignee_user_id]
    owner_id = await _assignee_employee_owner_id(session, a)
    return [owner_id] if owner_id else []


def _assignee_label(a: Assignment, employee_name: str | None = None) -> str:
    """Краткая подпись адресата для уведомления-заголовка."""
    if a.assignee_user_id is not None:
        return "вам"
    return f"сотруднику «{employee_name or 'без имени'}»"


async def _can_view_async(session, actor: User, a: Assignment) -> bool:
    if _can_view(actor, a):
        return True
    owner_id = await _assignee_employee_owner_id(session, a)
    return owner_id == actor.id


def _can_edit(actor: User, a: Assignment) -> bool:
    """Менять описание/срок/удалять — только создатель."""
    return a.created_by_id == actor.id


def _is_assignee_actor(actor: User, a: Assignment, owner_id: int | None) -> bool:
    """Является ли actor адресатом-User или владельцем Employee-адресата."""
    if a.assignee_user_id == actor.id:
        return True
    return owner_id is not None and owner_id == actor.id


# Допустимые переходы статусов: для каждой роли набор (from → to).
# Адресат может только заявить выполнение — подтверждает инициатор.
_ASSIGNEE_TRANSITIONS = {
    ("open", "in_progress"),
    ("in_progress", "pending_review"),
    # из открытого можно сразу заявить выполнение (минуя in_progress)
    ("open", "pending_review"),
    # пока инициатор не глянул — можно отозвать «выполнено» обратно в работу
    ("pending_review", "in_progress"),
}

_CREATOR_TRANSITIONS = {
    # подтверждение / отклонение выполнения
    ("pending_review", "done"),
    ("pending_review", "in_progress"),
    # переоткрыть закрытое
    ("done", "open"),
    ("done", "in_progress"),
    # инициатор может перевести в работу/закрыть и вручную
    ("open", "in_progress"),
    ("in_progress", "open"),
    # отмена — из любого активного
    ("open", "cancelled"),
    ("in_progress", "cancelled"),
    ("pending_review", "cancelled"),
    # переоткрыть отменённое
    ("cancelled", "open"),
}


def _validate_status_transition(
    actor: User,
    a: Assignment,
    owner_id: int | None,
    new_status: str,
) -> None:
    """Бросает 403/400 если переход запрещён."""
    if a.status == new_status:
        return
    transition = (a.status, new_status)
    is_creator = a.created_by_id == actor.id
    is_assignee = _is_assignee_actor(actor, a, owner_id)

    if is_creator and transition in _CREATOR_TRANSITIONS:
        return
    if is_assignee and transition in _ASSIGNEE_TRANSITIONS:
        return

    if not (is_creator or is_assignee):
        raise HTTPException(status_code=403, detail="Нет прав менять статус")
    raise HTTPException(
        status_code=400,
        detail=(
            f"Переход {a.status} → {new_status} недопустим для вашей роли. "
            "Подсказка: подтверждать выполнение может только инициатор."
        ),
    )


# ---------- endpoints ----------


@router.get("", response_model=list[AssignmentListItem])
async def list_assignments(
    session: SessionDep,
    current_user: CurrentUser,
    scope: str = Query(default="assigned", pattern="^(created|assigned|all)$"),
    status_filter: AssignmentStatus | None = Query(default=None, alias="status"),
):
    """Список поручений.
    `scope=assigned` (default) — те, что назначены на меня (как User
    или как owner назначенного Employee).
    `scope=created` — те, что я создал.
    `scope=all` — только для CoreTeam, видит всё.
    """
    if scope == "all" and not is_core_team(current_user):
        raise HTTPException(status_code=403, detail="scope=all только для CoreTeam")

    stmt = select(Assignment).order_by(Assignment.created_at.desc())
    if status_filter is not None:
        stmt = stmt.where(Assignment.status == status_filter)

    if scope == "created":
        stmt = stmt.where(Assignment.created_by_id == current_user.id)
    elif scope == "assigned":
        # Adressee = User-self OR owner-of-Employee = self
        emp_owned = (
            select(Employee.id).where(Employee.owner_id == current_user.id)
        ).scalar_subquery()
        stmt = stmt.where(
            or_(
                Assignment.assignee_user_id == current_user.id,
                Assignment.assignee_employee_id.in_(emp_owned),
            )
        )
    # scope == 'all' и так без фильтра

    rows = (await session.execute(stmt)).scalars().all()
    return [await _to_list_item(session, a) for a in rows]


@router.post("", response_model=AssignmentPublic, status_code=status.HTTP_201_CREATED)
async def create_assignment(
    payload: AssignmentCreate, session: SessionDep, current_user: CurrentUser
):
    # проверка адресата
    if payload.assignee_user_id is not None:
        target = await session.get(User, payload.assignee_user_id)
        if target is None or not target.is_active:
            raise HTTPException(status_code=400, detail="Адресат-пользователь не найден")
        if not _can_assign_to_user(current_user, target):
            raise HTTPException(status_code=403, detail="Нет прав поручать этому пользователю")
    else:
        emp = await session.get(Employee, payload.assignee_employee_id)
        if emp is None:
            raise HTTPException(status_code=400, detail="Адресат-сотрудник не найден")
        if not _can_assign_to_employee(current_user, emp):
            raise HTTPException(
                status_code=403,
                detail="Нет прав поручать этому сотруднику (только свой)",
            )

    a = Assignment(
        title=payload.title.strip(),
        description_md=(payload.description_md or "").strip() or None,
        due_at=payload.due_at,
        status="open",
        created_by_id=current_user.id,
        assignee_user_id=payload.assignee_user_id,
        assignee_employee_id=payload.assignee_employee_id,
    )
    session.add(a)
    await session.flush()  # получить a.id для link

    # Уведомление адресату (или владельцу адресата-сотрудника)
    targets = await _assignee_notify_targets(session, a)
    emp_name = None
    if a.assignee_employee_id:
        emp = await session.get(Employee, a.assignee_employee_id)
        emp_name = emp.full_name if emp else None
    body_target = "вам" if a.assignee_user_id is not None else f"сотруднику «{emp_name}»"
    notifs = await record_notifications(
        session,
        recipient_user_ids=targets,
        kind="assignment_created",
        title=f"Новое поручение {body_target}: «{a.title}»",
        body=f"От {current_user.full_name}",
        link=f"/assignments?id={a.id}",
        payload={"assignment_id": a.id},
        exclude_user_ids=[current_user.id],  # себя не уведомляем
    )

    await session.commit()
    await session.refresh(a)
    await publish_pending(notifs)
    return await _to_public(session, a)


@router.get("/{assignment_id}", response_model=AssignmentPublic)
async def get_assignment(assignment_id: int, session: SessionDep, current_user: CurrentUser):
    a = await session.get(Assignment, assignment_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Поручение не найдено")
    if not await _can_view_async(session, current_user, a):
        raise HTTPException(status_code=404, detail="Поручение не найдено")
    return await _to_public(session, a)


@router.patch("/{assignment_id}", response_model=AssignmentPublic)
async def update_assignment(
    assignment_id: int,
    payload: AssignmentUpdate,
    session: SessionDep,
    current_user: CurrentUser,
):
    a = await session.get(Assignment, assignment_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Поручение не найдено")
    if not await _can_view_async(session, current_user, a):
        raise HTTPException(status_code=404, detail="Поручение не найдено")
    owner_id = await _assignee_employee_owner_id(session, a)
    is_creator = _can_edit(current_user, a)
    prev_status = a.status

    data = payload.model_dump(exclude_unset=True)
    # status — допускается только определённый набор переходов
    if "status" in data:
        new_status: AssignmentStatus = data["status"]
        _validate_status_transition(current_user, a, owner_id, new_status)
        if a.status != new_status:
            a.status = new_status
            # completed_at фиксируем только когда инициатор подтвердил done
            if new_status == "done" and a.completed_at is None:
                a.completed_at = datetime.now(UTC)
            elif new_status != "done":
                a.completed_at = None
    # остальные поля — только создатель
    other = {k: v for k, v in data.items() if k != "status"}
    if other:
        if not is_creator:
            raise HTTPException(
                status_code=403, detail="Менять описание/срок может только создатель"
            )
        for k, v in other.items():
            if isinstance(v, str):
                v = v.strip() or None
            setattr(a, k, v)

    # Уведомления на статусных переходах
    notifs = []
    if prev_status != a.status:
        link = f"/assignments?id={a.id}"
        actor = current_user.full_name
        if a.status == "pending_review":
            # адресат заявил выполнение → уведомляем инициатора
            notifs = await record_notifications(
                session,
                recipient_user_ids=[a.created_by_id],
                kind="assignment_pending_review",
                title=f"Заявлено выполнение: «{a.title}»",
                body=f"{actor} отметил поручение выполненным — подтвердите или верните на доработку",
                link=link,
                payload={"assignment_id": a.id},
                exclude_user_ids=[current_user.id],
            )
        elif a.status == "done":
            # инициатор подтвердил выполнение → уведомляем адресата
            targets = await _assignee_notify_targets(session, a)
            notifs = await record_notifications(
                session,
                recipient_user_ids=targets,
                kind="assignment_done",
                title=f"Подтверждено выполнение: «{a.title}»",
                body=f"{actor} подтвердил выполнение поручения",
                link=link,
                payload={"assignment_id": a.id},
                exclude_user_ids=[current_user.id],
            )
        elif a.status == "in_progress" and prev_status == "pending_review":
            # инициатор вернул на доработку → уведомляем адресата
            targets = await _assignee_notify_targets(session, a)
            notifs = await record_notifications(
                session,
                recipient_user_ids=targets,
                kind="assignment_returned",
                title=f"Возвращено на доработку: «{a.title}»",
                body=f"{actor} вернул поручение в работу",
                link=link,
                payload={"assignment_id": a.id},
                exclude_user_ids=[current_user.id],
            )
        elif a.status == "cancelled":
            # инициатор отменил → уведомляем адресата
            targets = await _assignee_notify_targets(session, a)
            notifs = await record_notifications(
                session,
                recipient_user_ids=targets,
                kind="assignment_cancelled",
                title=f"Поручение отменено: «{a.title}»",
                body=f"{actor} отменил поручение",
                link=link,
                payload={"assignment_id": a.id},
                exclude_user_ids=[current_user.id],
            )

    await session.commit()
    await session.refresh(a)
    await publish_pending(notifs)
    return await _to_public(session, a)


@router.delete("/{assignment_id}", status_code=204)
async def delete_assignment(assignment_id: int, session: SessionDep, current_user: CurrentUser):
    a = await session.get(Assignment, assignment_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Поручение не найдено")
    if not _can_edit(current_user, a):
        raise HTTPException(status_code=403, detail="Удалять может только создатель")
    await session.delete(a)
    await session.commit()


# ---------- attachment ----------


def _attach_disposition(filename: str) -> str:
    fallback = filename.encode("ascii", "ignore").decode("ascii") or "attachment"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename)}"


@router.post("/{assignment_id}/attachment", response_model=AssignmentPublic)
async def upload_attachment(
    assignment_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    file: UploadFile,
):
    a = await session.get(Assignment, assignment_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Поручение не найдено")
    if not _can_edit(current_user, a):
        raise HTTPException(status_code=403, detail="Загружать вложение может только создатель")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Пустой файл")
    if len(data) > ATTACH_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Файл больше 20 МБ")
    a.attachment_data = data
    a.attachment_filename = file.filename or "attachment"
    a.attachment_content_type = file.content_type or "application/octet-stream"
    a.attachment_size_bytes = len(data)
    a.attachment_uploaded_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(a)
    return await _to_public(session, a)


@router.get("/{assignment_id}/attachment")
async def download_attachment(assignment_id: int, session: SessionDep, current_user: CurrentUser):
    a = await session.get(Assignment, assignment_id)
    if a is None or a.attachment_data is None:
        raise HTTPException(status_code=404, detail="Вложение не найдено")
    if not await _can_view_async(session, current_user, a):
        raise HTTPException(status_code=404, detail="Вложение не найдено")
    return Response(
        content=a.attachment_data,
        media_type=a.attachment_content_type or "application/octet-stream",
        headers={
            "Content-Disposition": _attach_disposition(a.attachment_filename or "attachment"),
        },
    )


@router.delete("/{assignment_id}/attachment", response_model=AssignmentPublic)
async def delete_attachment(assignment_id: int, session: SessionDep, current_user: CurrentUser):
    a = await session.get(Assignment, assignment_id)
    if a is None:
        raise HTTPException(status_code=404, detail="Поручение не найдено")
    if not _can_edit(current_user, a):
        raise HTTPException(status_code=403, detail="Удалять вложение может только создатель")
    a.attachment_data = None
    a.attachment_filename = None
    a.attachment_content_type = None
    a.attachment_size_bytes = None
    a.attachment_uploaded_at = None
    await session.commit()
    await session.refresh(a)
    return await _to_public(session, a)
