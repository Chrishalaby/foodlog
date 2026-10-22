ARG NODE_IMAGE=node:24-trixie-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    CHECKPOINT_DISABLE=1

FROM base AS manifests
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/prisma7.config.ts apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/

FROM manifests AS build
ENV NG_CLI_ANALYTICS=false
RUN npm ci
COPY . .
RUN npm run build -w @food/shared \
 && npm run build -w @food/api \
 && npm run build -w @food/web

FROM manifests AS prod-deps
RUN npm ci --omit=dev --workspace @food/api \
 && mkdir -p apps/api/node_modules

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST_DIR=/app/web \
    PHOTOS_DIR=/app/data/photos
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json ./
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/prisma7.config.ts ./apps/api/
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/catalog ./apps/api/catalog
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist/web/browser ./web
RUN mkdir -p /app/data/photos && chown -R node:node /app/data
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["sh", "-c", "/app/node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
