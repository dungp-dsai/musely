# Hermes Agent Provisioning (Per-User Fly Machines)

When a **new user** logs in, the backend provisions a dedicated Fly Machine + persistent volume inside the agent app (`musely-{env}-agent`).

Implementation: `apps/backend/hermes-orchestrator.js`

## Trigger

On login, the frontend calls `POST /api/hermes/instance/ensure`, which runs `ensureInstance(userId)`:

```javascript
// apps/backend/index.js
app.post("/api/hermes/instance/ensure", requireUser, async (req, res) => {
  // ...
  const target = await ensureInstance(req.user.id);
```

## Flow (new user)

```
Frontend                    Backend                     Fly Machines API          SQLite
   |                           |                              |                    |
   | POST /api/hermes/         |                              |                    |
   |   instance/ensure         |                              |                    |
   |-------------------------->| getInstance(userId) → null   |                    |
   |                           | POST /volumes                |                    |
   |                           |----------------------------->| hermes_user_{id}   |
   |                           | POST /machines + mount       |                    |
   |                           |----------------------------->|                    |
   |                           | INSERT hermes_instances      |------------------->|
   |                           | POST /machines/{id}/start    |                    |
   |                           |----------------------------->|                    |
   |                           | wait started + /health       |                    |
   |<--------------------------| { ready, machineName, ... }  |                    |
```

### Step 1 — `provisionInstance` (first time only)

```javascript
// apps/backend/hermes-orchestrator.js
async function provisionInstance(userId) {
  let instance = await getInstance(userId);

  if (instance?.machine_id) return instance; // already provisioned

  const user = await getUserById(userId);
  const machineName = machineNameForUser(userId, user?.name);
  const apiKey = newApiKey();

  const volumeId = (await findExistingVolume(userId)) || (await createVolume(userId));
  const machine = await createMachine({ machineName, volumeId, apiKey, userId });

  return createInstanceRecord({
    userId,
    machineName,
    machineId: machine.id,
    volumeId,
    apiKey,
  });
}
```

## Machine name

```javascript
export function machineNameForUser(userId, userName) {
  if (userName) {
    const slug = userName
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    if (slug) return `hermes-${slug}-${userId}`;
  }
  return `hermes-user-${userId}`;
}
```

| User | Example machine name |
|------|----------------------|
| `name: "Jane Doe"`, `id: 42` | `hermes-jane-doe-42` |
| no name, `id: 42` | `hermes-user-42` |

Machines are created inside **`FLY_AGENT_APP`** (e.g. `musely-staging-agent`), not the backend app.

## Volume name + mount

**Volume name** (Fly naming rules: `^[a-zA-Z][a-zA-Z0-9_]*$`):

```javascript
function volumeNameForUser(userId) {
  return `hermes_user_${userId}`;
}
```

**Create volume** — 1 GB in `sin`:

