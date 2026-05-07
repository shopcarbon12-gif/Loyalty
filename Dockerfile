# syntax=docker/dockerfile:1.7
# Carbon Loyalty — Coolify build target.
# Mirrors Carbon-POS's Dockerfile shape (Node 20, standalone next output,
# ESC entrypoint that runs migrations before starting the server).

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN node --max-old-space-size=4096 ./node_modules/next/dist/bin/next build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=5100

# Copy standalone server + static assets + migrations + scripts.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules/pg ./node_modules/pg

EXPOSE 5100
ENTRYPOINT ["/bin/sh", "/app/scripts/docker-entrypoint.sh"]
