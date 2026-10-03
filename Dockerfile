ARG NODE_IMAGE=node:22-alpine
ARG PYTHON_IMAGE=python:3.13-slim

FROM ${NODE_IMAGE} AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM ${PYTHON_IMAGE} AS backend-deps
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never
RUN pip install --no-cache-dir "uv>=0.5,<1"
WORKDIR /build
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM ${PYTHON_IMAGE} AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    STATIC_DIR=/app/static \
    APP_ENV=production
RUN groupadd --system app && useradd --system --gid app --no-create-home --home-dir /app app
WORKDIR /app
COPY --from=backend-deps /opt/venv /opt/venv
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY backend/app ./app
COPY data ./data
COPY --from=frontend /build/dist ./static
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
USER app
EXPOSE 8080
ENTRYPOINT ["entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--proxy-headers", "--no-access-log"]
