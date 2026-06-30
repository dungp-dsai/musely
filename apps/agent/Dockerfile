# Musely per-user Hermes agent image.
#
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

ENV API_SERVER_ENABLED=true \
    API_SERVER_HOST=0.0.0.0 \
    API_SERVER_PORT=8642 \
    GATEWAY_ALLOW_ALL_USERS=true

# Hermes uses s6-overlay (/init must be PID 1). Fly Machines runs Fly's /init as
# PID 1 and spawns the image entrypoint as a child — s6 then fails with:
#   "s6-overlay-suexec: fatal: can only run as pid 1"
# Fix: in a nested PID namespace, Hermes /init becomes PID 1.
# When run under real Docker locally ($$ == 1), skip unshare.
ENTRYPOINT ["sh", "-c", "if [ \"$$\" -eq 1 ]; then exec /init /opt/hermes/docker/main-wrapper.sh; else exec unshare --fork --pid --mount-proc /init /opt/hermes/docker/main-wrapper.sh; fi"]

EXPOSE 8642

HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${API_SERVER_PORT:-8642}/health >/dev/null 2>&1 || exit 1
