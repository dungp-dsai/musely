import type { ReactNode } from "react";

/** Lightweight markdown for discuss bubbles (links + bold + headings). */
export function renderDiscussMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    const linked = line.replace(
      /(https?:\/\/[^\s)]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    const bold = linked.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    if (/^#{1,3}\s/.test(line)) {
      return (
        <div
          key={i}
          className="feed-discuss-md-h"
          dangerouslySetInnerHTML={{ __html: bold.replace(/^#{1,3}\s/, "") }}
        />
      );
    }
    if (!line.trim()) return <div key={i} className="feed-discuss-md-gap" />;
    return (
      <p key={i} className="feed-discuss-md-p" dangerouslySetInnerHTML={{ __html: bold }} />
    );
  });
}

export function DiscussComment({
  role,
  name,
  time,
  timeDateTime,
  children,
  typing,
}: {
  role: "user" | "assistant";
  name: string;
  time?: string;
  timeDateTime?: string;
  children?: ReactNode;
  typing?: boolean;
}) {
  return (
    <div className={`feed-discuss-msg ${role}`}>
      <div className="feed-discuss-avatar" aria-hidden>
        {role === "user" ? "You" : "M"}
      </div>
      <div className="feed-discuss-msg-body">
        <div className={`feed-discuss-bubble${typing && !children ? " typing-only" : ""}`}>
          <div className="feed-discuss-meta">
            <span className="feed-discuss-name">{name}</span>
            {typing ? (
              <span className="feed-discuss-typing-label">typing…</span>
            ) : time ? (
              <time dateTime={timeDateTime}>{time}</time>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function DiscussTypingDots({ label = "Musely agent is typing" }: { label?: string }) {
  return (
    <div className="feed-discuss-typing" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}
