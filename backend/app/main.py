from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    admin,
    ai,
    artifacts,
    assessments,
    assignments,
    auth,
    dashboard,
    dev_metrics,
    employee_public,
    employees,
    employees_search,
    jobs,
    meetings,
    mpk,
    candidates,
    departments,
    notifications,
    procedures,
    products,
    projects,
    recommendations,
    rotations,
    self_review,
    tech_maturity,
    technologies,
    users,
    vacancies,
)
from app.config import settings
from app.notifications.hub import hub as notification_hub
from app.redis_pool import close_redis, init_redis


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_redis()
    await notification_hub.start_redis_listener()
    yield
    await notification_hub.stop_redis_listener()
    await close_redis()


app = FastAPI(title="Прогресс 50 Менеджмент", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api")
app.include_router(employees.router, prefix="/api")
app.include_router(assessments.router, prefix="/api")
app.include_router(meetings.router, prefix="/api")
app.include_router(procedures.router, prefix="/api")
app.include_router(mpk.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(artifacts.router, prefix="/api")
app.include_router(recommendations.router, prefix="/api")
app.include_router(jobs.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(products.router, prefix="/api")
app.include_router(rotations.router, prefix="/api")
app.include_router(rotations.lifecycle, prefix="/api")
app.include_router(self_review.router, prefix="/api")
app.include_router(self_review.global_router, prefix="/api")
app.include_router(candidates.router, prefix="/api")
app.include_router(departments.router, prefix="/api")
app.include_router(departments.overview_router, prefix="/api")
app.include_router(tech_maturity.router, prefix="/api")
app.include_router(technologies.router, prefix="/api")
app.include_router(technologies.product_router, prefix="/api")
app.include_router(technologies.employee_router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(employees_search.router, prefix="/api")
app.include_router(employee_public.router, prefix="/api")
app.include_router(assignments.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(vacancies.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(dev_metrics.router, prefix="/api")
app.include_router(dev_metrics.project_router, prefix="/api")
