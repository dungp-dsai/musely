# Musely agent platform files — synced into each user's `/opt/data`

Edit these files, then use **Admin → Sync platform to all agents** (or auto-sync on new user provision).

| Path | Purpose |
|------|---------|
| `config.yaml` | Model provider, defaults, guardrails |
| `SOUL.md` | Agent personality |
| `skills/musely/` | Musely-owned skills (overwritten on sync) |
| `.env.example` | Documents API keys — real keys live in backend secrets |

**Not synced** (stay on each user's volume): `sessions/`, `memories/`, user-created `skills/*` outside `skills/musely/`, `cron/`.

Setup once:

```bash
# Optional: run setup in a throwaway container, then copy config here
docker run -it --rm -v "$PWD/musely-agent-platform:/opt/data" musely-agent:local setup
# Move API keys to root .env / Fly backend secrets — do not commit .env
```
