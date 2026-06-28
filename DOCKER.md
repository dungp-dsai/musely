# writer-app — Docker & VPS Setup

One `docker-compose.yml` runs **PostgreSQL**, **API**, **web UI**, and **Hermes Agent** together.

| Service | URL | Role |
|---|---|---|
| **web** | http://localhost:8080 | React UI (nginx) |
| **api** | internal :8081 | Express API + Google auth |
| **postgres** | internal :5432 | PostgreSQL database |
| **hermes-agent** | http://localhost:8642 | Gateway + OpenAI-compatible API |

Hermes and the API share **PostgreSQL** via `DATABASE_URL` so `agent-cli.js` / `AGENT_GUIDE.md` keep working per user.

---

## Google OAuth setup

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**.
2. Create **OAuth 2.0 Client ID** (Web application).
3. **Authorized redirect URI** (must match `.env` exactly):
   - Local Docker: `http://localhost:8080/api/auth/google/callback`
   - VPS: `http://YOUR_VPS_IP:8080/api/auth/google/callback` (or your domain)
4. Copy **Client ID** and **Client secret** into `.env`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
5. Set `SESSION_SECRET` (`openssl rand -hex 32`).

For **local dev** (Vite on :5173, API on :8081), use redirect URI  
`http://localhost:8081/api/auth/google/callback` and `CLIENT_URL=http://localhost:5173`.

---

## Local test (first time)

```bash
cd writer-app

cp .env.docker.example .env
# Edit .env: SESSION_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, HERMES_API_SERVER_KEY

mkdir -p hermes-data

# One-time Hermes setup wizard (writes LLM keys to ./hermes-data/.env)
docker compose run --rm hermes-agent setup

docker compose up -d --build
```

Open **http://localhost:8080** → **Continue with Google** → sidebar **Chat with Hermes**.

Verify:

```bash
curl -s http://localhost:8080/api/health
curl -s http://localhost:8642/health
```

---

## Local dev (without Docker for UI/API)

```bash
# Start Postgres (Docker or local install)
docker compose up -d postgres

cp .env.example .env
# Fill GOOGLE_* and SESSION_SECRET

npm run install:all
npm run dev
```

- Frontend: http://localhost:5173  
- API: http://localhost:8081 (Vite proxies `/api` to the API)

---

## Architecture

```
Browser :8080
    │
    ▼
┌─────────┐   /api/*   ┌─────────┐     ┌──────────┐
│   web   │ ─────────► │   api   │ ──► │ postgres │
│ (nginx) │            │  :8081  │     │  :5432   │
└─────────┘            └────┬────┘     └────▲─────┘
                            │               │
                            │ Hermes chat   │ agent-cli
                            ▼               │
                     ┌──────────────┐       │
                     │ hermes-agent │ ──────┘
                     │    :8642     │
                     └──────────────┘
```

---

## VPS deploy

```bash
rsync -avz --exclude node_modules --exclude hermes-data \
  ~/Documents/writer-app/ user@YOUR_VPS_IP:~/writer-app/

ssh user@YOUR_VPS_IP
cd ~/writer-app
cp .env.docker.example .env
nano .env   # SESSION_SECRET, Google OAuth, strong HERMES_API_SERVER_KEY

mkdir -p hermes-data
docker compose run --rm hermes-agent setup
docker compose up -d --build
```

Set `GOOGLE_CALLBACK_URL` and `CLIENT_URL` to your public URL (e.g. `http://YOUR_VPS_IP:8080`).

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `WRITER_PORT` | `8080` | Host port for web UI |
| `CLIENT_URL` | `http://localhost:8080` | CORS + OAuth redirect after login |
| `SESSION_SECRET` | — | Signs session cookie (required) |
| `GOOGLE_CLIENT_ID` / `SECRET` | — | Google OAuth |
| `GOOGLE_CALLBACK_URL` | `http://localhost:8080/api/auth/google/callback` | Must match Google Console |
| `POSTGRES_*` | `writer` / `writer` / `writer` | Database credentials |
| `HERMES_API_SERVER_KEY` | — | Bearer token (api + Hermes must match, ≥16 chars) |
| `AGENT_API_KEY` | — | Hermes HTTP agent routes (`X-Agent-Key`) |
| `OPENROUTER_API_KEY` | — | Task chat on highlighted passages |

---

## Troubleshooting

**Google sign-in fails** — redirect URI in Google Console must match `GOOGLE_CALLBACK_URL` exactly (including port).

**401 on API after login** — check `SESSION_SECRET` is set and stable across restarts; cookies require same-site fetch (`credentials: 'include'`).

**Hermes API key too short** — `openssl rand -hex 32` for `HERMES_API_SERVER_KEY`; see Hermes logs if `/health` is empty.

**Old monolith container** — remove before upgrading:

```bash
docker rm -f writer-app writer-web writer-api writer-postgres hermes-agent 2>/dev/null
docker compose up -d --build
```

**Logs**

```bash
docker compose logs -f api
docker compose logs -f hermes-agent
docker compose logs -f web
```

**Agent CLI inside Hermes**

```bash
docker exec -w /app hermes-agent node --no-warnings=ExperimentalWarning server/agent-cli.js active
```
