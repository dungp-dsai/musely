import { useState } from "react";
import type { AgentToolEvent } from "../lib/agentToolEvents";
import AgentToolProgressList from "./AgentToolProgressList";

/** Cursor-style collapsible process summary after an answer. */
export default function AgentExploredSummary({
  tools,
  defaultOpen = false,
}: {
  tools: AgentToolEvent[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!tools.length) return null;

  const label =
    tools.length === 1 ? "Explored" : `Explored · ${tools.length} steps`;

  return (
    <div className={`agent-explored ${open ? "is-open" : ""}`}>
      <button
        type="button"
        className="agent-explored-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="agent-explored-label">{label}</span>
        <span className="agent-explored-chevron" aria-hidden>
          {open ? "▾" : "›"}
        </span>
      </button>
      {open ? (
        <div className="agent-explored-body">
          <AgentToolProgressList tools={tools} />
        </div>
      ) : null}
    </div>
  );
}
