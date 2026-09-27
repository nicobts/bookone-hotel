# syntax=docker/dockerfile:1.7
#
# apps/admin, the operator console (ADR-030, ADR-031). Next.js standalone
# output: the server and exactly the files it traced, nothing else.
#
#   docker build -f infra/docker/admin.Dockerfile -t bookone-admin .
#
# It never gets a public port. On the VM it listens on the compose network and
# Tailscale serves it to staff; on GCP it is an internal-ingress service
# behind identity-aware access (ADR-033).

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @bookone/admin build

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/admin/.next/static ./apps/admin/.next/static
USER node
EXPOSE 3100
CMD ["node", "apps/admin/server.js"]
