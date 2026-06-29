# Musely backend — Node 22 + SQLite (no Docker socket dependency).
# Build context: repo root. Run: fly deploy --config fly-staging/backend.fly.toml
FROM node:22-bookworm-slim AS deps
WORKDIR /build
COPY apps/backend/package.json apps/backend/package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8081 \
    HOST=0.0.0.0

COPY --from=deps /build/node_modules ./node_modules
COPY apps/backend/ ./

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings=ExperimentalWarning", "index.js"]
