import { useCallback, useEffect, useRef, useState } from "react";
import { api, type User } from "../api";
import type { ResearchMessage, ResearchSession } from "../types";
import { relativeTime, researchTitleFromQuery } from "../utils";
import { renderDiscussMarkdown } from "./discuss/DiscussPrimitives";

type Props = {
  user: User;
};

function firstName(user: User) {
  return user.name?.split(/\s+/)[0]?.trim() || null;
}

export default function ResearchView({ user }: Props) {
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ResearchMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const name = firstName(user);
  const active = sessions.find((s) => s.id === activeId) ?? null;
  const showLanding = !activeId && messages.length === 0 && !pendingUser && !sending;

  const loadSessions = useCallback(async () => {
    const res = await api.listResearchSessions();
    setSessions(res.sessions);
    return res.sessions;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadSessions();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load research");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadSessions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pendingUser, streaming, sending]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const openSession = async (id: number) => {
    setError(null);
    setActiveId(id);
    setPendingUser(null);
    setStreaming("");
    try {
      const thread = await api.getResearchThread(id);
      setMessages(thread.messages);
      setSessions((prev) => {
        const others = prev.filter((s) => s.id !== thread.session.id);
        return [thread.session, ...others];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open session");
    }
  };

  const startNew = () => {
    abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setPendingUser(null);
    setStreaming("");
    setSending(false);
    setError(null);
    setInput("");
    inputRef.current?.focus();
  };

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;

    setInput("");
    setPendingUser(text);
    setStreaming("");
    setSending(true);
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let sessionId = activeId;
      if (sessionId == null) {
        const created = await api.createResearchSession(researchTitleFromQuery(text));
        sessionId = created.session.id;
        setActiveId(sessionId);
        setSessions((prev) => [created.session, ...prev.filter((s) => s.id !== sessionId)]);
      }

      await api.sendResearchChat({
        sessionId,
        message: text,
        signal: controller.signal,
        onChunk: (_c, full) => setStreaming(full),
      });

      const thread = await api.getResearchThread(sessionId);
      setMessages(thread.messages);
      setSessions((prev) => {
        const others = prev.filter((s) => s.id !== thread.session.id);
        return [thread.session, ...others];
      });
      setPendingUser(null);
      setStreaming("");
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Couldn't send message");
      if (activeId != null) {
        try {
          const thread = await api.getResearchThread(activeId);
          setMessages(thread.messages);
        } catch {
          /* ignore */
        }
      }
      setPendingUser(null);
      setStreaming("");
    } finally {
      setSending(false);
    }
  };

  const removeSession = async (id: number) => {
    try {
      await api.deleteResearchSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeId === id) startNew();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const composer = (
    <div className="research-composer">
      <div className="research-composer-shell">
        <textarea
          ref={inputRef}
          className="research-input"
          rows={1}
          placeholder="Ask Musely to research…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={sending}
        />
        <button
          type="button"
          className="research-send"
          onClick={() => void send()}
          disabled={!input.trim() || sending}
          aria-label="Send"
        >
          {sending ? "…" : "↑"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="research">
      <aside className="research-sidebar" aria-label="Research history">
        <div className="research-sidebar-head">
          <span className="research-sidebar-title">Research</span>
          <button
            type="button"
            className="sidebar-new-btn"
            onClick={startNew}
            title="New research"
            aria-label="New research"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
        <div className="research-session-list">
          {loading && <p className="research-sidebar-empty">Loading…</p>}
          {!loading && sessions.length === 0 && (
            <p className="research-sidebar-empty">Ask a question to begin.</p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`research-session-row ${activeId === s.id ? "active" : ""}`}
            >
              <button
                type="button"
                className="research-session-btn"
                onClick={() => void openSession(s.id)}
              >
                <span className="research-session-title">{s.title}</span>
                <span className="research-session-time">{relativeTime(s.updated_at)}</span>
              </button>
              <button
                type="button"
                className="research-session-del"
                aria-label="Delete research"
                onClick={() => void removeSession(s.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      <main className="research-main">
        {error && (
          <div className="research-error" onClick={() => setError(null)}>
            {error}
          </div>
        )}

        {showLanding ? (
          <div className="research-landing">
            <h1 className="research-greeting">
              {name ? `What should we research, ${name}?` : "What should we research?"}
            </h1>
            {composer}
          </div>
        ) : (
          <>
            <header className="research-chat-head">
              <h2 className="research-chat-title">{active?.title || "Research"}</h2>
            </header>
            <div className="research-thread">
              {messages.map((m) => (
                <div key={m.id} className={`research-msg ${m.role}`}>
                  <div className="research-msg-avatar" aria-hidden>
                    {m.role === "user" ? "You" : "M"}
                  </div>
                  <div className="research-msg-body">
                    <div className="research-msg-name">
                      {m.role === "user" ? "You" : "Musely Agent"}
                    </div>
                    <div className="research-msg-text">{renderDiscussMarkdown(m.content)}</div>
                  </div>
                </div>
              ))}
              {pendingUser && (
                <div className="research-msg user">
                  <div className="research-msg-avatar" aria-hidden>
                    You
                  </div>
                  <div className="research-msg-body">
                    <div className="research-msg-name">You</div>
                    <div className="research-msg-text">
                      <p>{pendingUser}</p>
                    </div>
                  </div>
                </div>
              )}
              {sending && (
                <div className="research-msg assistant">
                  <div className="research-msg-avatar" aria-hidden>
                    M
                  </div>
                  <div className="research-msg-body">
                    <div className="research-msg-name">Musely Agent</div>
                    {streaming ? (
                      <div className="research-msg-text">{renderDiscussMarkdown(streaming)}</div>
                    ) : (
                      <div className="research-typing" aria-label="Researching">
                        <span />
                        <span />
                        <span />
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>
            <div className="research-composer-dock">{composer}</div>
          </>
        )}
      </main>
    </div>
  );
}
