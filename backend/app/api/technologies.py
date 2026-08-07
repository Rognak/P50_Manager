from datetime import UTC, date, datetime

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, CurrentUser, SessionDep, is_product_manager
from app.models.employee import Employee
from app.models.project import Product
from app.models.technology import (
    Technology,
    TechnologyCategory,
    TechnologyDecision,
    TechnologyLink,
    TechnologyMember,
    TechnologyProduct,
)
from app.schemas.technology import (
    ProductTechnologyPublic,
    EmployeeTechnologyProductRef,
    EmployeeTechnologyPublic,
    TechnologyArchiveCreate,
    TechnologyAttentionFlags,
    TechnologyCategoryPublic,
    TechnologyCreate,
    TechnologyDecisionPublic,
    TechnologyLinkCreate,
    TechnologyLinkPublic,
    TechnologyLinkUpdate,
    TechnologyListItem,
    TechnologyMemberCreate,
    TechnologyMemberPublic,
    TechnologyMemberUpdate,
    TechnologyMetaOption,
    TechnologyMetaResponse,
    TechnologyProductCreate,
    TechnologyProductPublic,
    TechnologyProductUpdate,
    TechnologyPublic,
    TechnologyRef,
    TechnologyRestoreCreate,
    TechnologyReviewCreate,
    TechnologyStatusChange,
    TechnologyUpdate,
)

router = APIRouter(prefix="/technologies", tags=["technologies"])
product_router = APIRouter(prefix="/products", tags=["technologies"])
employee_router = APIRouter(prefix="/employees", tags=["technologies"])

STATUS_OPTIONS = [
    ("adopt", "Adopt"), ("trial", "Trial"),
    ("assess", "Assess"), ("hold", "Hold"),
]
ROLE_OPTIONS = [
    ("leader", "Лидер"), ("expert", "Эксперт"),
    ("practitioner", "Носитель"),
]
USAGE_OPTIONS = [
    ("production", "Production"), ("pilot", "Пилот"),
    ("evaluation", "Оценка"), ("legacy", "Legacy"),
]
LINK_OPTIONS = [
    ("documentation", "Документация"), ("methodology", "Методика"),
    ("guide", "Руководство"), ("course", "Курс"),
    ("community", "Сообщество"), ("source", "Исходный код"),
    ("article", "Статья"), ("other", "Другое"),
]


async def _load_technology(session, technology_id: int, *, active_only: bool = False):
    stmt = select(Technology).where(Technology.id == technology_id)
    if active_only:
        stmt = stmt.where(Technology.is_active.is_(True))
    technology = (await session.execute(stmt)).scalar_one_or_none()
    if technology is None:
        raise HTTPException(status_code=404, detail="Технология не найдена")
    return technology


async def _category(session, category_id: int) -> TechnologyCategory:
    category = await session.get(TechnologyCategory, category_id)
    if category is None or not category.is_active:
        raise HTTPException(status_code=400, detail="Направление не найдено или неактивно")
    return category


async def _replacement(session, technology_id: int | None, self_id: int | None = None):
    if technology_id is None:
        return None
    if technology_id == self_id:
        raise HTTPException(status_code=400, detail="Технология не может заменять саму себя")
    replacement = await session.get(Technology, technology_id)
    if replacement is None:
        raise HTTPException(status_code=400, detail="Технология-замена не найдена")
    return replacement


def _attention(
    technology: Technology,
    leaders: int,
    experts: int,
    active_products: int,
) -> TechnologyAttentionFlags:
    overdue = technology.next_review_at is not None and technology.next_review_at < date.today()
    no_expertise = technology.status in {"adopt", "trial"} and leaders + experts == 0
    hold_active = technology.status == "hold" and active_products > 0
    return TechnologyAttentionFlags(
        overdue_review=overdue,
        no_expertise=no_expertise,
        hold_in_active_products=hold_active,
        has_attention=overdue or no_expertise or hold_active,
    )


