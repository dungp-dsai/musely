# DEPRECATED — use Dockerfile.api + Dockerfile.web with docker-compose.yml
# writer-app — production image (UI + API on one port)
# Requires Node 22+ for built-in node:sqlite

FROM node:22-bookworm-slim AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server-build
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_DIR=/app/client/dist \
    HERMES_WRITER_DB=/app/data/hermes_writer.db

RUN mkdir -p /app/data

COPY --from=server-build /build/server /app/server
COPY --from=client-build /build/client/dist /app/client/dist
COPY package.json AGENT_GUIDE.md ./

EXPOSE 8080
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
CMD ["node", "--no-warnings=ExperimentalWarning", "index.js"]
