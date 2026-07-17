/** Build the Hermes chat messages for a feed-post discussion turn. */

function formatSources(sources) {
  if (!Array.isArray(sources) || sources.length === 0) return "(none)";
  return sources
    .map((s) => {
      const label = s.label || s.url || "source";
      return s.url ? `- ${label}: ${s.url}` : `- ${label}`;
    })
    .join("\n");
}

function buildPostContext(post) {
  return [
    `You are discussing a Musely feed item with the user. Stay grounded in this item unless they clearly ask about something else.`,
    ``,
    `## Feed item`,
    `Topic: ${post.topic || "(none)"}`,
    `Title: ${post.title}`,
    ``,
    `What's new:`,
    post.whats_new || "(empty)",
    ``,
    `Why it matters:`,
    post.why_it_matters || "(empty)",
    ``,
    `Sources:`,
    formatSources(post.sources),
    ``,
    `Reply helpfully and conversationally. Keep answers concise unless they ask for depth.`,
  ].join("\n");
}

/**
 * Always includes post context as a system message so Hermes knows which
 * feed item the user is talking about (even on warm retries / follow-ups).
 * @param {object} post - serialized feed post
 * @param {string} userMessage
 */
export function buildFeedDiscussMessages(post, userMessage) {
  const comment = String(userMessage || "").trim();
  return [
    { role: "system", content: buildPostContext(post) },
    { role: "user", content: comment },
  ];
}
