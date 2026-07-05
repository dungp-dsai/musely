export function buildFeedRefreshMessages(prefs) {
  const topics = prefs?.topics ?? { interests: "", read: [], write: [] };
  const parts = [
    "Given this user preference, go build feed for them. Use the build-feed skill to do it right.",
    "",
    "User preferences:",
    topics.interests,
  ];

  if (topics.read?.length) {
    parts.push("", `Read topics: ${topics.read.join(", ")}`);
  }
  if (topics.write?.length) {
    parts.push("", `Write topics: ${topics.write.join(", ")}`);
  }

  return [{ role: "user", content: parts.join("\n") }];
}
