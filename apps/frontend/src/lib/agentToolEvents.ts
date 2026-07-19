import type { AgentToolProgress } from "../lib/muselyAgentStream";

/** Live tool row shown in chat (Open WebUI–style). */
export type AgentToolEvent = {
  id: string;
  tool: string;
  emoji?: string;
  label?: string;
  status: "running" | "completed";
};

export function upsertToolEvent(
  list: AgentToolEvent[],
  progress: AgentToolProgress
): AgentToolEvent[] {
  const status: AgentToolEvent["status"] =
    progress.status === "completed" ? "completed" : "running";
  const id =
    progress.toolCallId ||
    `${progress.tool}:${progress.label || ""}:${list.filter((t) => t.tool === progress.tool).length}`;

  const idx = list.findIndex(
    (t) =>
      (progress.toolCallId && t.id === progress.toolCallId) ||
      (t.status === "running" && t.tool === progress.tool && !progress.toolCallId)
  );

  const next: AgentToolEvent = {
    id,
    tool: progress.tool,
    emoji: progress.emoji,
    label: progress.label,
    status,
  };

  if (idx >= 0) {
    const copy = list.slice();
    copy[idx] = {
      ...copy[idx],
      ...next,
      id: copy[idx].id,
      emoji: next.emoji || copy[idx].emoji,
      label: next.label || copy[idx].label,
    };
    return copy;
  }
  return [...list, next];
}

export function formatToolActivityLine(events: AgentToolEvent[]): string {
  const running = [...events].reverse().find((t) => t.status === "running");
  const last = running || events[events.length - 1];
  if (!last) return "Researching…";
  const label = last.label ? ` — ${last.label}` : "";
  return `${last.emoji ? `${last.emoji} ` : ""}${last.tool}${label}`;
}
