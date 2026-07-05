# New agent instance + platform sync

## When a new instance is created

Triggered on **first boot** after onboarding → `POST /api/musely-agent/instance/ensure` → `provisionInstance(userId)`.

1. **Check DB** (`musely_agent_instances`) — if row exists, reuse machine + `api_key`.
2. **Else provision:**
   - Generate per-user `API_SERVER_KEY` (random hex)
   - Create Fly volume (or Docker volume) + machine/container
   - Save row in DB (`machine_id`, `volume_id`, `api_key`, …)
3. **Seed platform** (same on Docker and Fly):
   - `syncPlatformToUserVolume(userId, { sections: ["config", "skills", "secrets"] })`
   - Copies admin platform → user's `/opt/data` on the persistent volume
   - On failure: log warning, provision continues

Machine env at create (from backend secrets, not DB):

- `API_SERVER_KEY` — per-user (from step 2)
- `AGENT_API_KEY` — shared platform secret
- `AGENT_USER_ID` — user id
- Optional LLM keys from backend `process.env` (Fly secrets)

## What gets synced (`/opt/data`)

| Section | Source (backend) | Destination |
|---------|------------------|---------------|
| **config** | `/data/musely-agent-platform/` (`config.yaml`, `SOUL.md`) | `/opt/data/config.yaml`, `SOUL.md` |
| **skills** | `…/skills/musely/` | `/opt/data/skills/musely/` |
| **secrets** | SQLite `platform_secrets` (admin Save secrets) | `/opt/data/.env` |

## Admin sync (after users exist)

**Config files** / **Skills** / **Sync env vars** buttons → `POST /api/admin/musely-agent/sync-platform` with one section.

- Loops all rows in `musely_agent_instances`
- Pushes selected section(s) to each user's volume
- Does **not** create machines — user must be provisioned first

New user **after** an admin sync still gets full platform on **first provision** (seed step above). Re-sync from admin only needed when you **change** platform files or secrets later.

## Docker vs Fly

| | Docker | Fly |
|---|--------|-----|
| Seed on first provision | ✓ (in `createContainer`) | ✓ (after `createMachine` + DB row) |
| Mechanism | Alpine container on volume | Start machine → exec → copy to volume |
| Machine destroyed on sync | No | No |

## Credentials note

- `platform_secrets` in SQLite are **plain text** — not encrypted.
- Per-user `api_key` in `musely_agent_instances` is also plain text.
- See [agent-api-keys.md](agent-api-keys.md) for `AGENT_API_KEY` vs `API_SERVER_KEY`.
