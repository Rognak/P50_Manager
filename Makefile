.PHONY: up down db-shell backend frontend install migrate revision seed-admin seed-others seed-self-reviews seed-candidates seed-tech-maturity seed-departments seed-coreteam seed-roles seed-assignments seed-vacancies

up:
	docker compose up -d db adminer redis

down:
	docker compose down

db-shell:
	docker compose exec db psql -U p50 -d p50

install:
	cd backend && uv sync
	cd frontend && npm install

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

worker:
	cd backend && uv run arq app.worker.WorkerSettings

frontend:
	cd frontend && npm run dev

migrate:
	cd backend && uv run alembic upgrade head

revision:
	cd backend && uv run alembic revision --autogenerate -m "$(m)"

seed-admin:
	cd backend && uv run python -m scripts.create_admin

seed-mpk:
	@test -n "$(FILE)" || (echo "Usage: make seed-mpk FILE=/path/to/input.xlsx" && exit 1)
	cd backend && uv run python -m scripts.import_mpk "$(FILE)"

seed-demo:
	cd backend && uv run python -m scripts.seed_demo

seed-projects:
	cd backend && uv run python -m scripts.seed_projects

seed-others:
	cd backend && uv run python -m scripts.seed_other_managers

seed-self-reviews:
	cd backend && uv run python -m scripts.seed_self_reviews

seed-candidates:
	cd backend && uv run python -m scripts.seed_candidates

seed-tech-maturity:
	cd backend && uv run python -m scripts.seed_tech_maturity

seed-departments:
	cd backend && uv run python -m scripts.seed_departments

seed-coreteam:
	cd backend && uv run python -m scripts.seed_coreteam

seed-roles:
	cd backend && uv run python -m scripts.seed_roles

seed-assignments:
	cd backend && uv run python -m scripts.seed_assignments

seed-vacancies:
	cd backend && uv run python -m scripts.seed_vacancies

seed-dev-metrics:
	cd backend && uv run python -m scripts.seed_dev_metrics

codebuddy-check:
	cd backend && uv run python -m scripts.codebuddy_check
