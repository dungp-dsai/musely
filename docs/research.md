# Research

Gemini-style workspace where users talk with Musely Agent to research topics. Separate Hermes session per chat; Musely SQLite stores history.

## UI

- Tab: **Feed · Research · Write** (segmented header nav with icons)
- Landing: greeting + large prompt pill + suggestion chips
- Sidebar: New research + recent sessions
- Active chat: streaming agent replies

## Hermes

| Piece | Value |
| --- | --- |
| URL | `{agentBaseUrl}/chat/completions` |
| Header | `X-Hermes-Session-Id: research-u{userId}-s{sessionId}` |
| Body | `{ messages: [system, user], stream: true }` |

System prompt: research persona (sources, depth, skills). Built by `buildResearchMessages` in `apps/backend/research-chat.js`.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/research/sessions` | List recent sessions |
| `POST /api/research/sessions` | Create session |
| `GET /api/research/sessions/:id` | Load `{ session, messages }` |
| `DELETE /api/research/sessions/:id` | Delete session |
| `POST /api/research/sessions/:id/chat` | Stream agent reply (warm-check before DB write) |

## Tables

- `research_sessions` — title, `hermes_session_id`
- `research_messages` — `user` \| `assistant` rows
