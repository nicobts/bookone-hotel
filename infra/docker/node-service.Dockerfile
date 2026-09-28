# syntax=docker/dockerfile:1.7
#
# apps/api and apps/worker (ADR-030, ADR-034): one Dockerfile, the app chosen by
# the APP build argument. Persistent Node processes — never edge, never
# serverless (ADR-003's constraint).
#
#   docker build -f infra/docker/node-service.Dockerfile --build-arg APP=api -t bookone-api .
#
# Internal packages are bundled by tsdown, so the runtime image carries only
# the app's production dependencies, installed by `pnpm deploy`.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
ARG APP
RUN test -n "$APP" || (echo "APP build argument is required (api | worker)" && exit 1)
RUN corepack enable
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
RUN pnpm --filter "@bookone/${APP}" build
RUN pnpm --filter "@bookone/${APP}" deploy --prod --legacy /out \
    && cp -r "apps/${APP}/dist" /out/dist

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app
USER node
# api listens on API_PORT (8787); the worker has no inbound HTTP (ADR-034).
EXPOSE 8787
CMD ["node", "dist/index.mjs"]