async def _list_items(session, technologies: list[Technology]) -> list[TechnologyListItem]:
    if not technologies:
        return []
    ids = [item.id for item in technologies]
    category_ids = {item.category_id for item in technologies}
    categories = {
        c.id: c for c in (
            await session.execute(select(TechnologyCategory).where(TechnologyCategory.id.in_(category_ids)))
        ).scalars()
    }
    member_rows = (
        await session.execute(
            select(
                TechnologyMember.technology_id,
                func.count().filter(TechnologyMember.role == "leader"),
                func.count().filter(TechnologyMember.role == "expert"),
                func.count().filter(TechnologyMember.role == "practitioner"),
            ).where(TechnologyMember.technology_id.in_(ids)).group_by(TechnologyMember.technology_id)
        )
    ).all()
    members = {row[0]: (row[1], row[2], row[3]) for row in member_rows}
    product_rows = (
        await session.execute(
            select(
                TechnologyProduct.technology_id,
                func.count(),
                func.count().filter(Product.status == "active"),
            )
            .join(Product, Product.id == TechnologyProduct.product_id)
            .where(TechnologyProduct.technology_id.in_(ids))
            .group_by(TechnologyProduct.technology_id)
        )
    ).all()
    products = {row[0]: (row[1], row[2]) for row in product_rows}
    replacement_ids = {t.replacement_technology_id for t in technologies if t.replacement_technology_id}
    replacements = {
        t.id: t for t in (
            await session.execute(select(Technology).where(Technology.id.in_(replacement_ids)))
        ).scalars()
    } if replacement_ids else {}
    result = []
    for item in technologies:
        leaders, experts, practitioners = members.get(item.id, (0, 0, 0))
        products_count, active_products = products.get(item.id, (0, 0))
        repl = replacements.get(item.replacement_technology_id)
        result.append(TechnologyListItem(
            id=item.id,
            name=item.name,
            category=TechnologyCategoryPublic.model_validate(categories[item.category_id]),
            status=item.status,
            status_reason_md=item.status_reason_md,
            replacement=(TechnologyRef(id=repl.id, name=repl.name, status=repl.status) if repl else None),
            status_changed_at=item.status_changed_at,
            last_reviewed_at=item.last_reviewed_at,
            next_review_at=item.next_review_at,
            is_active=item.is_active,
            leaders_count=leaders,
            experts_count=experts,
            practitioners_count=practitioners,
            products_count=products_count,
            active_products_count=active_products,
            attention=_attention(item, leaders, experts, active_products),
        ))
    return result


async def _member_publics(session, technology_id: int) -> list[TechnologyMemberPublic]:
    rows = (
        await session.execute(
            select(TechnologyMember, Employee)
            .join(Employee, Employee.id == TechnologyMember.employee_id)
            .options(
                selectinload(Employee.role), selectinload(Employee.grade),
                selectinload(Employee.department),
            )
            .where(TechnologyMember.technology_id == technology_id)
            .order_by(
                case((TechnologyMember.role == "leader", 1), (TechnologyMember.role == "expert", 2), else_=3),
                Employee.full_name,
            )
        )
    ).all()
    return [TechnologyMemberPublic(
        employee_id=employee.id,
        full_name=employee.full_name,
        role_name=employee.role.name if employee.role else None,
        grade_code=employee.grade.code if employee.grade else None,
        department_name=employee.department.name if employee.department else None,
        employee_active=employee.left_at is None,
        role=member.role,
        source=member.source,
        notes=member.notes,
    ) for member, employee in rows]


async def _product_publics(session, technology_id: int) -> list[TechnologyProductPublic]:
    rows = (
        await session.execute(
            select(TechnologyProduct, Product)
            .join(Product, Product.id == TechnologyProduct.product_id)
            .where(TechnologyProduct.technology_id == technology_id)
            .order_by(Product.name)
        )
    ).all()
    return [TechnologyProductPublic(
        product_id=product.id, product_name=product.name, product_status=product.status,
        usage_type=link.usage_type, notes=link.notes,
    ) for link, product in rows]


