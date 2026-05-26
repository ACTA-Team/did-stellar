# syntax=docker/dockerfile:1.7
# Multi-stage build for the did-stellar-api service.
# Stage 1: build the workspace, prune to production deps.
# Stage 2: minimal distroless runtime.

FROM node:22.22.0-bookworm-slim AS builder
WORKDIR /repo

# Install pnpm via corepack (pinned in root package.json).
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy the whole workspace — Turbo's build needs the cross-package deps.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json ./
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @acta-team/did-stellar run build
RUN pnpm --filter did-stellar-api run build

# Trim to production-only deps for the service.
RUN pnpm --filter did-stellar-api deploy --prod /out

# ---------------------------------------------------------------------------
FROM node:22.22.0-bookworm-slim AS runtime
WORKDIR /app

# Non-root user.
RUN useradd --system --uid 10001 --gid nogroup --no-create-home didapi

COPY --from=builder --chown=didapi:nogroup /out/node_modules ./node_modules
COPY --from=builder --chown=didapi:nogroup /out/dist ./dist
COPY --from=builder --chown=didapi:nogroup /out/package.json ./package.json

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER didapi
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
