// SQLite stores timestamps as UTC "YYYY-MM-DD HH:MM:SS". Make them local + relative.
export function parseUtc(ts: string): Date {
  return new Date(ts.replace(" ", "T") + "Z");
}

export function relativeTime(ts: string): string {
  const date = parseUtc(ts);
  const diff = Date.now() - date.getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return date.toLocaleDateString();
}

export function formatDateTime(ts: string): string {
  return parseUtc(ts).toLocaleString();
}

// Turn the editor's HTML into readable plain text (used for diffs and copying).
export function htmlToText(html: string): string {
  return (html || "")
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
