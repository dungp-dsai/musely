---
name: do-research
description: >-
  Researches writing-queue tasks for the user's In Progress piece via Musely
  backend API only. Loads the draft + task list, researches each task, then
  POSTs findings into ai_task_work so the Writer UI can show them. Use when the
  user hits Start on the AI queue, asks you to research queued tasks, find
  references/sources, or when explicitly instructed to run do-research.
---

# Do research

## ⚠️ Your scope — read this first

**Your job is only to work and store data by calling the API. Nothing else.**

| Do | Do not |
|----|--------|
| Read the active post + its tasks via API | Touch the frontend, UI, layout, or Writer chrome |
| Research with web search / browsing | Invent URLs or citations |
| `POST` findings to `/api/feedback/:id/work` | Rewrite the draft or save a new version (not this skill) |
| `POST` claim so status becomes `in_progress` | Mark tasks `done` unless the user explicitly asked |
| Stop when findings are stored | Summarize everything back in chat, paste giant dumps, or talk about the UI |

The Musely **Writer UI loads findings from the database** (`ai_task_work` via the task thread). You never render or preview the panel. **Work → store → done.**

---

## When to use

- User starts the AI queue (“Start agent” / hot pickup)
- User asks to research, find references, sources, facts, or quotes for queued tasks
- You are explicitly told to run the `do-research` skill

**Not this skill:** rewriting the draft / saving a new version (that is a separate writing skill). If a task clearly asks only for research (“find refs”, “sources”, “evidence”), stay here.

---

## Auth (every API call)

Use the machine environment (provisioned for this user):

| Variable | Use |
|----------|-----|
| `CLIENT_URL` | Musely API base — `{CLIENT_URL}/api/...` |
| `AGENT_API_KEY` | Header `X-Agent-Key` |
| `AGENT_USER_ID` | Header `X-Agent-User-Id` |

```http
X-Agent-Key: <AGENT_API_KEY>
X-Agent-User-Id: <AGENT_USER_ID>
Content-Type: application/json   # POST only
```

If the API cannot be called, reply with **only**: `Couldn't research the queue.` — no env debugging or internal details.

---

## Workflow (API only)

### 1. GET active post (full working content)

```http
GET {CLIENT_URL}/api/active
```

Example response:

```json
{
  "post_id": 12,
  "title": "My essay",
  "status": "in_progress",
  "content": "<p>…current draft HTML/text…</p>",
  "saved_version": { "id": 3, "version_number": 2, "source": "user", "note": "", "saved_at": "…" },
  "unsaved_changes": false
}
```

Use `content` as the source document. Use each task’s `context` as the highlighted passage to focus on.

If `post_id` is `null`, reply with **only**: `No active piece to research.` and stop.

### 2. GET tasks for that post

```http
GET {CLIENT_URL}/api/active/tasks
```

Example response:

```json
{
  "post_id": 12,
  "title": "My essay",
  "tasks": [
    {
      "id": 41,
      "context": "And people are worried more than ever about the 10x moment…",
      "task": "Find me some refs about this",
      "status": "pending"
    }
  ]
}
```

- `task` = instruction (what to research)
- `context` = highlighted passage (or empty = whole document)
- Skip tasks with `status: "done"` (API already omits them)
- Prefer `pending` first; `in_progress` means you (or a prior run) already claimed it — still finish if findings are missing

If `tasks` is empty, reply with **only**: `No queued tasks.` and stop.

### 3. For each task — claim → research → store findings

Process tasks **one at a time**.

#### 3a. Claim

```http
POST {CLIENT_URL}/api/feedback/{task_id}/claim
```

Sets status to `in_progress` so the Writer UI shows work is underway.

#### 3b. (Optional) Read existing findings

```http
GET {CLIENT_URL}/api/feedback/{task_id}/work
```

If solid findings already exist and the instruction did not ask to refresh, you may skip re-research for that task.

#### 3c. Research

Using `post.title`, `content`, and the task’s `context` + `task` text:

- Prefer credible primary sources (news, papers, official docs, reputable essays)
- Never invent URLs, quotes, or authors
- Tie every finding back to the highlighted context when present
- Prefer quality over quantity (usually **3–7** strong sources)

#### 3d. POST findings (this is what the UI shows)

```http
POST {CLIENT_URL}/api/feedback/{task_id}/work
```

```json
{
  "result": "# Findings\n\n## Summary\n1–3 sentences tying sources to the task.\n\n## Sources\n1. **Title** — Publisher (Year)\n   - Why it matters: …\n   - https://…\n\n2. …\n"
}
```

Rules for `result`:

- Markdown string (required, non-empty)
- Include a short summary + labeled sources with real URLs
- Keep it readable in the task findings panel — not a raw dump of search SERPs
- On 4xx/5xx, fix the payload and retry **once**

Do **not** mark the feedback `done` in this skill (unless the user explicitly asked). Leaving it `in_progress` (after claim) lets the human review findings and hit ✓ themselves.

### 4. Done — one very short reply

When all applicable tasks have findings stored, send **only** a brief confirmation.

**Never** mention environment variables, API keys, provisioning, the UI, or paste the full research Markdown into chat.

**Good (entire reply):**
- `Done — research saved for 2 tasks.`
- `Finished. Findings stored for the queued tasks.`

**Bad:** listing every URL in chat, UI talk, JSON dumps, or follow-up questions.

The frontend reloads the task thread from the API on its own. **Work → store → one short line → stop.**

---

## API reference (agent only — already exist)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/active` | Active / In Progress piece + full draft `content` |
| `GET` | `/api/active/tasks` | Queue for that piece (`id`, `context`, `task`, `status`) |
| `POST` | `/api/feedback/:id/claim` | Mark task `in_progress` |
| `GET` | `/api/feedback/:id/work` | Read existing findings |
| `POST` | `/api/feedback/:id/work` | **Store findings** (`{ "result": "…" }`) |

Related but **not for this skill**:

| Method | Path | Why not |
|--------|------|---------|
| `POST` | `/api/posts/:id/versions` | Draft rewrites (writing skill) |
| `POST` | `/api/posts/:id/reports` | Version completion reports (after a rewrite) |
| `PUT` | `/api/feedback/:id` | User-owned done/cancel |
| `POST` | `/api/feedback/:id/chat` | Human follow-up chat (UI) |

---

## Example (bash)

```bash
BASE="${CLIENT_URL%/}"
H=(-H "X-Agent-Key: $AGENT_API_KEY" -H "X-Agent-User-Id: $AGENT_USER_ID")

# 1–2. Load piece + tasks
curl -sS "${H[@]}" "$BASE/api/active"
curl -sS "${H[@]}" "$BASE/api/active/tasks"

# 3. Claim + store findings for task 41
curl -sS -X POST "${H[@]}" "$BASE/api/feedback/41/claim"
curl -sS -X POST "${H[@]}" -H "Content-Type: application/json" \
  -d '{"result":"# Findings\n\n## Summary\n…\n\n## Sources\n1. …\n"}' \
  "$BASE/api/feedback/41/work"
```
