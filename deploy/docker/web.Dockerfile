# Production web image: static Vite build served by nginx. Build from the repo root:
#   docker build -f deploy/docker/web.Dockerfile -t flight-log-web .
# /api is not proxied here; the cluster ingress routes it to the API service.
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @flight-log/web --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build --workspace @flight-log/web

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
