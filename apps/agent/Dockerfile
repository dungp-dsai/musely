# Musely per-user Hermes agent image.
#
# This wraps the upstream Hermes agent and adds Musely-specific defaults.
# Each user gets their own Fly Machine running this image with an isolated
# /opt/data volume and a unique API key injected at machine-create time.
#
# Build context: repo root
# Registry:  registry.fly.io/musely-{staging,prod}-agent:latest
#
# Override the base image at build time:
#   fly deploy --config fly-staging/agent/fly.toml \
#     --build-arg HERMES_BASE=nousresearch/hermes-agent:latest
ARG HERMES_BASE=nousresearch/hermes-agent:latest
FROM ${HERMES_BASE}

# Sensible defaults — all can be overridden by env vars injected at machine
# creation time (see hermes-orchestrator.js createMachine).
ENV API_SERVER_ENABLED=true \
    API_SERVER_HOST=0.0.0.0 \
    API_SERVER_PORT=8642 \
    GATEWAY_ALLOW_ALL_USERS=true

EXPOSE 8642

# Health endpoint exposed by the Hermes gateway.
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${API_SERVER_PORT:-8642}/health >/dev/null 2>&1 || exit 1
