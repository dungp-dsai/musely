# Agent API keys

Two keys — do not confuse them.

| Key | Per user? | Set by | Stored |
|-----|-----------|--------|--------|
| `AGENT_API_KEY` | No — one shared secret | You (`openssl rand -hex 32` → Fly backend secrets) | Backend env only; copied to each machine at create |
| `API_SERVER_KEY` | Yes | Backend `newApiKey()` on first provision | `musely_agent_instances.api_key` + machine env |

## When a user instance is created

First boot → `POST /api/musely-agent/instance/ensure` → `provisionInstance(userId)` (Fly: `musely-agent-orchestrator-fly.js`).

1. **`API_SERVER_KEY`** — generated (`randomBytes(32).toString("hex")`), saved in SQLite, injected as `API_SERVER_KEY` on the machine.
2. **`AGENT_USER_ID`** — set to that user's id on the machine.
3. **`AGENT_API_KEY`** — **not** generated; read from backend `process.env.AGENT_API_KEY` and copied onto the machine if set.

## What each key does

- **`API_SERVER_KEY`** — Musely backend/frontend → user's agent (`:8642`, chat/models).
- **`AGENT_API_KEY`** — User's agent → Musely backend (`X-Agent-Key` on `/api/active`, feedback, reports). Same key for all agents.
- **`X-Agent-User-Id`** — Sent on every agent → backend request; must match `AGENT_USER_ID` on that machine. The backend uses it to scope data (`WHERE user_id = ?`).
- **Dev shortcut** — If the backend has `AGENT_USER_ID` set in its own env, the header is optional (single-user local dev only).

## Ops

Set `AGENT_API_KEY` once in `fly-staging/backend/secrets.env` (and match `fly-staging/agent/secrets.env` if used there). Never rotate per user.

See also [agent-instance-provisioning.md](agent-instance-provisioning.md) for new-instance seed + admin sync.
