# ── build: type-check, bundle and pre-compress (see vite.config.ts) ───────────
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
# .dockerignore keeps a host-built node_modules and dist out of this copy, and
# docs, tests and logs out of the cache key of the build step below.
COPY . .
RUN npm run build

# ── serve: stock nginx without its optional modules (6 MB to pull instead of 26 MB) ──
FROM nginx:stable-alpine-slim
# nginx.conf is the complete configuration; the packaged site and welcome page go.
RUN rm -rf /etc/nginx/conf.d/default.conf /usr/share/nginx/html/*
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
# Fail the image build, not the deployment, on a configuration error.
RUN nginx -t
EXPOSE 80
# docker-compose.yml defines the same check; this one covers a plain `docker run`.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
