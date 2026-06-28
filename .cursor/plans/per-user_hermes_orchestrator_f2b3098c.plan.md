---
name: Per-user Hermes orchestrator
overview: Add an on-demand orchestration layer so each user gets an isolated Hermes container (seeded from a shared, pre-configured base), with the API routing chat and cron requests to the right instance and an idle reaper stopping inactive containers to conserve RAM on a single VPS.
todos:
  - id: schema
    content: Add hermes_instances table to schema.sql and CRUD helpers in db.js
    status: completed
  - id: orchestrator
    content: "Create server/hermes-orchestrator.js: provision, ensureInstance, idle reaper using docker CLI + base-template seeding"
    status: completed
  - id: chat-route
    content: Refactor hermes-chat.js to accept {baseUrl,apiKey}; wire ensureInstance into chat/models routes with warming state
    status: completed
  - id: cron-route
    content: Update hermes-cron.js to target per-user container via docker exec (list via exec cat jobs.json); call ensureInstance in cron routes
    status: completed
  - id: compose
    content: "Update docker-compose.yml: base template profile, api env + hermes-base mount; runtime-created per-user containers"
    status: completed
  - id: reaper-boot
    content: Start idle reaper from index.js; add instance status/admin endpoint
    status: completed
  - id: ui
    content: Add 'starting instance' state to HermesChat (and optional status dot)
    status: completed
  - id: docs
    content: "Update .env.docker.example and DOCKER.md: base setup, new env vars, RAM budgeting"
    status: completed
isProject: false
---

# Per-user Hermes Orchestrator (on-demand, shared credentials, single host)

## Model
- One container per user: `hermes-user-<id>`, volume `hermes-user-<id>:/opt/data`, on `writer-net`.
- Reachable internally at `http://hermes-user-<id>:8642` (no host port needed).
- Lifecycle: created on first use, started on activity, stopped after idle timeout.
- Shared LLM creds: a pre-configured base template is cloned into each new user volume.

## 1. Base template (one-time, manual)
Keep the existing `hermes-agent` compose service but repurpose it as a setup/template builder (not in the request path). Admin runs `hermes setup` once; its `/opt/data` becomes the seed source `hermes-base` (host dir `./hermes-base`, mounted read-only into the `api` container).

## 2. Registry table — [server/db/schema.sql](server/db/schema.sql)
Add:
- `hermes_instances(user_id PK FK->users, container_name, api_key, status, last_active_at, created_at)`.
CRUD helpers in [server/db.js](server/db.js): `getInstance(userId)`, `upsertInstance(...)`, `touchInstance(userId)`, `setInstanceStatus(...)`, `listInstances()`.

## 3. Orchestrator — new `server/hermes-orchestrator.js`
Uses the `docker` CLI (already installed in `Dockerfile.api`, same approach as cron):
- `provisionInstance(userId)`: generate per-user `api_key`; create volume; seed config via a one-shot `docker run --rm -v hermes-user-<id>:/dest -v <base>:/src:ro alpine cp -a /src/. /dest/`; `docker create` the gateway container with `API_SERVER_*`, `DATABASE_URL`, mem/cpu/`shm-size` limits, on `writer-net`.
- `ensureInstance(userId)`: read registry; provision if missing; `docker start` if stopped; poll `http://<name>:8642/health` until ready (timeout ~45s); `touchInstance`; return `{ baseUrl, apiKey, containerName }`.
- `stopIdleInstances()`: stop containers with `last_active_at` older than `HERMES_IDLE_MINUTES`.
- `startIdleReaper()`: `setInterval` (~60s) calling `stopIdleInstances()`; started from `index.js`.

## 4. Route chat/models to per-user instance — [server/hermes-chat.js](server/hermes-chat.js)
Refactor `streamHermesChat`/`listHermesModels`/`resolveHermesModel` to take `{ baseUrl, apiKey }` instead of global `getHermesApiConfig()`. In [server/index.js](server/index.js):
- `POST /api/hermes/chat`: `const t = await ensureInstance(req.user.id)`; if still warming, stream a status SSE line, then proxy to `t.baseUrl` with `t.apiKey`.
- `GET /api/hermes/models`: same resolution.

## 5. Route cron to per-user container — [server/hermes-cron.js](server/hermes-cron.js)
- `cronBaseArgs(containerName)` -> `["docker","exec",<container>,"hermes","cron"]`.
- Replace host-file read of `jobs.json` with `docker exec <container> cat /opt/data/cron/jobs.json` (per-user volumes are not host-mounted).
- All cron routes in [server/index.js](server/index.js) call `ensureInstance(req.user.id)` first and pass the container name.

## 6. Compose / image — [docker-compose.yml](docker-compose.yml)
- `api`: add `./hermes-base:/opt/hermes-base:ro`, env `HERMES_BASE_DIR`, `HERMES_NETWORK=writer-net`, `HERMES_IMAGE=nousresearch/hermes-agent:latest`, `HERMES_IDLE_MINUTES`, `HERMES_USER_MEMORY/CPU`. Keep docker.sock mount.
- `hermes-agent`: move to a `setup`/template profile (build base only), remove from default request path.
- Per-user containers are created at runtime by the orchestrator (not declared in compose).

## 7. UI (optional, light) — [client/src/components/HermesChat.tsx](client/src/components/HermesChat.tsx)
Show a "Starting your Hermes instance…" state while a 202/warming response is returned, then retry. Optional instance status dot in the Scheduled tasks page.

## 8. Docs/env — [.env.docker.example](.env.docker.example), [DOCKER.md](DOCKER.md)
Document base-template setup, new env vars, idle timeout, RAM budgeting (each active user ~2-4GB), and the one-time `hermes setup` for the template.

## Out of scope (small-scale choice)
Multi-host scheduling, k8s, warm pools, per-user BYO LLM keys (shared creds chosen). These would build on the same registry + orchestrator interface later.