async def _to_public(session, technology: Technology) -> TechnologyPublic:
    base = (await _list_items(session, [technology]))[0]
    links = list((await session.execute(
        select(TechnologyLink).where(TechnologyLink.technology_id == technology.id)
        .order_by(TechnologyLink.sort_order, TechnologyLink.title)
    )).scalars())
    decisions = list((await session.execute(
        select(TechnologyDecision).where(TechnologyDecision.technology_id == technology.id)
        .order_by(TechnologyDecision.created_at.desc(), TechnologyDecision.id.desc())
    )).scalars())
    return TechnologyPublic(
        **base.model_dump(),
        description_md=technology.description_md,
        members=await _member_publics(session, technology.id),
        products=await _product_publics(session, technology.id),
        links=[TechnologyLinkPublic.model_validate(link) for link in links],
        decisions=[TechnologyDecisionPublic.model_validate(item) for item in decisions],
        created_by=technology.created_by,
        created_at=technology.created_at,
        updated_at=technology.updated_at,
    )


@router.get("/meta", response_model=TechnologyMetaResponse)
async def metadata(session: SessionDep, _current_user: CurrentUser):
    categories = list((await session.execute(
        select(TechnologyCategory).where(TechnologyCategory.is_active.is_(True))
        .order_by(TechnologyCategory.sort_order)
    )).scalars())
    def options(values: list[tuple[str, str]]) -> list[TechnologyMetaOption]:
        return [
            TechnologyMetaOption(value=value, label=label)
            for value, label in values
        ]
    return TechnologyMetaResponse(
        categories=[TechnologyCategoryPublic.model_validate(c) for c in categories],
        statuses=options(STATUS_OPTIONS), member_roles=options(ROLE_OPTIONS),
        usage_types=options(USAGE_OPTIONS), link_kinds=options(LINK_OPTIONS),
    )


@router.get("", response_model=list[TechnologyListItem])
async def list_technologies(
    session: SessionDep, _current_user: CurrentUser,
    q: str | None = None, status_filter: str | None = Query(None, alias="status"),
    category_id: int | None = None, product_id: int | None = None,
    attention_only: bool = False, include_archived: bool = False,
):
    stmt = select(Technology).join(TechnologyCategory)
    if not include_archived:
        stmt = stmt.where(Technology.is_active.is_(True))
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Technology.name.ilike(like), Technology.description_md.ilike(like)))
    if status_filter:
        if status_filter not in dict(STATUS_OPTIONS):
            raise HTTPException(status_code=400, detail="Неизвестный статус")
        stmt = stmt.where(Technology.status == status_filter)
    if category_id is not None:
        stmt = stmt.where(Technology.category_id == category_id)
    if product_id is not None:
        stmt = stmt.join(TechnologyProduct).where(TechnologyProduct.product_id == product_id)
    ring_order = case(
        (Technology.status == "adopt", 1), (Technology.status == "trial", 2),
        (Technology.status == "assess", 3), else_=4,
    )
    technologies = list((await session.execute(
        stmt.order_by(TechnologyCategory.sort_order, ring_order, Technology.name)
    )).scalars().unique())
    items = await _list_items(session, technologies)
    return [item for item in items if not attention_only or item.attention.has_attention]


@router.post("", response_model=TechnologyPublic, status_code=status.HTTP_201_CREATED)
async def create_technology(payload: TechnologyCreate, session: SessionDep, current_user: AdminUser):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Название технологии не может быть пустым")
    await _category(session, payload.category_id)
    await _replacement(session, payload.replacement_technology_id)
    technology = Technology(
        name=name, category_id=payload.category_id, description_md=payload.description_md,
        status=payload.status, status_reason_md=payload.status_reason_md,
        replacement_technology_id=payload.replacement_technology_id,
        next_review_at=payload.next_review_at, created_by=current_user.id,
        updated_by=current_user.id,
    )
    session.add(technology)
    try:
        await session.flush()
        session.add(TechnologyDecision(
            technology_id=technology.id, event_kind="created", from_status=None,
            to_status=technology.status,
            summary_md=(payload.status_reason_md or "Технология добавлена в реестр"),
            next_review_at=payload.next_review_at, created_by=current_user.id,
        ))
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=400, detail="Технология с таким названием уже существует") from exc
    await session.refresh(technology)
    return await _to_public(session, technology)


