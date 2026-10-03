SHELL := /bin/bash
COMPOSE := docker compose
APP_PORT ?= 8080
BASE_URL ?= http://localhost:$(APP_PORT)
TEST_DB_URL := postgresql+asyncpg://shop:shop@localhost:$${DB_PORT:-5432}/shop_test
FILE ?= data/products.csv
WORKERS ?= 1

.PHONY: help up down reset logs wait import seed-large test test-unit test-backend test-frontend e2e screenshots lint fmt dev-api dev-worker dev-web chaos bench drain-bench invariants

help:
	@echo "make up             build and start the API on $(BASE_URL) and the background worker (migrates and seeds automatically)"
	@echo "make up WORKERS=N   same, with N worker containers delivering events in parallel"
	@echo "make down           stop containers (keeps data)"
	@echo "make reset          stop containers and delete the database volume"
	@echo "make logs           follow application logs"
	@echo "make import FILE=   import a CSV into the running app (default data/products.csv)"
	@echo "make test           backend (unit+integration on real Postgres) and frontend tests"
	@echo "make e2e            Playwright: product CRUD, search, purchase and import in a real browser against $(BASE_URL)"
	@echo "make screenshots    regenerate docs/screenshots with Playwright (run against a fresh stack: make reset up)"
	@echo "make lint           ruff, mypy --strict, import-linter, eslint, tsc"
	@echo "make chaos          kill the app mid-checkout and prove the books still balance"
	@echo "make seed-large     import 100k synthetic products"
	@echo "make bench          search latency and hot-product checkout throughput"
	@echo "make drain-bench    outbox drain rate with 1, 2 and 4 worker containers"
	@echo "make invariants     print the live data-integrity report"
	@echo "make dev-api        run the API with reload on :8000 against the compose database"
	@echo "make dev-worker     run the background worker (outbox dispatchers + reconciler) against the compose database"
	@echo "make dev-web        run the Vite dev server on :5173 proxying to the API"

up:
	APP_PORT=$(APP_PORT) WORKERS=$(WORKERS) $(COMPOSE) up --build -d
	@$(MAKE) --no-print-directory wait
	@echo "Shop is ready at $(BASE_URL)  (API docs: $(BASE_URL)/api/docs); background work runs in $(WORKERS) 'worker' container(s)"

wait:
	@for i in $$(seq 1 90); do \
		curl -fsS $(BASE_URL)/readyz >/dev/null 2>&1 && exit 0; sleep 2; \
	done; echo "app did not become healthy"; $(COMPOSE) logs --tail=50 app; exit 1

down:
	$(COMPOSE) down

reset:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f app worker

import:
	$(COMPOSE) exec app python -m app.cli import $(FILE)

seed-large:
	$(COMPOSE) exec app python -m app.cli seed-large --count 100000

invariants:
	@curl -fsS $(BASE_URL)/api/admin/invariants | python3 -m json.tool

test: test-backend test-frontend

test-unit:
	cd backend && uv run pytest tests/unit -q

test-backend:
	$(COMPOSE) up -d db
	@until $(COMPOSE) exec -T db pg_isready -U shop -d shop >/dev/null 2>&1; do sleep 1; done
	@$(COMPOSE) exec -T db psql -U shop -d shop -tc "SELECT 1 FROM pg_database WHERE datname = 'shop_test'" | grep -q 1 \
		|| $(COMPOSE) exec -T db psql -U shop -d shop -c "CREATE DATABASE shop_test"
	cd backend && TEST_DATABASE_URL=$(TEST_DB_URL) uv run pytest -q

test-frontend:
	cd frontend && npm test

e2e:
	cd frontend && BASE_URL=$(BASE_URL) npm run test:e2e

screenshots:
	cd frontend && BASE_URL=$(BASE_URL) npm run screenshots

lint:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app && uv run lint-imports
	cd frontend && npm run lint && npm run typecheck

fmt:
	cd backend && uv run ruff check --fix . && uv run ruff format .
	cd frontend && npm run format

dev-api:
	$(COMPOSE) up -d db
	cd backend && uv run alembic upgrade head && STATIC_DIR= uv run uvicorn app.main:app --reload --port 8000

dev-worker:
	cd backend && uv run python -m app.worker

dev-web:
	cd frontend && VITE_API_PROXY=http://localhost:8000 npm run dev

chaos:
	cd backend && uv run python ../scripts/chaos.py --base-url $(BASE_URL)

bench:
	cd backend && uv run python ../scripts/bench.py --base-url $(BASE_URL)

drain-bench:
	cd backend && uv run python ../scripts/drain_bench.py --base-url $(BASE_URL)
