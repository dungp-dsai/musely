/** Build Hermes messages for free-form Research chat. */

export function buildResearchMessages(userMessage) {
  const comment = String(userMessage || "").trim();
  return [
    {
      role: "system",
      content: [
        `You are Musely Agent in Research mode.`,
        `Help the user investigate topics thoroughly: find credible sources, compare viewpoints, and explain clearly.`,
        `Prefer primary sources and real URLs. Say when you're unsure.`,
        `Use research skills when available. Keep answers structured and useful for writing later.`,
        `Be concise unless they ask for depth.`,
      ].join("\n"),
    },
    { role: "user", content: comment },
  ];
}