@router.get("/{technology_id}", response_model=TechnologyPublic)
async def get_technology(technology_id: int, session: SessionDep, _current_user: CurrentUser):
    return await _to_public(
        session,
        await _load_technology(
            session, technology_id, active_only=not _current_user.is_admin
        ),
    )


@router.patch("/{technology_id}", response_model=TechnologyPublic)
async def update_technology(technology_id: int, payload: TechnologyUpdate, session: SessionDep, current_user: AdminUser):
    technology = await _load_technology(session, technology_id)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        changes["name"] = (changes["name"] or "").strip()
        if not changes["name"]:
            raise HTTPException(status_code=400, detail="Название технологии не может быть пустым")
    if "category_id" in changes:
        await _category(session, changes["category_id"])
    if "replacement_technology_id" in changes:
        await _replacement(session, changes["replacement_technology_id"], technology.id)
    for key, value in changes.items():
        setattr(technology, key, value)
    technology.updated_by = current_user.id
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=400, detail="Технология с таким названием уже существует") from exc
    await session.refresh(technology)
    return await _to_public(session, technology)


@router.post("/{technology_id}/status", response_model=TechnologyPublic)
async def change_status(technology_id: int, payload: TechnologyStatusChange, session: SessionDep, current_user: AdminUser):
    technology = await _load_technology(session, technology_id)
    reason = payload.reason_md.strip()
    if technology.status == payload.status:
        raise HTTPException(status_code=400, detail="Статус не изменился — используйте подтверждение актуальности")
    if not reason:
        raise HTTPException(status_code=400, detail="Укажите основание изменения статуса")
    await _replacement(session, payload.replacement_technology_id, technology.id)
    old_status = technology.status
    now = datetime.now(UTC)
    technology.status = payload.status
    technology.status_reason_md = reason
    technology.status_changed_at = now
    technology.last_reviewed_at = now
    technology.next_review_at = payload.next_review_at
    technology.replacement_technology_id = payload.replacement_technology_id
    technology.updated_by = current_user.id
    session.add(TechnologyDecision(
        technology_id=technology.id, event_kind="status_changed",
        from_status=old_status, to_status=payload.status, summary_md=reason,
        next_review_at=payload.next_review_at, created_by=current_user.id,
    ))
    await session.commit()
    await session.refresh(technology)
    return await _to_public(session, technology)


@router.post("/{technology_id}/review", response_model=TechnologyPublic)
async def review_technology(technology_id: int, payload: TechnologyReviewCreate, session: SessionDep, current_user: AdminUser):
    technology = await _load_technology(session, technology_id)
    summary = payload.summary_md.strip()
    if not summary:
        raise HTTPException(status_code=400, detail="Укажите результат review")
    technology.last_reviewed_at = datetime.now(UTC)
    technology.next_review_at = payload.next_review_at
    technology.updated_by = current_user.id
    session.add(TechnologyDecision(
        technology_id=technology.id, event_kind="reviewed",
        from_status=technology.status, to_status=technology.status,
        summary_md=summary, next_review_at=payload.next_review_at,
        created_by=current_user.id,
    ))
    await session.commit()
    await session.refresh(technology)
    return await _to_public(session, technology)


@router.post("/{technology_id}/archive", response_model=TechnologyPublic)
async def archive_technology(technology_id: int, payload: TechnologyArchiveCreate, session: SessionDep, current_user: AdminUser):
    technology = await _load_technology(session, technology_id)
    reason = payload.reason_md.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Укажите причину архивации")
    technology.is_active = False
    technology.updated_by = current_user.id
    session.add(TechnologyDecision(
        technology_id=technology.id, event_kind="archived", from_status=technology.status,
        to_status=technology.status, summary_md=reason, created_by=current_user.id,
    ))
    await session.commit()
    await session.refresh(technology)
    return await _to_public(session, technology)


@router.post("/{technology_id}/restore", response_model=TechnologyPublic)
async def restore_technology(technology_id: int, payload: TechnologyRestoreCreate, session: SessionDep, current_user: AdminUser):
    technology = await _load_technology(session, technology_id)
    technology.is_active = True
    technology.updated_by = current_user.id
    session.add(TechnologyDecision(
        technology_id=technology.id, event_kind="restored", from_status=technology.status,
        to_status=technology.status, summary_md=payload.reason_md.strip() or "Технология восстановлена",
        created_by=current_user.id,
    ))
    await session.commit()
    await session.refresh(technology)
    return await _to_public(session, technology)


