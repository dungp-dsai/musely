# Fly Deploy Reference (Musely)

## Architecture

```
Browser → musely-{env}-frontend (nginx :8080, TLS)
            └─ /api/* → http://musely-{env}-backend.flycast (Fly Proxy :80)
                          └─ Express :8081 (SQLite on /data volume)
```

Agent app (`musely-{env}-agent`) is only an image registry. Per-user Hermes machines are spawned by the backend via Fly Machines API using `registry.fly.io/musely-{env}-agent:latest`.

## Monorepo layout

```
apps/frontend/     React + nginx
apps/backend/      Express + SQLite
apps/agent/        Hermes agent Dockerfile
fly-staging/       fly.toml + secrets.env per app
fly-prod/
.github/workflows/ deploy-staging.yml, deploy-prod.yml
scripts/fly-deploy.sh      # CI only — never run locally
scripts/fly-ensure-app.sh  # CI only — never run locally
scripts/fly-secrets-import.sh
```

## CI/CD (sole deploy path)

### Staging — `deploy-staging.yml`

Trigger: **push to `staging`**

Jobs (parallel except frontend waits on backend):

1. `deploy-backend` — `fly-ensure-app.sh` + `fly-deploy.sh fly-staging/backend/fly.toml --remote-only`
2. `deploy-agent` — same for `fly-staging/agent/fly.toml` (image tagged `latest`)
3. `deploy-frontend` — same for `fly-staging/frontend/fly.toml` (`needs: deploy-backend`)

### Production — `deploy-prod.yml`

Trigger: **push to `main`**, **`workflow_dispatch`**, or **`v*` tag**

Same three jobs for `fly-prod/*`. `cancel-in-progress: false` — never cancel in-flight prod deploys.

### Why no local deploy

- Consistent build context and tokens via GitHub secrets
- Audit trail in Actions
- Staging-first gate before prod merge
- Agent images always get `--image-label latest` (required by `FLY_AGENT_IMAGE` in backend fly.toml)

## fly.toml conventions

- `dockerfile` paths relative to fly.toml: `../../apps/backend/Dockerfile`
- Backend `[[mounts]]` → `/data` for SQLite
- Backend `min_machines_running = 1`, `force_https = false`
- Frontend `BACKEND_URL = "http://musely-{env}-backend.flycast"`
- Backend `FLY_AGENT_IMAGE = "registry.fly.io/musely-{env}-agent:latest"`

## nginx (frontend)

`apps/frontend/nginx.conf.template`:

- `NGINX_ENVSUBST_FILTER=BACKEND_URL` in Dockerfile
- `resolver [fdaa::3]:53` + variable `proxy_pass` for flycast DNS

## Secrets

| App | Typical secrets |
|-----|-----------------|
| `fly-staging/backend` | SESSION_SECRET, GOOGLE_*, CLIENT_URL, AGENT_API_KEY, **MACHINES_API_TOKEN** |
| `fly-staging/agent` | AGENT_API_KEY (must match backend) |

- **GitHub** `FLY_API_TOKEN_STAGING` / `FLY_API_TOKEN_PROD` — CI deploy only
- **Fly secret** `MACHINES_API_TOKEN` on backend — runtime Machines orchestrator (not `FLY_API_TOKEN`; Fly strips that name)

Import secrets locally (not a deploy):

```bash
./scripts/fly-secrets-import.sh fly-staging/backend
```

## Domains

| Hostname | Fly app |
|----------|---------|
| `staging.musely.tech` | `musely-staging-frontend` |
| `musely.tech` | `musely-prod-frontend` |

DNS A/AAAA → **frontend** app IPs only. Certs via `flyctl certs add` (one-time infra).

## Debugging (read-only flyctl OK)

### Check deploy status

GitHub Actions → workflow run for the branch push.

### 502 on `/api/*`

```bash
flyctl logs -a musely-staging-frontend --no-tail | tail -20
```

| Log | Fix |
|-----|-----|
| `connection refused` + 6PN IP | Use `.flycast`, not `.internal:8081` |
| `could not be resolved ...flycast` | `flyctl ips allocate-v6 --private -a <backend>` |
| `301` redirect loop | Backend `force_https = false` |

### Verify endpoints

```bash
curl -sL https://staging.musely.tech/api/health
curl -sL https://staging.musely.tech/api/config
curl -sI https://staging.musely.tech/api/auth/google
```

### Agent `manifest unknown tag=latest`

Agent app was deployed without `latest` tag. Push to `staging`/`main` so CI re-runs `fly-deploy.sh` on `*/agent/fly.toml` (adds `--image-label latest`).

### Orchestrator disabled on staging

`curl -sL https://staging.musely.tech/api/config` → `orchestratorEnabled: false`

Import `MACHINES_API_TOKEN` into backend secrets, then push to `staging` to redeploy backend.

### Docker build path error in CI

Error: `fly-staging/backend/apps/backend/Dockerfile not found`  
→ `dockerfile` in fly.toml must be `../../apps/...`; CI must use `fly-deploy.sh` (not raw `flyctl deploy --config`).

## Production deploy (user-initiated only)

When user explicitly requests prod:

1. Verify staging
2. User merges to `main` (or triggers `deploy-prod.yml` manually)
3. Monitor GitHub Actions — **do not run flyctl deploy locally**
