import { useCallback, useEffect, useRef, useState } from "react";
import { api, type User } from "../api";
import type { AgentToolEvent } from "../lib/agentToolEvents";
import { useNotifications } from "../notifications/NotificationContext";
import type { ResearchMessage, ResearchSession } from "../types";
import { relativeTime, researchTitleFromQuery } from "../utils";
import AgentExploredSummary from "./AgentExploredSummary";
import AgentToolProgressList from "./AgentToolProgressList";
import { renderDiscussMarkdown } from "./discuss/DiscussPrimitives";

type Props = {
  user: User;
  /** Deep-link from notification: open this session. */
  focusSessionId?: number | null;
  onFocusSessionHandled?: () => void;
};

function firstName(user: User) {
  return user.name?.split(/\s+/)[0]?.trim() || null;
}

export default function ResearchView({
  user,
  focusSessionId,
  onFocusSessionHandled,
}: Props) {
  const {
    startResearchChat,
    runningResearchJob,
    researchRevision,
    notifications,
  } = useNotifications();
  const [sessions, setSessions] = useState<ResearchSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ResearchMessage[]>([]);
  const [input, setInput] = useState("");
  const [pendingUser, setPendingUser] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const name = firstName(user);
  const anyRunning =
    runningResearchJob?.status === "running" ? runningResearchJob : null;
  const effectiveId = activeId ?? anyRunning?.sessionId ?? null;
  const active =
    sessions.find((s) => s.id === effectiveId) ??
    (anyRunning?.sessionId != null
      ? ({
          id: anyRunning.sessionId,
          title: anyRunning.sessionTitle || "Research",
          updated_at: new Date(anyRunning.updatedAt).toISOString(),
        } as ResearchSession)
      : null);

  const jobForSession =
    effectiveId != null && runningResearchJob?.sessionId === effectiveId
      ? runningResearchJob
      : null;
  const sending = Boolean(jobForSession);
  const streaming = jobForSession?.streamingReply ?? "";
  const tools = (jobForSession?.toolEvents as AgentToolEvent[] | undefined) ?? [];

  const showLanding =
    effectiveId == null &&
    messages.length === 0 &&
    !pendingUser &&
    !sending;

  const loadSessions = useCallback(async () => {
    const res = await api.listResearchSessions();
    setSessions(res.sessions);
    return res.sessions;
  }, []);

  const loadThread = useCallback(async (id: number) => {
    const thread = await api.getResearchThread(id);
    setMessages(thread.messages);
    setSessions((prev) => {
      const others = prev.filter((s) => s.id !== thread.session.id);
      return [thread.session, ...others];
    });
    return thread;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadSessions();
        if (cancelled) return;
        // Resume into an in-flight research session after leaving the tab.
        const running = notifications.find(
          (n) => n.kind === "research_chat" && n.status === "running" && n.sessionId != null
        );
        if (running?.sessionId != null) {
          setActiveId(running.sessionId);
          setPendingUser(running.userMessage ?? null);
          try {
            await loadThread(running.sessionId);
          } catch {
            /* keep pending from job */
          }
        } else if (list[0] && !activeId) {
          /* stay on landing until user picks or asks */
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load research");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only on mount — don't re-run when notifications churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSessions, loadThread]);

  useEffect(() => {
    if (focusSessionId == null) return;
    void (async () => {
      setActiveId(focusSessionId);
      try {
        await loadThread(focusSessionId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't open session");
      }
      onFocusSessionHandled?.();
    })();
  }, [focusSessionId, loadThread, onFocusSessionHandled]);

  useEffect(() => {
    if (researchRevision === 0) return;
    const sid = activeId ?? runningResearchJob?.sessionId;
    if (sid == null) return;
    void loadThread(sid)
      .then(() => {
        setPendingUser(null);
        void loadSessions();
      })
      .catch(() => {
        /* keep current */
      });
  }, [researchRevision, activeId, runningResearchJob?.sessionId, loadThread, loadSessions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pendingUser, streaming, sending, tools.length]);

  // Sync pending user from job when returning mid-flight.
  useEffect(() => {
    if (!jobForSession?.userMessage) return;
    const last = messages[messages.length - 1];
    if (last?.role === "user" && last.content === jobForSession.userMessage) {
      setPendingUser(null);
      return;
    }
    setPendingUser(jobForSession.userMessage);
  }, [jobForSession?.userMessage, jobForSession?.id, messages]);

  const openSession = async (id: number) => {
    setError(null);
    setActiveId(id);
    setPendingUser(null);
    try {
      await loadThread(id);
      const job = notifications.find(
        (n) =>
          n.kind === "research_chat" &&
          n.status === "running" &&
          n.sessionId === id
      );
      if (job?.userMessage) setPendingUser(job.userMessage);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open session");
    }
  };

  const startNew = () => {
    setActiveId(null);
    setMessages([]);
    setPendingUser(null);
    setError(null);
    setInput("");
    inputRef.current?.focus();
  };

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || sending) return;

    setInput("");
    setPendingUser(text);
    setError(null);

    try {
      let sessionId = activeId;
      let sessionTitle = active?.title || researchTitleFromQuery(text);
      if (sessionId == null) {
        const created = await api.createResearchSession(researchTitleFromQuery(text));
        sessionId = created.session.id;
        sessionTitle = created.session.title;
        setActiveId(sessionId);
        setSessions((prev) => [created.session, ...prev.filter((s) => s.id !== sessionId)]);
      }

      startResearchChat({
        sessionId,
        sessionTitle,
        message: text,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start research");
      setPendingUser(null);
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

  const showPending =
    pendingUser &&
    (!messages.length ||
      messages[messages.length - 1]?.role !== "user" ||
      messages[messages.length - 1]?.content !== pendingUser);

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
          {sessions.map((s) => {
            const live =
              runningResearchJob?.sessionId === s.id &&
              runningResearchJob.status === "running";
            return (
              <div
                key={s.id}
                className={`research-session-row ${effectiveId === s.id ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="research-session-btn"
                  onClick={() => void openSession(s.id)}
                >
                  <span className="research-session-title">
                    {live ? (
                      <span className="research-session-live" aria-hidden />
                    ) : null}
                    {s.title}
                  </span>
                  <span className="research-session-time">
                    {live ? "Researching…" : relativeTime(s.updated_at)}
                  </span>
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
            );
          })}
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
                    {m.role === "assistant" && m.tool_events && m.tool_events.length > 0 ? (
                      <AgentExploredSummary tools={m.tool_events} />
                    ) : null}
                    <div className="research-msg-text">{renderDiscussMarkdown(m.content)}</div>
                  </div>
                </div>
              ))}
              {showPending ? (
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
              ) : null}
              {sending && (
                <div className="research-msg assistant">
                  <div className="research-msg-avatar" aria-hidden>
                    M
                  </div>
                  <div className="research-msg-body">
                    <div className="research-msg-name">Musely Agent</div>
                    <AgentToolProgressList tools={tools} />
                    {streaming ? (
                      <div className="research-msg-text">{renderDiscussMarkdown(streaming)}</div>
                    ) : tools.length === 0 ? (
                      <div className="research-typing" aria-label="Researching">
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : (
                      <p className="research-working">Working with tools…</p>
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
