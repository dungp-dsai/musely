# Fly agent gateway & platform sync (hard constraints)

> **Read this before changing** `musely-agent-orchestrator-fly.js`, `apps/agent/Dockerfile`, or admin sync behavior.
> Lessons from Jul 2026 prod/staging incidents. Violating these recreates 408/412 outages.

Implementation: `apps/backend/musely-agent-orchestrator-fly.js`  
Image: `apps/agent/Dockerfile`  
Related: [agent-instance-provisioning.md](agent-instance-provisioning.md)

---

## Mental model

Each user gets one Fly Machine + volume in `musely-{staging|prod}-agent`.

```
Fly host PID 1
  └─ our ENTRYPOINT (unshare --fork --pid --mount-proc)
       └─ Hermes /init (s6) as PID 1 inside nested namespace
            └─ main-wrapper → hermes gateway run --no-supervise
                 └─ gateway = machine main process
```

Because of the **unshare + nested `/init`** entrypoint (required so Hermes s6 can be PID 1 on Fly), Hermes’s **default supervised** `gateway run` does **not** work on our machines.

---

## Hard rules (do not “fix” without proving on staging)

### 1. Always use `--no-supervise` on Fly

| Setting | Value |
|---------|--------|
| Machine `init.cmd` | `["hermes","gateway","run","--no-supervise","-q","--accept-hooks","--replace"]` |
| Env | `HERMES_GATEWAY_NO_SUPERVISE=1` |
| Dockerfile `CMD` / `ENV` | Same |

**Why:** Without `--no-supervise`, Hermes tries to auto-upgrade to supervised mode. Under our unshare entrypoint the main process exits almost immediately (**exit 143 / SIGTERM** within ~1–2s of `main-hermes` start). Seen on staging machine `48ee71eb773638` after removing `--no-supervise`.

**Do not** remove `--no-supervise` to “make `hermes gateway restart` work.” That trades a working boot for a dead machine.

### 2. Never call `hermes gateway restart` on Fly

With `--no-supervise`, the gateway **is** the main process. Restart SIGTERMs it → VM stops → next Fly exec returns:

- `412 failed_precondition: exec request failed: EOF`
- `412 failed_precondition: machine not running`

Admin sync used to fail **after** a successful file write for this reason (backend logged `platform sync (…) → /opt/data`, then restart killed the VM).

**Allowed after sync:** leave machine running, or **stop** the machine so the next `ensure` cold-starts with new files.  
**Not allowed:** `hermes gateway restart`, and do not bounce stop+start on every sync unless the user explicitly accepts the slow path.

### 3. Volume writes: plain `sh -c`, never nested `/init`

`execOnAgentVolume` must be:

```javascript
execInContainer(machineId, ["sh", "-c", shellScript], opts);
```

**Do not** wrap writes in:

```text
unshare … /init … main-wrapper.sh sh -c '…'
```

That boots a **second** full Hermes/s6 stack inside an already-running machine → hang / `408 Client.Timeout exceeded while awaiting headers` / `s6-linux-init-hpr: unable to talk to shutdownd`.

`/opt/data` is a Fly volume mount on the VM; plain exec sees it.

### 4. Stale `machine_id` in DB → recreate only on Fly **404**

If the user (or ops) deletes the machine on Fly but SQLite still has `machine_id`:

1. Check Fly state **before** sync/repair.
2. Recreate **only** when state is `missing` (HTTP **404**) or `destroyed`.
3. Update DB via `updateInstanceMachineId`.

**Do not** treat auth/network/5xx as “missing” — that creates orphan machines and burns money.

### 5. Fly exec timeout max is 60s

Cap `timeout` on Machines API exec at 60. Retry **408** / EOF carefully; do **not** blindly retry `machine not running` (start the machine instead, or fail clearly).

---

## Duplicate-gateway boot race (why `--no-supervise` + `016` exist)

**Race (historical):**

1. CMD runs foreground `gateway run --no-supervise`
2. Boot reconciler (`02-reconcile-profiles`) sees `gateway_state.json` = `"running"` → starts an **s6-supervised** gateway too
3. Two gateways → machine exits code 1 (“starts then stops”)

**Mitigation:** `apps/agent/016-musely-foreground-gateway` runs when `HERMES_GATEWAY_NO_SUPERVISE=1` and forces `gateway_state.json` to `"stopped"` so reconciler only **registers**, does not start a second gateway.

Hermes docs recommend supervised mode for stock Docker images. That advice assumes Hermes `/init` is real PID 1 **without** our unshare wrapper. On Fly Musely, foreground + `016` is the stable setup.

---

## Admin platform sync — what actually applies

`POST /api/admin/musely-agent/sync-platform` → write files onto `/opt/data` via Fly exec.

| Section | Written to disk? | Running gateway picks it up without restart? |
|---------|------------------|-----------------------------------------------|
| **skills** | Yes | Partially (skills can be rescanned; `/reload-skills` exists in Hermes). Safe to assume disk is source of truth after sync. |
| **config** (`config.yaml`, `SOUL.md`) | Yes | **No** — most settings stay in memory until next gateway start. |
| **secrets** (`.env`) | Yes | **No** for full apply until next start. |

