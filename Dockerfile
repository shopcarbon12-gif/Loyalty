# syntax=docker/dockerfile:1.7
# Carbon Loyalty — standalone Next.js image. Mirrors Carbon-POS's
# Dockerfile because Coolify-on-this-host has been validated against
# that exact shape (next build --webpack, capped V8 heap, full pg dep
# subtree copied for the migration runner).

FROM node:20-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json* ./
ENV NPM_CONFIG_PRODUCTION=false
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM base AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_PRODUCTION=false
ENV CI=true
ENV DOCKER_BUILD=1
ENV NEXT_REACT_COMPILER=0
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# BuildKit cache survives across deploys.
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked,id=carbon-loyalty-next-cache \
    node ./node_modules/next/dist/bin/next build --webpack

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5100
# Standalone server.js reads HOSTNAME from env. Without this it binds
# to the container's internal hostname only (e.g. b3ba1f42719b) and the
# docker healthcheck can't reach it via localhost.
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && apk add --no-cache libc6-compat postgresql-client su-exec curl
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# pg subtree isn't in the standalone trace (the migration script lives
# outside Next). Copy the full subtree from deps so docker-migrate.mjs
# can require('pg').
COPY --from=deps /app/node_modules/pg /app/node_modules/pg
COPY --from=deps /app/node_modules/pg-connection-string /app/node_modules/pg-connection-string
COPY --from=deps /app/node_modules/pg-pool /app/node_modules/pg-pool
COPY --from=deps /app/node_modules/pg-protocol /app/node_modules/pg-protocol
COPY --from=deps /app/node_modules/pg-types /app/node_modules/pg-types
COPY --from=deps /app/node_modules/pgpass /app/node_modules/pgpass
COPY --from=deps /app/node_modules/pg-int8 /app/node_modules/pg-int8
COPY --from=deps /app/node_modules/postgres-array /app/node_modules/postgres-array
COPY --from=deps /app/node_modules/postgres-bytea /app/node_modules/postgres-bytea
COPY --from=deps /app/node_modules/postgres-date /app/node_modules/postgres-date
COPY --from=deps /app/node_modules/postgres-interval /app/node_modules/postgres-interval
COPY --from=deps /app/node_modules/split2 /app/node_modules/split2
COPY --from=deps /app/node_modules/xtend /app/node_modules/xtend

COPY migrations /app/migrations
COPY scripts/docker-migrate.mjs /app/scripts/docker-migrate.mjs
COPY scripts/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
  && chown -R nextjs:nodejs /app

USER nextjs
EXPOSE 5100
ENTRYPOINT ["/app/docker-entrypoint.sh"]
