# Production API image. Build from the repo root:
#   docker build -f deploy/docker/api.Dockerfile -t flight-log-api .
# The API runs from TypeScript source via tsx (as in dev); @flight-log/shared is consumed as source too.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# All workspace manifests are needed for `npm ci`, but only the api's dependencies are installed.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @flight-log/api --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/api apps/api
COPY deploy/docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN npx prisma generate --schema apps/api/prisma/schema.prisma

ENV NODE_ENV=production \
  HOME=/tmp \
  REFERENCE_DATA_DIR=/tmp/refdata \
  PRISMA_HIDE_UPDATE_MESSAGE=1
USER node
EXPOSE 3000
ENTRYPOINT ["sh", "/usr/local/bin/api-entrypoint.sh"]
