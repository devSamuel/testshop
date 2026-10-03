#!/bin/sh
set -eu
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    alembic upgrade head
    python -m app.cli seed-if-empty
fi
exec "$@"
