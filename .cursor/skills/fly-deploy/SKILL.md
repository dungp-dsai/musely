---
name: fly-deploy
description: Deploy fixes to Musely on Fly.io via GitHub Actions only. Fix, test, push to staging first; never deploy production unless the user explicitly asks. Never run flyctl deploy or fly-deploy.sh from the local CLI. Use when deploying to Fly, fixing staging/prod Fly issues, fly.toml changes, nginx proxy, flycast, secrets, or GitHub Actions deploy workflows.
---

# Fly.io Deploy (Musely)

## Golden rules

1. **Always fix → test → push to staging → verify staging.**
2. **Never deploy production** unless the user explicitly requests it. Production deploys when the user manually merges to `main` or triggers the prod workflow.
3. **Never deploy from the local CLI.** Do not run `flyctl deploy`, `./scripts/fly-deploy.sh`, or any local deploy command. All deploys go through GitHub Actions.

## CI/CD only — no local deploys

| ❌ Never run locally | ✅ Deploy via |
|---------------------|---------------|
| `flyctl deploy …` | Push to `staging` → `deploy-staging.yml` |
| `./scripts/fly-deploy.sh …` | Merge to `main` / `workflow_dispatch` → `deploy-prod.yml` |
| "Emergency" local deploy | Push a fix to `staging` and wait for CI |

`scripts/fly-deploy.sh` and `scripts/fly-ensure-app.sh` are **CI-only** helpers invoked by `.github/workflows/deploy-staging.yml` and `deploy-prod.yml`. The agent must not execute them locally.

Local `flyctl` is allowed only for **read-only / one-time infra** (not deploy):

- `flyctl status -a <app>`, `flyctl logs -a <app>`, `flyctl machines list -a <app>`
- `flyctl ips allocate-v6 --private -a <backend>` (one-time flycast)
- `flyctl certs show …`, `flyctl secrets list -a <app>`
- `./scripts/fly-secrets-import.sh fly-staging/backend` (secrets, not a deploy)

## Apps (one fly.toml per Fly app)

| Config | Fly app | Public URL |
|--------|---------|------------|
| `fly-staging/frontend/fly.toml` | `musely-staging-frontend` | https://staging.musely.tech |
| `fly-staging/backend/fly.toml` | `musely-staging-backend` | internal only |
| `fly-staging/agent/fly.toml` | `musely-staging-agent` | image registry only |
| `fly-prod/frontend/fly.toml` | `musely-prod-frontend` | https://musely.tech |
| `fly-prod/backend/fly.toml` | `musely-prod-backend` | internal only |
| `fly-prod/agent/fly.toml` | `musely-prod-agent` | image registry only |

Only **frontend** apps get public DNS. Backend is reached via nginx `/api/` proxy.

## Deploy workflow

```
Task Progress:
- [ ] 1. Fix the code/config
- [ ] 2. Test locally (if applicable)
- [ ] 3. Commit and push to staging branch
- [ ] 4. Wait for GitHub Actions (deploy-staging.yml)
- [ ] 5. Verify staging endpoints
- [ ] 6. Stop — user merges to main for prod
```

### Step 1–2: Fix and test locally

```bash
# From repo root — local dev only, not a Fly deploy
npm run dev
curl -s http://localhost:8081/api/health
```

### Step 3: Deploy staging (GitHub Actions)

```bash
git checkout staging
git merge <your-branch>   # or commit directly on staging
git push origin staging
```

This triggers `.github/workflows/deploy-staging.yml`, which runs in parallel:

- **deploy-backend** → `fly-staging/backend`
- **deploy-agent** → `fly-staging/agent` (tags image `latest` via `fly-deploy.sh`)
- **deploy-frontend** → `fly-staging/frontend` (after backend)

Monitor: GitHub → Actions → "Deploy — Staging".

### Step 4: Verify staging

```bash
curl -sL https://staging.musely.tech/api/health
curl -sL https://staging.musely.tech/api/config   # orchestratorEnabled should be true
curl -sI https://staging.musely.tech/api/auth/google   # expect 302, not 502
```

### Step 5: Production

Do **not** deploy prod from the CLI. Tell the user staging is verified; they merge to `main` when ready.

Prod triggers `.github/workflows/deploy-prod.yml` on:

- Push to `main`
- `workflow_dispatch` (manual)
- `v*` tags

## GitHub Actions setup

| Env | Workflow | Trigger | Secret |
|-----|----------|---------|--------|
| Staging | `deploy-staging.yml` | Push to `staging` | `FLY_API_TOKEN_STAGING` |
| Prod | `deploy-prod.yml` | Push to `main`, tag `v*`, or manual | `FLY_API_TOKEN_PROD` |

Optional repo variable: `FLY_ORG`.

Workflows use `superfly/flyctl-actions/setup-flyctl@v1` and call `./scripts/fly-deploy.sh` / `./scripts/fly-ensure-app.sh` **inside CI only**.

## Secrets (not deployed via CI — import locally)

Update `fly-staging/backend/secrets.env` then import (one-time / when secrets change):

```bash
./scripts/fly-secrets-import.sh fly-staging/backend
```

Required for orchestrator on staging: `MACHINES_API_TOKEN` in backend secrets (org-scoped; separate from GitHub `FLY_API_TOKEN_STAGING`).

## Common mistakes (avoid)

| Mistake | Correct |
|---------|---------|
| `flyctl deploy` from local machine | Push to `staging` or merge to `main` |
| `./scripts/fly-deploy.sh` from agent terminal | Let GitHub Actions run it |
| `dockerfile = "apps/backend/Dockerfile"` in fly.toml | `dockerfile = "../../apps/backend/Dockerfile"` |
| `BACKEND_URL = http://...backend.internal:8081` | `BACKEND_URL = http://...backend.flycast` |
| `force_https = true` on backend | `force_https = false` (flycast is HTTP-only) |
| Agent image without `latest` tag | CI `fly-deploy.sh` auto-adds `--image-label latest` for `*/agent/` |
| Deploy prod without user asking | Staging via push; prod only when user merges |

## When frontend nginx changes

Push to `staging` so CI redeploys frontend. `BACKEND_URL` must be `http://musely-{env}-backend.flycast`.

Backend needs Flycast once per env (infra, not deploy):

```bash
flyctl ips allocate-v6 --private -a musely-staging-backend
```

## Additional resources

- Architecture, DNS, debugging: [reference.md](reference.md)
