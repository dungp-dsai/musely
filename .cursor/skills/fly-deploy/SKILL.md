---
name: fly-deploy
description: Deploy fixes to Musely on Fly.io. Fix, test, push to staging first; never deploy production unless the user explicitly asks. Use when deploying to Fly, fixing staging/prod Fly issues, fly.toml changes, nginx proxy, flycast, secrets, or GitHub Actions deploy workflows.
---

# Fly.io Deploy (Musely)

## Golden rule

**Always fix → test → deploy staging → verify staging.**  
**Never deploy production** unless the user explicitly requests it. Production is deployed when the user manually merges to the production branch/workflow.

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
- [ ] 3. Deploy or push to staging
- [ ] 4. Verify staging endpoints
- [ ] 5. Stop — user merges to prod manually
```

### Step 1–2: Fix and test locally

```bash
# From repo root
npm run dev                    # backend :8081, frontend :5173
curl -s http://localhost:8081/api/health
```

For nginx/flycast changes, reason about `apps/frontend/nginx.conf.template` and `NGINX_ENVSUBST_FILTER=BACKEND_URL`.

### Step 3: Deploy staging

**Preferred — push to `staging` branch** (triggers `.github/workflows/deploy-staging.yml`):

```bash
git checkout staging
git merge <your-branch>   # or commit directly
git push origin staging
```

**Local emergency deploy** (from repo root, needs `FLY_API_TOKEN`):

```bash
./scripts/fly-ensure-app.sh fly-staging/backend/fly.toml
./scripts/fly-deploy.sh fly-staging/backend/fly.toml --remote-only
./scripts/fly-deploy.sh fly-staging/agent/fly.toml --remote-only
./scripts/fly-deploy.sh fly-staging/frontend/fly.toml --remote-only
```

Always use `./scripts/fly-deploy.sh` — **never** raw `flyctl deploy --config fly-staging/...` (wrong Docker build context).

Deploy order: **backend → agent → frontend** (frontend depends on backend).

### Step 4: Verify staging

```bash
curl -sL https://staging.musely.tech/api/health
# expect: {"ok":true,"db":"sqlite"}

curl -sI https://staging.musely.tech/api/auth/google
# expect: HTTP 302 (redirect to Google), NOT 502
```

If 502 on `/api/*`, see [reference.md](reference.md) — usually flycast or `force_https` on backend.

### Step 5: Production

Do **not** deploy prod. Tell the user staging is verified and they can merge when ready.

Prod deploys via `.github/workflows/deploy-prod.yml` (manual workflow dispatch or `v*` tag) after the user merges.

## Scripts (repo root)

| Script | Purpose |
|--------|---------|
| `scripts/fly-deploy.sh <fly.toml> [--remote-only]` | Deploy with correct monorepo build context |
| `scripts/fly-ensure-app.sh <fly.toml>` | Create Fly app + volume if missing |
| `scripts/fly-secrets-import.sh fly-staging/backend` | Import `secrets.env` into Fly app |

## CI notes

- Staging: push to `staging` branch → uses `FLY_API_TOKEN_STAGING` (org-scoped)
- Use `flyctl` in workflows, not `fly`
- GitHub secret: `FLY_API_TOKEN_STAGING`; optional var: `FLY_ORG`

## Secrets (backend only for OAuth)

After domain changes, update `fly-staging/backend/secrets.env`:

```env
CLIENT_URL=https://staging.musely.tech
GOOGLE_CALLBACK_URL=https://staging.musely.tech/api/auth/google/callback
```

```bash
./scripts/fly-secrets-import.sh fly-staging/backend
```

Match redirect URIs in Google Cloud Console.

## Common mistakes (avoid)

| Mistake | Correct |
|---------|---------|
| `flyctl deploy --config fly-staging/backend/fly.toml` | `./scripts/fly-deploy.sh fly-staging/backend/fly.toml` |
| `dockerfile = "apps/backend/Dockerfile"` in fly.toml | `dockerfile = "../../apps/backend/Dockerfile"` |
| `BACKEND_URL = http://...backend.internal:8081` | `BACKEND_URL = http://...backend.flycast` |
| `force_https = true` on backend | `force_https = false` (flycast is HTTP-only) |
| Agent deploy without `--image-label latest` | `./scripts/fly-deploy.sh fly-*/agent/fly.toml` (auto-tags `latest`) |
| `flyctl apps show` to check app exists | `flyctl status -a <app>` |
| Deploy prod without user asking | Staging only; user merges manually |

## When frontend nginx changes

Redeploy **frontend** after editing `apps/frontend/nginx.conf.template` or `apps/frontend/Dockerfile`.

`BACKEND_URL` in `fly.toml` must be `http://musely-{env}-backend.flycast`.

Backend needs Flycast once per env:

```bash
flyctl ips allocate-v6 --private -a musely-staging-backend
flyctl ips allocate-v6 --private -a musely-prod-backend   # user approval for prod
```

## Additional resources

- Architecture, DNS, domains: [reference.md](reference.md)
