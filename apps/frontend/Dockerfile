# Musely frontend — Vite build → nginx static server.
# Build context: repo root. Run: fly deploy --config fly-staging/frontend.fly.toml
#
# BACKEND_URL is injected at runtime by nginx envsubst; VITE_API_URL is an
# optional build-time override (leave empty to rely on the nginx /api proxy).
FROM node:22-bookworm-slim AS build
WORKDIR /build

ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

COPY apps/frontend/package.json apps/frontend/package-lock.json* ./
RUN npm ci
COPY apps/frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine AS runtime

# Only substitute BACKEND_URL — leave nginx $variables ($uri, $host, …) untouched.
ENV NGINX_ENVSUBST_FILTER=BACKEND_URL

# nginx.conf.template uses ${BACKEND_URL}; the official nginx image applies
# envsubst automatically on files in /etc/nginx/templates/ at startup.
COPY apps/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /build/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
