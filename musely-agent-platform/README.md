# Musely agent platform files — synced into each user's `/opt/data`

Edit in **Admin → Musely Agent Platform Setup**, then **Sync to all agents**.

| Path | Purpose |
|------|---------|
| `config.yaml` | Model provider, defaults, guardrails |
| `SOUL.md` | Agent personality |
| `skills/musely/` | Musely-owned skills (create/edit/delete in Admin → Skills) |
| Env variables | Stored in backend DB (Admin → Env variables), merged into each user's `.env` on sync |

**Storage**

| Environment | Where files live |
|-------------|------------------|
| Local dev | `./musely-agent-platform/` on your Mac (bind-mounted into backend container) |
| Fly | `/data/musely-agent-platform/` on the **backend** machine (same SQLite volume as the DB) |

On Fly, sync pushes from the backend storage into each user agent volume (no agent image rebuild required).

**Not synced** (stay on each user's volume): `sessions/`, `memories/`, user-created `skills/*` outside `skills/musely/`, `cron/`.
