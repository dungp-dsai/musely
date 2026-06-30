# Fly Deploy Reference (Musely)

## Architecture

```
Browser → musely-{env}-frontend (nginx :8080, TLS)
            └─ /api/* → http://musely-{env}-backend.flycast (Fly Proxy :80)
                          └─ Express :8081 (SQLite on /data volume)
```

Agent app (`musely-{env}-agent`) is only an image registry. Per-user Hermes machines are spawned by the backend via Fly Machines API.

## Monorepo layout

```
apps/frontend/     React + nginx
apps/backend/      Express + SQLite
apps/agent/        Hermes agent Dockerfile
fly-staging/       fly.toml + secrets.env per app
fly-prod/
scripts/fly-deploy.sh
scripts/fly-ensure-app.sh
scripts/fly-secrets-import.sh
```

## fly.toml conventions

- `dockerfile` paths are **relative to the fly.toml file**: `../../apps/backend/Dockerfile`
- Backend `[[mounts]]` → `/data` for SQLite (`DB_PATH=/data/musely.db`)
- Backend `min_machines_running = 1` (single SQLite writer)
- Backend `force_https = false` (required for flycast)
- Frontend `BACKEND_URL = "http://musely-{env}-backend.flycast"`

## nginx (frontend)

`apps/frontend/nginx.conf.template`:
- `NGINX_ENVSUBST_FILTER=BACKEND_URL` in Dockerfile (only substitute that var)
- `resolver [fdaa::3]:53` + variable `proxy_pass` for flycast DNS
- Do not use `$$uri` escaping — use normal nginx `$uri`

## Flycast setup (once per backend app)

```bash
flyctl ips allocate-v6 --private -a musely-staging-backend
flyctl ips list -a musely-staging-backend
# should show: private ingress
```

DNS: `musely-staging-backend.flycast` resolves on Fly's internal network.

## Secrets

Per-app `secrets.env` (git-ignored); templates in `secrets.env.example`.

| App | Typical secrets |
|-----|-----------------|
| `fly-staging/backend` | SESSION_SECRET, GOOGLE_*, CLIENT_URL, AGENT_API_KEY, FLY_API_TOKEN |
| `fly-staging/agent` | AGENT_API_KEY (must match backend) |
| `fly-staging/frontend` | usually none (BACKEND_URL in fly.toml [env]) |

GitHub Actions: `FLY_API_TOKEN_STAGING` (org-scoped, shared across staging apps).

Backend runtime `FLY_API_TOKEN` (in secrets.env) is for Fly Machines orchestrator — separate from CI deploy token.

## Domains (Vercel DNS → Fly frontend)

| Hostname | Fly app |
|----------|---------|
| `staging.musely.tech` | `musely-staging-frontend` |
| `musely.tech` | `musely-prod-frontend` |

Apex `@` on Vercel: add **A** + **AAAA** from `flyctl certs setup musely.tech -a musely-prod-frontend` to override locked Vercel ALIAS records. Do not point DNS at backend apps.

```bash
flyctl certs add staging.musely.tech -a musely-staging-frontend
flyctl certs add musely.tech -a musely-prod-frontend
flyctl certs show musely.tech -a musely-prod-frontend
```

## CI/CD

| Trigger | Workflow | Token |
|---------|----------|-------|
| Push to `staging` | `deploy-staging.yml` | `FLY_API_TOKEN_STAGING` |
| Manual / `v*` tag | `deploy-prod.yml` | `FLY_API_TOKEN_PROD` |

## Debugging checklist

### 502 on `/api/*` (nginx)

```bash
flyctl logs -a musely-staging-frontend --no-tail | tail -20
```

| Log message | Fix |
|-------------|-----|
| `connection refused` + machine 6PN IP | Use `.flycast`, not `.internal:8081` |
| `could not be resolved ...flycast` | `flyctl ips allocate-v6 --private -a <backend>` |
| `301` redirect loop | Backend `force_https = false` |

### Verify chain

```bash
curl -sL https://staging.musely.tech/api/health
curl -sI https://staging.musely.tech/api/auth/google
curl -sI https://musely-staging-backend.fly.dev/api/health   # direct backend (public)
```

### Docker build path error

Error: `fly-staging/backend/apps/backend/Dockerfile not found`  
→ Use `./scripts/fly-deploy.sh` and `../../apps/...` in fly.toml.

## Production deploy (user-initiated only)

Only when user explicitly asks:

```bash
./scripts/fly-deploy.sh fly-prod/backend/fly.toml --remote-only
./scripts/fly-deploy.sh fly-prod/agent/fly.toml --remote-only
./scripts/fly-deploy.sh fly-prod/frontend/fly.toml --remote-only
```

Or trigger `deploy-prod.yml` via GitHub Actions after merge.
