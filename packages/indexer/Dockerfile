# syntax=docker/dockerfile:1.7
# Multi-stage build for the did-stellar-indexer worker.
# Stage 1: build the workspace, prune to production deps.
# Stage 2: minimal runtime.
#
# This is the *worker* image: it ingests registry events into a shared
# store and serves no HTTP. Deploy it alongside did-stellar-api with
# DID_INDEX_MODE=external on the API, so exactly one process writes the
# index and every API replica reads it. A deployment running a single API
# instance does not need this image at all - the API embeds the same
# indexer by default.
#
# Requires DID_INDEX_DATABASE_URL. Without it the worker fills an
# in-memory index that nothing else can read, which is never what you want
# from a separate service.

FROM node:22.22.1-bookworm-slim AS builder
WORKDIR /repo

# Install pnpm via corepack (pinned in root package.json).
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy the whole workspace - the build needs the cross-package deps.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @acta-team/did-stellar run build
RUN pnpm --filter @acta-team/did-stellar-indexer run build

# Trim to production-only deps for the worker.
RUN pnpm --filter @acta-team/did-stellar-indexer deploy --prod /out

# ---------------------------------------------------------------------------
FROM node:22.22.1-bookworm-slim AS runtime
WORKDIR /app

# Non-root user.
RUN useradd --system --uid 10001 --gid nogroup --no-create-home didindexer

# node_modules + package.json come from `pnpm deploy --prod` (pruned).
# dist/ comes from the tsc build output (pnpm deploy does NOT copy it).
COPY --from=builder --chown=didindexer:nogroup /out/node_modules ./node_modules
COPY --from=builder --chown=didindexer:nogroup /out/package.json ./package.json
COPY --from=builder --chown=didindexer:nogroup /repo/packages/indexer/dist ./dist

ENV NODE_ENV=production

USER didindexer

# No EXPOSE and no HEALTHCHECK: the worker listens on nothing. Liveness is
# the process staying up; the platform restart policy covers the rest, and
# per-network ingestion state is visible through the API's /health.
CMD ["node", "dist/bin/worker.js"]
