from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Literal
from xml.etree import ElementTree

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from app.api.deps import AdminUser, CurrentUser, SessionDep
from app.models.dev_metrics import ExtractedCompetency
from app.models.employee import Employee
from app.models.mpk import Assessment, AssessmentScore, Competency
from app.models.project import Product, ProductMember, Project
from app.models.technology import (
    Technology,
    TechnologyCompetency,
    TechnologyDecision,
    TechnologyMember,
    TechnologyNewsItem,
    TechnologyNewsSource,
    TechnologyPackageMapping,
    TechnologyProjectVersionEvidence,
    TechnologyProduct,
    TechnologyProposal,
    TechnologyVulnerabilitySnapshot,
)
from app.schemas.technology_intelligence import (
    NewsItemCreate,
    NewsItemPublic,
    NewsSourceCreate,
    NewsSourcePublic,
    PackageMappingCreate,
    PackageMappingPublic,
    ProposalCreate,
    ProposalDecision,
    ProposalPublic,
    SecuritySummaryPublic,
    TechnologyBusFactorPublic,
    TechnologyCandidatePublic,
    TechnologyCompetencyCreate,
    TechnologyCompetencyPublic,
    VersionEvidenceCreate,
    VersionEvidencePublic,
    VersionEvidenceUpdate,
    VulnerabilityCreate,
    VulnerabilityPublic,
)
from app.technology_icons import suggest_technology_icon_slug

router = APIRouter(prefix="/technologies", tags=["technology-intelligence"])
proposal_router = APIRouter(prefix="/technology-proposals", tags=["technology-proposals"])

OSV_ECOSYSTEMS = {
    "pypi": "PyPI",
    "npm": "npm",
    "nuget": "NuGet",
    "maven": "Maven",
    "go": "Go",
    "golang": "Go",
    "crates.io": "crates.io",
    "cargo": "crates.io",
    "packagist": "Packagist",
    "rubygems": "RubyGems",
}


def _osv_severity(vulnerability: dict) -> str:
    raw = str(vulnerability.get("database_specific", {}).get("severity", "")).lower()
    if raw in {"critical", "high", "medium", "low"}:
        return raw
    aliases = vulnerability.get("aliases") or []
    if any(str(alias).startswith("CVE-") for alias in aliases):
        return "unknown"
    return "unknown"


