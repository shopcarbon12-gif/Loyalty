#!/bin/sh
set -e

# Carbon Loyalty container entrypoint.
# 1) Run migrations (idempotent — keyed in loyalty_schema_migrations).
# 2) Start Next.js standalone server.

if [ -z "$DATABASE_URL" ]; then
  echo "loyalty: DATABASE_URL is empty. Set it in Coolify env."
  echo "loyalty: Use the internal Coolify hostname:"
  echo "loyalty:   postgresql-database-iogw84scwo0owsco8c8wg4s0:5432"
  exit 2
fi

echo "loyalty: running migrations…"
node /app/scripts/docker-migrate.mjs

echo "loyalty: starting next server on port ${PORT:-5100}…"
exec node /app/server.js
