---
name: build-feed
description: >-
  Researches and stores personalized feed posts via Musely backend API only.
  Use when the user asks to ingest or update their reading feed, or when
  explicitly instructed to run build-feed.
---

# Build feed

## ⚠️ Your scope — read this first

**Your job is only to work and store data by calling the API. Nothing else.**

| Do | Do not |
|----|--------|
| Research topics (web search) | Touch the frontend, UI, or how posts are displayed |
| `GET` / `POST` the Musely API | Send messages about layout, styling, or feed appearance |
| `POST` feed posts to persist them | Clear the feed, set reactions, or call user-only endpoints |
| Stop when the API returns success | Assume you control what the user sees — the app reads from the API |
| Reply with **one very short** done message (see step 5) | Summarize posts, list headlines, paste JSON, or debug provisioning |

The Musely **frontend loads the feed from the database via its own API calls**.
You never render, preview, or update the UI. **Work → store → done.**

---

## When to use

- User asks to refresh, ingest, or update their feed
- You are explicitly told to run the build-feed skill

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

Every onboarded user already has interests in preferences. Never create placeholder or “set your preferences” posts.

If the API cannot be called, reply with **only**: `Couldn't update the feed.` — no env debugging or internal details.

---

## Workflow (API only)

### 1. GET user preferences

```http
GET {CLIENT_URL}/api/user/preferences
```

Use `topics.interests` (primary) for research and every `why_it_matters`.
Only `PUT` preferences if the user explicitly asked you to update them.

### 2. GET feed history (dedup)

```http
GET {CLIENT_URL}/api/feed/posts?limit=20
```

Do not publish titles that already exist or closely match existing headlines.

### 3. Research → curate **10** news posts

Each post must have: **title**, **whats_new**, **why_it_matters**, **sources**.

- 10 items each time you run this task
- Prioritize highest quality
- Each post is a curated briefing (can synthesize a story), not a single-link dump
- **sources: include every real URL that supports the post** — usually **2–5**, minimum **2** when more than one source exists. Do not collapse research into one citation.
- No duplicate stories (vs history or within the batch)
- Never invent URLs or citations

### 4. POST store posts

```http
POST {CLIENT_URL}/api/feed/posts
```

```json
{
  "posts": [
    {
      "topic": "short label",
      "title": "Headline",
      "whats_new": "1–2 sentences.",
      "why_it_matters": "1–2 sentences for this user.",
      "sources": [
        { "label": "Publisher — title", "url": "https://..." },
        { "label": "Another outlet — related piece", "url": "https://..." },
        { "label": "Primary doc / paper", "url": "https://..." }
      ]
    }
  ]
}
```

Send all 10 in one request when possible. Success: `{ "ok": true, "count": N }`.
On 4xx/5xx, fix the payload and retry once.

### 5. Done — one very short reply

When `POST` succeeds, send **only** a brief confirmation. Nothing else.

**Never** mention environment variables, API keys, provisioning, or internal errors.

**Good (entire reply):**
- `Done — your feed is updated.`
- `Finished. 10 posts saved.`

**Bad:** listing titles, research summaries, UI talk, JSON, or follow-up questions.

The frontend reloads the feed from the API on its own. **Work → store → one short line → stop.**

---

## API reference (agent only)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/user/preferences` | Read interests |
| `PUT` | `/api/user/preferences` | Update interests (only if user asked) |
| `GET` | `/api/feed/posts?limit=20` | History / dedup |
| `POST` | `/api/feed/posts` | **Store posts** |

Not for this skill: reactions, feedback, feed prefs, clear feed, frontend routes.

## Example (bash)

```bash
BASE="${CLIENT_URL%/}"

curl -sS -H "X-Agent-Key: $AGENT_API_KEY" -H "X-Agent-User-Id: $AGENT_USER_ID" \
  "$BASE/api/user/preferences"

curl -sS -H "X-Agent-Key: $AGENT_API_KEY" -H "X-Agent-User-Id: $AGENT_USER_ID" \
  "$BASE/api/feed/posts?limit=20"

curl -sS -X POST -H "X-Agent-Key: $AGENT_API_KEY" -H "X-Agent-User-Id: $AGENT_USER_ID" \
  -H "Content-Type: application/json" -d @feed-batch.json \
  "$BASE/api/feed/posts"
```