```javascript
async function createVolume(userId) {
  const vol = await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/volumes`, {
    name: volumeNameForUser(userId),
    size_gb: 1,
    region: FLY_AGENT_REGION,
  });
  return vol.id;
}
```

**Mount on machine** — volume → `/opt/data` inside the container:

```javascript
const machine = await flyRequest("POST", `/v1/apps/${FLY_AGENT_APP}/machines`, {
  name: machineName,
  region: FLY_AGENT_REGION,
  config: {
    image: FLY_AGENT_IMAGE,
    env,
    mounts: [{ volume: volumeId, path: "/opt/data" }],
    restart: { policy: "no" },
    guest: {
      cpu_kind: "shared",
      cpus: USER_CPUS,
      memory_mb: USER_MEMORY_MB,
    },
  },
  // No skip_launch — machine boots on create. /start only works from "stopped", not "created".
});
```

| What | Value |
|------|-------|
| Volume name | `hermes_user_{userId}` e.g. `hermes_user_42` |
| Mount path | `/opt/data` |
| Size | 1 GB |
| Region | `sin` (`FLY_AGENT_REGION`) |
| Image | `registry.fly.io/musely-{env}-agent:latest` |

Hermes data (cron jobs, etc.) lives under `/opt/data` on that volume.

## Troubleshooting slow `/api/hermes/instance/ensure`

Typical timing (healthy path):

| Step | Duration |
|------|----------|
| Create volume + machine (first user) | 5–30s |
| `waitForMachineState(started)` | VM boot ~1–5s |
| `waitForHealth` (Hermes s6 + API server) | 30–120s cold start |
| **Total first boot** | **~1–3 min** |

If it runs the full **~3 min** then fails with `fetch failed`, the agent process is **not listening on :8642** — not a slow network.

### Common failure: s6-overlay crash on Fly

Agent logs show:

```
s6-overlay-suexec: fatal: can only run as pid 1
Main child exited normally with code: 100
```

Fly marks the VM `started` in ~1s, but Hermes never boots. The backend then polls `/health` for up to 3 minutes → `fetch failed`.

**Fix:** `apps/agent/Dockerfile` uses `unshare` so Hermes `/init` runs as PID 1 inside a nested namespace. Redeploy the **agent** image via CI (`push staging`).

### Common failure: interactive CLI exits immediately

Agent logs show:

```
Warning: Input is not a terminal (fd=0).
Goodbye!
Main child exited normally with code: 0
machine restart policy set to 'no', not restarting
```

The default Hermes Docker CMD runs the interactive TUI (`hermes`), which exits when stdin is not a TTY. User machines must run `hermes gateway run` so the OpenAI-compatible API server listens on `:8642`.

**Fix:** `apps/agent/Dockerfile` sets `CMD ["hermes", "gateway", "run", ...]` and `hermes-orchestrator.js` sets the same `init.cmd` on dynamically created machines. Redeploy the **agent** image, then destroy broken user machines and retry login.

### Common failure: health OK inside machine but `fetch failed` from backend

Fly's private network (6PN) is **IPv6-only**. If `API_SERVER_HOST=0.0.0.0`, the API server listens on IPv4 only and other machines cannot reach `:8642`.

**Fix:** set `API_SERVER_HOST=::` in the agent image and per-machine env (`hermes-orchestrator.js`).

After redeploy, destroy any broken user machine and retry login:

```bash
flyctl machines destroy <machine-id> -a musely-staging-agent --force
```

## Start + health check

After create, `ensureInstance` starts the machine and waits for health:

```javascript
} else if (state === "created") {
  await launchMachine(machineId);   // update API — /start rejects "created"
} else if (state === "stopped") {
  await startMachine(machineId);
}
// ...
await waitForMachineState(machineId, "started", 60);
await waitForHealth(machineId);
```

Backend talks to the agent at:

```
http://{machineId}.vm.{FLY_AGENT_APP}.internal:8642/v1
```

## SQLite registry

Each user gets one row in `hermes_instances`:

```javascript
// apps/backend/db.js
export async function createInstanceRecord({ userId, machineName, machineId, volumeId, apiKey }) {
  db.prepare(
    `INSERT INTO hermes_instances (user_id, machine_name, machine_id, volume_id, api_key, status)
     VALUES (?, ?, ?, ?, ?, 'stopped')
     ON CONFLICT(user_id) DO NOTHING`
  ).run(userId, machineName, machineId ?? null, volumeId ?? null, apiKey);
  return getInstance(userId);
}
```

## Environment variables

Set in `fly-staging/backend/fly.toml` / `fly-prod/backend/fly.toml`:

| Var | Example |
|-----|---------|
| `FLY_AGENT_APP` | `musely-staging-agent` |
| `FLY_AGENT_IMAGE` | `registry.fly.io/musely-staging-agent:latest` |
| `MACHINES_API_TOKEN` | secret — Machines API auth (import via `secrets.env`; **not** `FLY_API_TOKEN`) |
| `FLY_AGENT_REGION` | `sin` |
| `HERMES_USER_MEMORY_MB` | `2048` |
| `HERMES_USER_CPUS` | `1` |

## Returning users

If the user already has a `hermes_instances` row:

- **Machine stopped/created** → `startMachine()` only (volume persists)
- **Machine destroyed externally** → new machine created, same volume reused
- **Machine already started** → health check only

Idle machines are stopped after `HERMES_IDLE_MINUTES` (default 15) by the idle reaper in `startIdleReaper()`.
