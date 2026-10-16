# syntax=docker/dockerfile:1
FROM postgres:17-bookworm@sha256:3645570cccdfa447589da9f57dd740faa29b30938e861289a5574b6ca6b03826 AS postgres-tools
RUN mkdir -p /pg-runtime/bin /pg-runtime/lib && \
    cp /usr/lib/postgresql/17/bin/pg_dump /usr/lib/postgresql/17/bin/pg_restore /usr/lib/postgresql/17/bin/psql /pg-runtime/bin/ && \
    for binary in /pg-runtime/bin/*; do ldd "$binary" | awk '/=> \// { print $3 }'; done | sort -u | xargs -r cp -L -t /pg-runtime/lib
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
ARG SOURCE_REVISION
ARG MIGRATIONS_SHA256
RUN SOURCE_REVISION=$SOURCE_REVISION MIGRATIONS_SHA256=$MIGRATIONS_SHA256 node tools/build-provenance.mjs
RUN npm run build

FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS web
ARG SOURCE_REVISION
ARG MIGRATIONS_SHA256
LABEL org.opencontainers.image.revision=$SOURCE_REVISION org.nipt.migrations.sha256=$MIGRATIONS_SHA256
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/tools/runtime-env.mjs ./tools/runtime-env.mjs
COPY --from=build --chown=node:node /app/build-provenance.json ./build-provenance.json
COPY --from=build --chown=node:node /app/db/migrations ./db/migrations
USER node
CMD ["node", "--import", "./tools/runtime-env.mjs", "server.js"]

FROM dependencies AS operations
ARG SOURCE_REVISION
ARG MIGRATIONS_SHA256
LABEL org.opencontainers.image.revision=$SOURCE_REVISION org.nipt.migrations.sha256=$MIGRATIONS_SHA256
RUN npm prune --omit=dev
COPY --from=postgres-tools /pg-runtime /opt/postgresql
RUN mkdir -p /opt/postgresql/wrappers && for binary in pg_dump pg_restore psql; do printf '#!/bin/sh\nLD_LIBRARY_PATH=/opt/postgresql/lib exec /opt/postgresql/bin/%s "$@"\n' "$binary" > /opt/postgresql/wrappers/"$binary"; chmod 755 /opt/postgresql/wrappers/"$binary"; done
ENV PG_BIN=/opt/postgresql/wrappers
COPY --chown=node:node . .
RUN SOURCE_REVISION=$SOURCE_REVISION MIGRATIONS_SHA256=$MIGRATIONS_SHA256 node tools/build-provenance.mjs
USER node
CMD ["node", "--import", "./tools/runtime-env.mjs", "--import", "tsx", "apps/worker/main.ts"]

FROM dependencies AS browser-dependencies
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
RUN npm prune --omit=dev && npx playwright install --with-deps chromium && chmod -R a+rX /opt/playwright

FROM browser-dependencies AS renderer
ARG SOURCE_REVISION
ARG MIGRATIONS_SHA256
LABEL org.opencontainers.image.revision=$SOURCE_REVISION org.nipt.migrations.sha256=$MIGRATIONS_SHA256
COPY --chown=node:node . .
RUN SOURCE_REVISION=$SOURCE_REVISION MIGRATIONS_SHA256=$MIGRATIONS_SHA256 node tools/build-provenance.mjs
USER node
CMD ["node", "--import", "./tools/runtime-env.mjs", "--import", "tsx", "apps/renderer/main.ts"]