async def _technology(session, technology_id: int) -> Technology:
    item = await session.get(Technology, technology_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Технология не найдена")
    return item


@router.get("/{technology_id}/competencies", response_model=list[TechnologyCompetencyPublic])
async def list_competencies(technology_id: int, session: SessionDep, _user: CurrentUser):
    await _technology(session, technology_id)
    rows = (
        await session.execute(
            select(TechnologyCompetency, Competency.name)
            .join(Competency)
            .where(TechnologyCompetency.technology_id == technology_id)
            .order_by(Competency.name)
        )
    ).all()
    return [
        TechnologyCompetencyPublic(
            competency_id=row.competency_id,
            competency_name=name,
            weight=row.weight,
            notes=row.notes,
        )
        for row, name in rows
    ]


@router.put("/{technology_id}/competencies", response_model=list[TechnologyCompetencyPublic])
async def set_competencies(
    technology_id: int,
    payload: list[TechnologyCompetencyCreate],
    session: SessionDep,
    user: AdminUser,
):
    await _technology(session, technology_id)
    ids = {item.competency_id for item in payload}
    existing = (
        set((await session.execute(select(Competency.id).where(Competency.id.in_(ids)))).scalars())
        if ids
        else set()
    )
    if existing != ids:
        raise HTTPException(status_code=400, detail="Одна или несколько компетенций не найдены")
    await session.execute(
        delete(TechnologyCompetency).where(TechnologyCompetency.technology_id == technology_id)
    )
    session.add_all(
        [
            TechnologyCompetency(
                technology_id=technology_id,
                competency_id=item.competency_id,
                weight=item.weight,
                notes=item.notes,
                created_by=user.id,
            )
            for item in payload
        ]
    )
    await session.commit()
    return await list_competencies(technology_id, session, user)


@router.get("/{technology_id}/candidates", response_model=list[TechnologyCandidatePublic])
async def candidates(
    technology_id: int,
    session: SessionDep,
    _user: CurrentUser,
    q: str | None = None,
    department_id: int | None = None,
    suggested_role: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
):
    await _technology(session, technology_id)
    links = list(
        (
            await session.execute(
                select(TechnologyCompetency).where(
                    TechnologyCompetency.technology_id == technology_id
                )
            )
        ).scalars()
    )
    if not links:
        return []
    competency_ids = [link.competency_id for link in links]
    name_rows = (
        await session.execute(
            select(Competency.id, Competency.name).where(Competency.id.in_(competency_ids))
        )
    ).all()
    names: dict[int, str] = {competency_id: name for competency_id, name in name_rows}
    existing_ids = set(
        (
            await session.execute(
                select(TechnologyMember.employee_id).where(
                    TechnologyMember.technology_id == technology_id
                )
            )
        ).scalars()
    )
    score_rows = (
        await session.execute(
            select(
                Assessment.employee_id,
                AssessmentScore.competency_id,
                func.max(AssessmentScore.level),
            )
            .join(AssessmentScore, AssessmentScore.assessment_id == Assessment.id)
            .join(Employee, Employee.id == Assessment.employee_id)
            .where(AssessmentScore.competency_id.in_(competency_ids), Employee.left_at.is_(None))
            .group_by(Assessment.employee_id, AssessmentScore.competency_id)
        )
    ).all()
    extracted_rows = (
        await session.execute(
            select(
                ExtractedCompetency.employee_id,
                ExtractedCompetency.competency_id,
                ExtractedCompetency.frequency,
            ).where(ExtractedCompetency.competency_id.in_(competency_ids))
        )
    ).all()
    product_rows = (
        await session.execute(
            select(ProductMember.employee_id, func.count(ProductMember.product_id.distinct()))
            .where(ProductMember.left_at.is_(None))
            .group_by(ProductMember.employee_id)
        )
    ).all()
    by_employee: dict[int, dict] = {}
    for employee_id, competency_id, level in score_rows:
        data = by_employee.setdefault(employee_id, {"levels": {}, "pr": 0})
        data["levels"][competency_id] = level
    for employee_id, competency_id, frequency in extracted_rows:
        data = by_employee.setdefault(employee_id, {"levels": {}, "pr": 0})
        data["pr"] += frequency
        data["levels"].setdefault(competency_id, None)
    product_counts: dict[int, int] = {employee_id: count for employee_id, count in product_rows}
    employee_ids = set(by_employee) - existing_ids
    employees = (
        {
            employee.id: employee
            for employee in (
                await session.execute(
                    select(Employee)
                    .where(Employee.id.in_(employee_ids), Employee.left_at.is_(None))
                    .options(selectinload(Employee.department))
                )
            ).scalars()
        }
        if employee_ids
        else {}
    )
    result = []
    for employee_id, data in by_employee.items():
        employee = employees.get(employee_id)
        if employee is None:
            continue
        if q and q.casefold() not in employee.full_name.casefold():
            continue
        if department_id is not None and employee.department_id != department_id:
            continue
        levels = [level for level in data["levels"].values() if level is not None]
        max_level = max(levels, default=None)
        product_count = product_counts.get(employee_id, 0)
        expert = (max_level or 0) >= 4 and (data["pr"] >= 10 or product_count >= 2)
        candidate_role: Literal["expert", "practitioner"] = "expert" if expert else "practitioner"
        if suggested_role and candidate_role != suggested_role:
            continue
        reasons = []
        if max_level is not None:
            reasons.append(f"МПК: уровень {max_level}")
        if data["pr"]:
            reasons.append(f"PR evidence: {data['pr']}")
        if product_count:
            reasons.append(f"Продуктов: {product_count}")
        result.append(
            TechnologyCandidatePublic(
                employee_id=employee_id,
                full_name=employee.full_name,
                department_id=employee.department_id,
                department_name=employee.department.name if employee.department else None,
                suggested_role=candidate_role,
                max_mpk_level=max_level,
                matched_competencies=[names[cid] for cid in data["levels"] if cid in names],
                product_count=product_count,
                pr_count=data["pr"],
                reasons=reasons,
            )
        )
    return sorted(
        result,
        key=lambda item: (
            item.suggested_role != "expert",
            -(item.max_mpk_level or 0),
            -item.pr_count,
        ),
    )[:limit]


@router.post("/{technology_id}/candidates/{employee_id}/accept", status_code=201)
async def accept_candidate(
    technology_id: int,
    employee_id: int,
    role: str,
    session: SessionDep,
    user: AdminUser,
):
    if role not in {"expert", "practitioner"}:
        raise HTTPException(status_code=400, detail="Допустимы роли expert и practitioner")
    await _technology(session, technology_id)
    employee = await session.get(Employee, employee_id)
    if employee is None or employee.left_at is not None:
        raise HTTPException(status_code=400, detail="Активный сотрудник не найден")
    duplicate = (
        await session.execute(
            select(TechnologyMember).where(
                TechnologyMember.technology_id == technology_id,
                TechnologyMember.employee_id == employee_id,
            )
        )
    ).scalar_one_or_none()
    if duplicate is not None:
        raise HTTPException(status_code=400, detail="Сотрудник уже связан с технологией")
    session.add(
        TechnologyMember(
            technology_id=technology_id,
            employee_id=employee_id,
            role=role,
            source="inferred",
            notes="Подтверждено из evidence-рекомендации",
            created_by=user.id,
        )
    )
    await session.commit()
    return {"status": "accepted"}


@router.get("/{technology_id}/bus-factor", response_model=TechnologyBusFactorPublic)
async def bus_factor(technology_id: int, session: SessionDep, _user: CurrentUser):
    technology = await _technology(session, technology_id)
    rows = (
        await session.execute(
            select(TechnologyMember.role, Employee.left_at, func.count())
            .join(Employee, Employee.id == TechnologyMember.employee_id)
            .where(TechnologyMember.technology_id == technology_id)
            .group_by(TechnologyMember.role, Employee.left_at)
        )
    ).all()
    active = {"leader": 0, "expert": 0, "practitioner": 0}
    departed_experts = 0
    for role, left_at, count in rows:
        if left_at is None:
            active[role] += count
        elif role in {"leader", "expert"}:
            departed_experts += count
    active_products = (
        await session.execute(
            select(func.count())
            .select_from(TechnologyProduct)
            .join(Product, Product.id == TechnologyProduct.product_id)
            .where(TechnologyProduct.technology_id == technology_id, Product.status == "active")
        )
    ).scalar_one()
    single = technology.status == "adopt" and active["leader"] + active["expert"] == 1
    low = active_products >= 2 and sum(active.values()) <= 1
    signals = []
    if technology.status == "adopt" and active["leader"] + active["expert"] == 0:
        signals.append("Adopt без активного лидера или эксперта")
    if single:
        signals.append("Единственная экспертная опора")
    if low:
        signals.append("Несколько активных продуктов зависят от одного носителя")
    if departed_experts:
        signals.append(f"Экспертов/лидеров покинуло компанию: {departed_experts}")
    return TechnologyBusFactorPublic(
        leaders=active["leader"],
        experts=active["expert"],
        practitioners=active["practitioner"],
        active_products=active_products,
        single_expert_risk=single,
        low_carrier_coverage=low,
        departed_experts=departed_experts,
        signals=signals,
    )


@router.get("/{technology_id}/packages", response_model=list[PackageMappingPublic])
async def packages(technology_id: int, session: SessionDep, _user: CurrentUser):
    await _technology(session, technology_id)
    return list(
        (
            await session.execute(
                select(TechnologyPackageMapping)
                .where(TechnologyPackageMapping.technology_id == technology_id)
                .order_by(TechnologyPackageMapping.package_name)
            )
        ).scalars()
    )


@router.post("/{technology_id}/packages", response_model=PackageMappingPublic, status_code=201)
async def add_package(
    technology_id: int, payload: PackageMappingCreate, session: SessionDep, user: AdminUser
):
    await _technology(session, technology_id)
    item = TechnologyPackageMapping(
        technology_id=technology_id,
        ecosystem=OSV_ECOSYSTEMS.get(
            payload.ecosystem.strip().casefold(), payload.ecosystem.strip()
        ),
        package_name=payload.package_name.strip(),
        created_by=user.id,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@router.delete("/{technology_id}/packages/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_package(
    technology_id: int, mapping_id: int, session: SessionDep, _user: AdminUser
):
    item = await session.get(TechnologyPackageMapping, mapping_id)
    if item is None or item.technology_id != technology_id:
        raise HTTPException(status_code=404, detail="Package mapping не найден")
    await session.delete(item)
    await session.commit()


@router.post("/{technology_id}/versions", response_model=VersionEvidencePublic, status_code=201)
async def add_version(
    technology_id: int, payload: VersionEvidenceCreate, session: SessionDep, user: AdminUser
):
    mapping = await session.get(TechnologyPackageMapping, payload.package_mapping_id)
    project = await session.get(Project, payload.project_id)
    if mapping is None or mapping.technology_id != technology_id or project is None:
        raise HTTPException(status_code=400, detail="Package mapping или проект не найден")
    item = TechnologyProjectVersionEvidence(
        package_mapping_id=mapping.id,
        project_id=project.id,
        version=payload.version.strip(),
        source=payload.source,
        detected_at=datetime.now(UTC),
        created_by=user.id,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return await _version_public(session, item)


@router.patch("/{technology_id}/versions/{evidence_id}", response_model=VersionEvidencePublic)
async def update_version(
    technology_id: int,
    evidence_id: int,
    payload: VersionEvidenceUpdate,
    session: SessionDep,
    _user: AdminUser,
):
    item = await session.get(TechnologyProjectVersionEvidence, evidence_id)
    mapping = await session.get(TechnologyPackageMapping, item.package_mapping_id) if item else None
    if mapping is None or mapping.technology_id != technology_id:
        raise HTTPException(status_code=404, detail="Version evidence не найден")
    assert item is not None
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, key, value.strip() if isinstance(value, str) else value)
    item.detected_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(item)
    return await _version_public(session, item)


@router.delete("/{technology_id}/versions/{evidence_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_version(
    technology_id: int, evidence_id: int, session: SessionDep, _user: AdminUser
):
    item = await session.get(TechnologyProjectVersionEvidence, evidence_id)
    mapping = await session.get(TechnologyPackageMapping, item.package_mapping_id) if item else None
    if mapping is None or mapping.technology_id != technology_id:
        raise HTTPException(status_code=404, detail="Version evidence не найден")
    assert item is not None
    await session.delete(item)
    await session.commit()


async def _version_public(session, item) -> VersionEvidencePublic:
    mapping = await session.get(TechnologyPackageMapping, item.package_mapping_id)
    project = await session.get(Project, item.project_id)
    product = (
        await session.get(Product, project.product_id) if project and project.product_id else None
    )
    vulnerabilities = list(
        (
            await session.execute(
                select(TechnologyVulnerabilitySnapshot).where(
                    TechnologyVulnerabilitySnapshot.version_evidence_id == item.id
                )
            )
        ).scalars()
    )
    return VersionEvidencePublic(
        id=item.id,
        package_mapping_id=mapping.id,
        ecosystem=mapping.ecosystem,
        package_name=mapping.package_name,
        project_id=project.id,
        project_name=project.name,
        product_id=product.id if product else None,
        product_name=product.name if product else None,
        version=item.version,
        source=item.source,
        detected_at=item.detected_at,
        vulnerabilities=[VulnerabilityPublic.model_validate(v) for v in vulnerabilities],
    )


@router.post(
    "/{technology_id}/versions/{evidence_id}/vulnerabilities",
    response_model=VulnerabilityPublic,
    status_code=201,
)
async def add_vulnerability(
    technology_id: int,
    evidence_id: int,
    payload: VulnerabilityCreate,
    session: SessionDep,
    _user: AdminUser,
):
    evidence = await session.get(TechnologyProjectVersionEvidence, evidence_id)
    mapping = (
        await session.get(TechnologyPackageMapping, evidence.package_mapping_id)
        if evidence
        else None
    )
    if mapping is None or mapping.technology_id != technology_id:
        raise HTTPException(status_code=404, detail="Version evidence не найден")
    assert evidence is not None
    item = TechnologyVulnerabilitySnapshot(
        version_evidence_id=evidence_id, fetched_at=datetime.now(UTC), **payload.model_dump()
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@router.get("/{technology_id}/security", response_model=SecuritySummaryPublic)
async def security_summary(technology_id: int, session: SessionDep, _user: CurrentUser):
    await _technology(session, technology_id)
    evidence = list(
        (
            await session.execute(
                select(TechnologyProjectVersionEvidence)
                .join(TechnologyPackageMapping)
                .where(TechnologyPackageMapping.technology_id == technology_id)
            )
        ).scalars()
    )
    publics = [await _version_public(session, item) for item in evidence]
    vulnerabilities = [v for item in publics for v in item.vulnerabilities if v.affected]
    counts = {
        severity: sum(v.severity == severity for v in vulnerabilities)
        for severity in ("critical", "high", "medium", "low")
    }
    return SecuritySummaryPublic(
        **counts,
        kev=sum(v.is_kev for v in vulnerabilities),
        affected_products=len(
            {
                item.product_id
                for item in publics
                if item.product_id and any(v.affected for v in item.vulnerabilities)
            }
        ),
        evidence=publics,
    )


@router.post(
    "/{technology_id}/versions/{evidence_id}/osv-scan", response_model=SecuritySummaryPublic
)
async def osv_scan(technology_id: int, evidence_id: int, session: SessionDep, _user: AdminUser):
    evidence = await session.get(TechnologyProjectVersionEvidence, evidence_id)
    mapping = (
        await session.get(TechnologyPackageMapping, evidence.package_mapping_id)
        if evidence
        else None
    )
    if mapping is None or mapping.technology_id != technology_id:
        raise HTTPException(status_code=404, detail="Version evidence не найден")
    assert evidence is not None
    ecosystem = OSV_ECOSYSTEMS.get(mapping.ecosystem.casefold())
    if ecosystem is None:
        supported = ", ".join(sorted(set(OSV_ECOSYSTEMS.values())))
        raise HTTPException(
            status_code=400,
            detail=f"Экосистема {mapping.ecosystem!r} не поддерживается OSV. Доступно: {supported}",
        )
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://api.osv.dev/v1/query",
                json={
                    "version": evidence.version,
                    "package": {"name": mapping.package_name, "ecosystem": ecosystem},
                },
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OSV недоступен: {exc}") from exc
    payload = response.json()
    vulnerabilities = payload.get("vulns", [])
    await session.execute(
        delete(TechnologyVulnerabilitySnapshot).where(
            TechnologyVulnerabilitySnapshot.version_evidence_id == evidence_id
        )
    )
    for vuln in vulnerabilities:
        advisory_id = vuln.get("id", "unknown")
        values = dict(
            severity=_osv_severity(vuln),
            summary=vuln.get("summary") or advisory_id,
            url=(vuln.get("references") or [{}])[0].get("url"),
            affected=True,
            fetched_at=datetime.now(UTC),
            is_kev=False,
        )
        session.add(
            TechnologyVulnerabilitySnapshot(
                version_evidence_id=evidence_id, advisory_id=advisory_id, **values
            )
        )
    await session.commit()
    return await security_summary(technology_id, session, _user)


@router.get("/{technology_id}/news", response_model=list[NewsItemPublic])
async def news(technology_id: int, session: SessionDep, _user: CurrentUser):
    await _technology(session, technology_id)
    return list(
        (
            await session.execute(
                select(TechnologyNewsItem)
                .where(TechnologyNewsItem.technology_id == technology_id)
                .order_by(TechnologyNewsItem.published_at.desc())
                .limit(100)
            )
        ).scalars()
    )


@router.post("/{technology_id}/news", response_model=NewsItemPublic, status_code=201)
async def add_news(
    technology_id: int, payload: NewsItemCreate, session: SessionDep, _user: AdminUser
):
    await _technology(session, technology_id)
    item = TechnologyNewsItem(
        technology_id=technology_id, fetched_at=datetime.now(UTC), **payload.model_dump()
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@router.get("/{technology_id}/news-sources", response_model=list[NewsSourcePublic])
async def news_sources(technology_id: int, session: SessionDep, _user: CurrentUser):
    await _technology(session, technology_id)
    return list(
        (
            await session.execute(
                select(TechnologyNewsSource).where(
                    TechnologyNewsSource.technology_id == technology_id
                )
            )
        ).scalars()
    )


@router.post("/{technology_id}/news-sources", response_model=NewsSourcePublic, status_code=201)
async def add_news_source(
    technology_id: int, payload: NewsSourceCreate, session: SessionDep, user: AdminUser
):
    await _technology(session, technology_id)
    item = TechnologyNewsSource(
        technology_id=technology_id, created_by=user.id, **payload.model_dump()
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@router.delete(
    "/{technology_id}/news-sources/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_news_source(
    technology_id: int,
    source_id: int,
    session: SessionDep,
    _user: AdminUser,
):
    source = await session.get(TechnologyNewsSource, source_id)
    if source is None or source.technology_id != technology_id:
        raise HTTPException(status_code=404, detail="Источник не найден")
    await session.delete(source)
    await session.commit()


@router.post("/{technology_id}/news-sources/{source_id}/fetch", response_model=list[NewsItemPublic])
async def fetch_news_source(
    technology_id: int, source_id: int, session: SessionDep, _user: AdminUser
):
    source = await session.get(TechnologyNewsSource, source_id)
    if source is None or source.technology_id != technology_id:
        raise HTTPException(status_code=404, detail="Источник не найден")
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(source.feed_url)
            response.raise_for_status()
        root = ElementTree.fromstring(response.content)
    except (httpx.HTTPError, ElementTree.ParseError) as exc:
        raise HTTPException(
            status_code=502, detail=f"Не удалось прочитать RSS/Atom: {exc}"
        ) from exc
    for node in root.findall(".//item") + root.findall(".//{http://www.w3.org/2005/Atom}entry"):
        title = (
            node.findtext("title")
            or node.findtext("{http://www.w3.org/2005/Atom}title")
            or "Без названия"
        )
        link_node = node.find("link")
        if link_node is None:
            link_node = node.find("{http://www.w3.org/2005/Atom}link")
        url = (link_node.text if link_node is not None else None) or (
            link_node.get("href") if link_node is not None else None
        )
        if not url:
            continue
        if (
            await session.execute(
                select(TechnologyNewsItem.id).where(TechnologyNewsItem.url == url)
            )
        ).scalar_one_or_none():
            continue
        raw_date = (
            node.findtext("pubDate")
            or node.findtext("{http://www.w3.org/2005/Atom}published")
            or node.findtext("{http://www.w3.org/2005/Atom}updated")
        )
        try:
            if raw_date and "T" in raw_date:
                published = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
            else:
                published = parsedate_to_datetime(raw_date) if raw_date else datetime.now(UTC)
        except (TypeError, ValueError):
            published = datetime.now(UTC)
        summary = (
            node.findtext("description")
            or node.findtext("{http://www.w3.org/2005/Atom}summary")
            or node.findtext("{http://www.w3.org/2005/Atom}content")
        )
        session.add(
            TechnologyNewsItem(
                technology_id=technology_id,
                source_id=source.id,
                title=title.strip(),
                url=url.strip(),
                source=source.name,
                published_at=published,
                summary=summary,
                fetched_at=datetime.now(UTC),
            )
        )
    source.last_fetched_at = datetime.now(UTC)
    await session.commit()
    return await news(technology_id, session, _user)


@proposal_router.get("", response_model=list[ProposalPublic])
async def proposals(session: SessionDep, _user: CurrentUser):
    return list(
        (
            await session.execute(
                select(TechnologyProposal).order_by(TechnologyProposal.created_at.desc())
            )
        ).scalars()
    )


@proposal_router.post("", response_model=ProposalPublic, status_code=status.HTTP_201_CREATED)
async def create_proposal(payload: ProposalCreate, session: SessionDep, user: CurrentUser):
    name = payload.name.strip()
    rationale = payload.rationale_md.strip()
    if not name or not rationale:
        raise HTTPException(status_code=400, detail="Название и обоснование обязательны")
    technology = (
        await session.execute(select(Technology).where(func.lower(Technology.name) == name.lower()))
    ).scalar_one_or_none()
    if technology is not None:
        raise HTTPException(status_code=400, detail="Технология уже добавлена в радар")
    proposal = (
        await session.execute(
            select(TechnologyProposal).where(
                func.lower(TechnologyProposal.name) == name.lower(),
                TechnologyProposal.status.in_(("submitted", "assessing")),
            )
        )
    ).scalar_one_or_none()
    if proposal is not None:
        raise HTTPException(status_code=400, detail="Эта технология уже предложена")
    item = TechnologyProposal(
        proposed_by=user.id,
        name=name,
        category_id=payload.category_id,
        rationale_md=rationale,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@proposal_router.post("/{proposal_id}/decision", response_model=ProposalPublic)
async def decide_proposal(
    proposal_id: int, payload: ProposalDecision, session: SessionDep, user: AdminUser
):
    item = await session.get(TechnologyProposal, proposal_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Предложение не найдено")
    item.status = payload.status
    item.decision_md = payload.decision_md.strip()
    item.decided_by = user.id
    if payload.status == "approved" and item.technology_id is None:
        duplicate = (
            await session.execute(
                select(Technology).where(func.lower(Technology.name) == item.name.strip().lower())
            )
        ).scalar_one_or_none()
        if duplicate is not None:
            raise HTTPException(
                status_code=400,
                detail="Технология с таким названием уже существует",
            )
        technology = Technology(
            category_id=item.category_id,
            name=item.name.strip(),
            icon_slug=suggest_technology_icon_slug(item.name.strip()),
            description_md=item.rationale_md,
            status="assess",
            status_reason_md=item.decision_md,
            created_by=user.id,
            updated_by=user.id,
        )
        session.add(technology)
        await session.flush()
        session.add(
            TechnologyDecision(
                technology_id=technology.id,
                event_kind="created",
                to_status="assess",
                summary_md=item.decision_md,
                created_by=user.id,
            )
        )
        item.technology_id = technology.id
    await session.commit()
    await session.refresh(item)
    return item
