# Feed Discuss

Inline Facebook-style comments on a feed card. Each user+post pair gets one Hermes session; Musely SQLite stores the thread for the UI.

## Flow

```
FeedDiscussPanel (modal) → startFeedDiscuss (noti job)
  → POST /api/feed/posts/:id/discuss { message }
  → warm-check agent (202 → client retries, no DB write yet)
  → save user message (SQLite)
  → streamMuselyAgentChat → Hermes /v1/chat/completions
  → SSE tokens → typing bubble
  → onComplete → save assistant message (SQLite) → toast “Your agent replied”
```

Discuss opens as a Facebook-style overlay: post preview on top, scrollable comments, sticky composer. Escape / backdrop closes it.

**Key files:** `feed-discuss.js`, discuss routes in `index.js`, `FeedDiscussPanel.tsx`, `startFeedDiscuss` in `NotificationContext.tsx`.

## Persistence (Musely SQLite)

Messages are saved in the backend DB so the UI does not depend on Hermes history alone.

| Table | Role |
| --- | --- |
| `feed_discussions` | One row per user+post. Holds `hermes_session_id` (`feed-discuss-u{userId}-p{postId}`). |
| `feed_discussion_messages` | Thread rows: `discussion_id`, `role` (`user` \| `assistant`), `content`, `created_at`. |

On POST: after the agent is warm → insert user row → stream Hermes → on complete insert assistant row. GET reads these tables for the panel.

## Hermes request (important)

Backend proxies OpenAI-compatible chat to the user’s agent machine.

| Piece | Value |
| --- | --- |
| URL | `{agentBaseUrl}/chat/completions` |
| Header | `X-Hermes-Session-Id: feed-discuss-u{userId}-p{postId}` |
| Body | `{ messages, stream: true }` |

Session id is stable per user+post (`ensureFeedDiscussion`). Hermes keeps conversation history under that id; Musely also persists messages so reload does not depend on Hermes alone.

### Example upstream request

```http
POST /v1/chat/completions
Authorization: Bearer <agent-api-key>
X-Hermes-Session-Id: feed-discuss-u42-p17
Content-Type: application/json
```

```json
{
  "stream": true,
  "messages": [
    {
      "role": "system",
      "content": "You are discussing a Musely feed item with the user. Stay grounded in this item unless they clearly ask about something else.\n\n## Feed item\nTopic: AI-in-education\nTitle: How Adult Learners Can Enhance Their Education with AI\n\nWhat's new:\n…\n\nWhy it matters:\n…\n\nSources:\n- UW-Madison — How Adult Learners Can Enhance Their Education with AI: https://…\n\nReply helpfully and conversationally. Keep answers concise unless they ask for depth."
    },
    {
      "role": "user",
      "content": "Where is the University of Wisconsin-Madison?"
    }
  ]
}
```

Built by `buildFeedDiscussMessages(post, message)` in `apps/backend/feed-discuss.js`. **Every turn** sends the full post as `system` + the new comment as `user`, so Hermes always knows which card is being discussed.

No custom Hermes skill — free-form chat with post context in the prompt.

## Warm-up rule

Resolve the agent **before** inserting the user row. Client `streamMuselyAgentRequest` retries on `202`; writing first caused duplicate user bubbles and a “follow-up” turn without context.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/feed/posts/:id/discuss` | **Load the thread** for the UI. Ensures a `feed_discussions` row exists, returns `{ discussion, messages }` from Musely SQLite (not from Hermes). Used when Discuss opens and when the noti job finishes (`discussRevision`). |
| `POST /api/feed/posts/:id/discuss` | **Send a comment and stream the agent reply.** Body `{ message }`. Warms agent if needed (`202`), saves the user row, proxies Hermes SSE, then saves the assistant row. Client shows typing from the stream; toast fires when done. |