@router.post("/{technology_id}/members", response_model=TechnologyMemberPublic, status_code=201)
async def add_member(technology_id: int, payload: TechnologyMemberCreate, session: SessionDep, current_user: AdminUser):
    await _load_technology(session, technology_id)
    employee = await session.get(Employee, payload.employee_id)
    if employee is None or employee.kind != "employee":
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    if employee.left_at is not None:
        raise HTTPException(status_code=400, detail="Нельзя добавить уволенного сотрудника")
    member = TechnologyMember(
        technology_id=technology_id, employee_id=employee.id, role=payload.role,
        source="manual", notes=payload.notes, created_by=current_user.id,
    )
    session.add(member)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=400, detail="Сотрудник уже связан с технологией") from exc
    members = await _member_publics(session, technology_id)
    return next(item for item in members if item.employee_id == employee.id)


@router.patch("/{technology_id}/members/{employee_id}", response_model=TechnologyMemberPublic)
async def update_member(technology_id: int, employee_id: int, payload: TechnologyMemberUpdate, session: SessionDep, _current_user: AdminUser):
    member = (await session.execute(select(TechnologyMember).where(
        TechnologyMember.technology_id == technology_id, TechnologyMember.employee_id == employee_id,
    ))).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Связь с сотрудником не найдена")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(member, key, value)
    await session.commit()
    return next(item for item in await _member_publics(session, technology_id) if item.employee_id == employee_id)


@router.delete("/{technology_id}/members/{employee_id}", status_code=204)
async def remove_member(technology_id: int, employee_id: int, session: SessionDep, _current_user: AdminUser):
    member = (await session.execute(select(TechnologyMember).where(
        TechnologyMember.technology_id == technology_id, TechnologyMember.employee_id == employee_id,
    ))).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="Связь с сотрудником не найдена")
    await session.delete(member)
    await session.commit()


@router.post("/{technology_id}/products", response_model=TechnologyProductPublic, status_code=201)
async def add_product(technology_id: int, payload: TechnologyProductCreate, session: SessionDep, current_user: AdminUser):
    await _load_technology(session, technology_id)
    product = await session.get(Product, payload.product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Продукт не найден")
    session.add(TechnologyProduct(
        technology_id=technology_id, product_id=product.id,
        usage_type=payload.usage_type, notes=payload.notes, created_by=current_user.id,
    ))
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(status_code=400, detail="Продукт уже связан с технологией") from exc
    return next(item for item in await _product_publics(session, technology_id) if item.product_id == product.id)


@router.patch("/{technology_id}/products/{product_id}", response_model=TechnologyProductPublic)
async def update_product(technology_id: int, product_id: int, payload: TechnologyProductUpdate, session: SessionDep, _current_user: AdminUser):
    link = await session.get(TechnologyProduct, (technology_id, product_id))
    if link is None:
        raise HTTPException(status_code=404, detail="Связь с продуктом не найдена")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(link, key, value)
    await session.commit()
    return next(item for item in await _product_publics(session, technology_id) if item.product_id == product_id)


@router.delete("/{technology_id}/products/{product_id}", status_code=204)
async def remove_product(technology_id: int, product_id: int, session: SessionDep, _current_user: AdminUser):
    link = await session.get(TechnologyProduct, (technology_id, product_id))
    if link is None:
        raise HTTPException(status_code=404, detail="Связь с продуктом не найдена")
    await session.delete(link)
    await session.commit()


@router.post("/{technology_id}/links", response_model=TechnologyLinkPublic, status_code=201)
async def add_link(technology_id: int, payload: TechnologyLinkCreate, session: SessionDep, current_user: AdminUser):
    await _load_technology(session, technology_id)
    link = TechnologyLink(
        technology_id=technology_id, kind=payload.kind, title=payload.title.strip(),
        url=payload.url.strip(), sort_order=payload.sort_order, created_by=current_user.id,
    )
    session.add(link)
    await session.commit()
    await session.refresh(link)
    return TechnologyLinkPublic.model_validate(link)


@router.patch("/{technology_id}/links/{link_id}", response_model=TechnologyLinkPublic)
async def update_link(technology_id: int, link_id: int, payload: TechnologyLinkUpdate, session: SessionDep, _current_user: AdminUser):
    link = (await session.execute(select(TechnologyLink).where(
        TechnologyLink.id == link_id, TechnologyLink.technology_id == technology_id,
    ))).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="Ссылка не найдена")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(link, key, value.strip() if isinstance(value, str) else value)
    await session.commit()
    await session.refresh(link)
    return TechnologyLinkPublic.model_validate(link)


