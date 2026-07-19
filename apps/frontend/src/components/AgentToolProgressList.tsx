import type { AgentToolEvent } from "../lib/agentToolEvents";

/** Compact Open WebUI–style tool activity list inside a chat turn. */
export default function AgentToolProgressList({
  tools,
}: {
  tools: AgentToolEvent[];
}) {
  if (!tools.length) return null;

  return (
    <div className="agent-tools" aria-live="polite">
      {tools.map((t) => (
        <div
          key={t.id}
          className={`agent-tool ${t.status === "running" ? "is-running" : "is-done"}`}
        >
          <span className="agent-tool-mark" aria-hidden>
            {t.status === "running" ? (
              <span className="agent-tool-spinner" />
            ) : (
              <span className="agent-tool-check">✓</span>
            )}
          </span>
          <span className="agent-tool-emoji" aria-hidden>
            {t.emoji || "⚙"}
          </span>
          <span className="agent-tool-body">
            <span className="agent-tool-name">{t.tool}</span>
            {t.label ? <span className="agent-tool-label">{t.label}</span> : null}
          </span>
          <span className="agent-tool-status">
            {t.status === "running" ? "Running" : "Done"}
          </span>
        </div>
      ))}
    </div>
  );
}