So:

- Sync **does** update the volume.
- A **running** gateway may keep old config/env until the next **cold start** (idle stop → `ensure`, or explicit machine stop then start).
- Reporting sync as failed because restart 412’d was wrong when files already landed.

Preferred post-sync behavior on Fly:

1. Write + verify files.
2. Do **not** call `hermes gateway restart`.
3. Optionally **stop** the machine so the next user session boots with new config (fast stop; avoid full stop+start loop on every sync unless requested).

---

## Admin sync upload path (config / skills tar)

Backend and agent do **not** share a filesystem. For `config` / `skills`, the backend:

1. Builds a **gzip tar** of selected paths under `MUSELY_AGENT_PLATFORM_MOUNT` (`createPlatformTarBuffer`)
2. Base64-chunks it and `printf`s each chunk onto the agent via Fly Machines **exec**
3. Decodes + extracts under `/tmp/musely-platform`, then copies into `/opt/data`

Platform dirs are **per environment** (`/data/musely-agent-platform` on each backend volume). Staging and prod configs are independent.

### Note — Jul 2026: prod config sync gzip failure (staging OK)

**Symptom (admin panel):**

```text
Config: synced 0/1 agents (1 failed).
…: gzip: stdin: not in gzip format tar: Child returned status 1 …
```

**Why staging looked fine:** staging’s `config.yaml` was tiny (~42 bytes), so the upload was one small chunk. Prod had a full Hermes config (~72 KB) → multi-chunk / large `printf` path. Skills often still worked on prod because the skills tarball stayed smaller (~1 chunk).

**Root causes (do not regress):**

| Bug | Effect |
|-----|--------|
| `createPlatformTarBuffer` mixed tar **stderr into the gzip buffer** | Corrupt archive encoded as “valid” base64 |
| Fly exec **auto-retry** on `>>` append | Successful write + lost ACK → **duplicate** chunk → decode not gzip |
| Oversized chunks (~32 KB single-quoted `printf`) | Fragile under guest exec for large prod configs |

**Hard rules for the upload helper (`uploadPlatformTarToMachine`):**

1. Keep tar **stdout** only in the buffer; never append stderr.
2. Use small base64 chunks (~8 KB). Prefer restarting the **whole** upload on failure — never retry a single `>>` append alone.
3. After decode: check base64 length, run `gzip -t`, then `tar -xzf`.
4. When testing “Sync config” on staging, use a **realistic-size** `config.yaml` (not a one-line stub), or the multi-chunk path won’t be exercised.

---

## Symptom → cause cheat sheet

| Error / symptom | Likely cause | Fix direction |
|-----------------|--------------|---------------|
| `404 machine not found` on ensure | DB `machine_id` stale after Fly delete | Recreate only on 404; update DB |
| `408 … awaiting headers` on exec | Nested `unshare`+/`init` for volume write | Plain `sh -c` exec |
| `412 … EOF` after sync success | `hermes gateway restart` killed main process | Never restart gateway in-place on Fly |
| `412 machine not running` | VM already stopped (often after restart/SIGTERM) | Don’t retry blindly; start or leave stopped after sync |
| Machine exits **143** ~1–2s after boot | Supervised CMD without `--no-supervise` under unshare | Restore `--no-supervise` + `HERMES_GATEWAY_NO_SUPERVISE=1` |
| Machine starts then stops (code 1) at boot | Duplicate gateway (foreground + reconcile) | Keep `016` + `NO_SUPERVISE=1` |
| `gzip: stdin: not in gzip format` on admin Sync config | Corrupt / duplicated base64 tar upload (large config); stderr mixed into tar; append+retry | See **Admin sync upload path**; small chunks + whole-upload restart + `gzip -t` |

---

## Code touchpoints

| Concern | Where |
|---------|--------|
| Ensure / recreate missing machine | `ensureInstance` in `musely-agent-orchestrator-fly.js` |
| Volume sync exec | `execOnAgentVolume`, `syncPlatformToUserVolume` |
| Tar build + base64 chunking | `createPlatformTarBuffer`, `chunkBase64` in `musely-agent-platform-sync-runner.js` |
| Fly tar upload / extract | `uploadPlatformTarToMachine` in `musely-agent-orchestrator-fly.js` |
| Post-sync “restart” | `restartUserAgentAfterSync` — must **not** call `hermes gateway restart` |
| Foreground CMD enforcement | `GATEWAY_CMD`, `ensureForegroundGateway`, `ensureMachineGatewayCmd` |
| Agent image CMD/ENV | `apps/agent/Dockerfile` |
| Reconcile race guard | `apps/agent/016-musely-foreground-gateway` |

---

## Deploy note

Changing gateway CMD/ENV requires:

1. Backend deploy (orchestrator patches existing machines on next ensure/sync via `ensureForegroundGateway` / `ensureMachineGatewayCmd`)
2. Agent image deploy (new machines get correct Dockerfile CMD)

Always verify on **staging** first: machine stays up >30s after start, admin sync returns `synced` without 412, files present under `/opt/data`.