@router.delete("/{technology_id}/links/{link_id}", status_code=204)
async def remove_link(technology_id: int, link_id: int, session: SessionDep, _current_user: AdminUser):
    link = (await session.execute(select(TechnologyLink).where(
        TechnologyLink.id == link_id, TechnologyLink.technology_id == technology_id,
    ))).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="Ссылка не найдена")
    await session.delete(link)
    await session.commit()


@product_router.get("/{product_id}/technologies", response_model=list[ProductTechnologyPublic])
async def product_technologies(product_id: int, session: SessionDep, current_user: CurrentUser):
    product = await session.get(Product, product_id)
    if product is None or (is_product_manager(current_user) and product.product_manager_id != current_user.id):
        raise HTTPException(status_code=404, detail="Продукт не найден")
    rows = (await session.execute(
        select(TechnologyProduct, Technology).join(Technology, Technology.id == TechnologyProduct.technology_id)
        .where(TechnologyProduct.product_id == product_id, Technology.is_active.is_(True))
        .order_by(Technology.name)
    )).all()
    items = await _list_items(session, [technology for _, technology in rows])
    by_id = {item.id: item for item in items}
    return [ProductTechnologyPublic(
        technology_id=technology.id, technology_name=technology.name,
        category=by_id[technology.id].category, status=technology.status,
        usage_type=link.usage_type, notes=link.notes,
        attention=by_id[technology.id].attention,
    ) for link, technology in rows]


@employee_router.get(
    "/{employee_id}/technologies",
    response_model=list[EmployeeTechnologyPublic],
)
async def employee_technologies(
    employee_id: int,
    session: SessionDep,
    _current_user: CurrentUser,
):
    employee = await session.get(Employee, employee_id)
    if employee is None or employee.kind != "employee":
        raise HTTPException(status_code=404, detail="Сотрудник не найден")
    rows = (
        await session.execute(
            select(TechnologyMember, Technology)
            .join(Technology, Technology.id == TechnologyMember.technology_id)
            .where(
                TechnologyMember.employee_id == employee_id,
                Technology.is_active.is_(True),
            )
            .order_by(
                case(
                    (TechnologyMember.role == "leader", 1),
                    (TechnologyMember.role == "expert", 2),
                    else_=3,
                ),
                Technology.name,
            )
        )
    ).all()
    technologies = [technology for _, technology in rows]
    items = await _list_items(session, technologies)
    by_id = {item.id: item for item in items}
    technology_ids = [technology.id for technology in technologies]
    product_rows = []
    if technology_ids:
        product_rows = (
            await session.execute(
                select(TechnologyProduct, Product)
                .join(Product, Product.id == TechnologyProduct.product_id)
                .where(TechnologyProduct.technology_id.in_(technology_ids))
                .order_by(Product.name)
            )
        ).all()
    products_by_technology: dict[int, list[EmployeeTechnologyProductRef]] = {}
    for link, product in product_rows:
        products_by_technology.setdefault(link.technology_id, []).append(
            EmployeeTechnologyProductRef(
                product_id=product.id,
                product_name=product.name,
                usage_type=link.usage_type,
            )
        )
    return [
        EmployeeTechnologyPublic(
            technology_id=technology.id,
            technology_name=technology.name,
            category=by_id[technology.id].category,
            status=technology.status,
            member_role=member.role,
            source=member.source,
            notes=member.notes,
            products=products_by_technology.get(technology.id, []),
            attention=by_id[technology.id].attention,
        )
        for member, technology in rows
    ]
