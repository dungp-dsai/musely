import { useCallback, useEffect, useRef, useState } from "react";
import { api, API_BASE } from "../api";
import { renderChatMarkdown } from "../lib/chatMarkdown";
import {
  clearLegacySharedChats,
  loadConversations,
  newConversation,
  saveConversations,
  titleFromFirstMessage,
  type ChatMessage,
  type Conversation,
} from "../lib/chatStorage";
import { parseOpenAIStream } from "../lib/muselyAgentStream";

type Props = {
  userId: number;
  onBack: () => void;
};

const SUGGESTIONS = [
  "What can you help me write about?",
  "Find great reading on my interests",
  "Help me outline an article idea",
];

function isToolStatusLine(text: string) {
  return /^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(text.trim()) && text.length < 120;
}

export default function MuselyAgentChat({ userId, onBack }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [configuredModel, setConfiguredModel] = useState<string | null>(null);
  const [model, setModel] = useState<string>("");
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [statusLine, setStatusLine] = useState<string | null>(null);

  const messagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const active =
    conversations.find((c) => c.id === activeId) ??
    conversations[0] ??
    newConversation();

  const persist = useCallback(
    (list: Conversation[], nextActive?: string) => {
      saveConversations(userId, list);
      setConversations(list);
      if (nextActive) setActiveId(nextActive);
    },
    [userId]
  );

  const updateActive = useCallback(
    (updater: (c: Conversation) => Conversation) => {
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === active.id);
        const base = idx >= 0 ? prev[idx] : active;
        const updated = updater({ ...base });
        const list =
          idx >= 0
            ? prev.map((c, i) => (i === idx ? updated : c))
            : [updated, ...prev.filter((c) => c.id !== updated.id)];
        saveConversations(userId, list);
        return list.sort((a, b) => b.updatedAt - a.updatedAt);
      });
    },
    [active, userId]
  );

  useEffect(() => {
    clearLegacySharedChats();
    abortRef.current?.abort();
    setStreaming(false);
    setStatusLine(null);
    setError(null);
    setInput("");

    const list = loadConversations(userId);
    if (list.length) {
      setConversations(list);
      setActiveId(list[0].id);
    } else {
      const c = newConversation();
      setConversations([c]);
      setActiveId(c.id);
      saveConversations(userId, [c]);
    }
  }, [userId]);

  useEffect(() => {
    api.getMuselyAgentModels().then(({ models: m, defaultModel, error: err }) => {
      if (err) setError(err);
      else {
        setModels(m);
        setConfiguredModel(defaultModel ?? null);
        if (m.length) setModel(m[0]);
      }
    });
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [active.messages, streaming, statusLine]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    if (!activeId) return;
    if (!conversations.some((c) => c.id === activeId)) {
      const fresh = newConversation();
      persist([fresh, ...conversations], fresh.id);
    }
  }, [activeId, conversations, persist]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setStatusLine(null);
  };

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || streaming) return;

      const userMsg: ChatMessage = { role: "user", content: text };
      const history = [...active.messages, userMsg];
      const title =
        active.messages.length === 0 ? titleFromFirstMessage(text) : active.title;

      updateActive((c) => ({
        ...c,
        title,
        messages: [...history, { role: "assistant", content: "" }],
        updatedAt: Date.now(),
      }));

      setInput("");
      setError(null);
      setStatusLine(null);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        let res: Response;
        let warmAttempts = 0;
        const MAX_WARM_ATTEMPTS = 40;
        for (;;) {
          res = await fetch(`${API_BASE}/api/musely-agent/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            signal: controller.signal,
            body: JSON.stringify({ messages: history, model: model || undefined }),
          });

          if (res.status === 202) {
            warmAttempts += 1;
            if (warmAttempts > MAX_WARM_ATTEMPTS) {
              throw new Error("Your Musely agent is taking too long to start. Try again.");
            }
            setStatusLine("Starting your Musely agent… (first use can take ~30s)");
            await new Promise((r) => setTimeout(r, 3000));
            if (controller.signal.aborted) return;
            continue;
          }
          break;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed: ${res.status}`);
        }

        setStatusLine(null);
        if (!res.body) throw new Error("No response stream");

        let assistantText = "";
        for await (const chunk of parseOpenAIStream(res.body)) {
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.done) break;
          if (!chunk.content) continue;

          if (isToolStatusLine(chunk.content)) {
            setStatusLine(chunk.content.trim());
            assistantText += chunk.content;
          } else {
            setStatusLine(null);
            assistantText += chunk.content;
          }

          const snapshot = assistantText;
          updateActive((c) => {
            const msgs = [...c.messages];
            msgs[msgs.length - 1] = { role: "assistant", content: snapshot };
            return { ...c, messages: msgs, updatedAt: Date.now() };
          });
        }

        if (!assistantText.trim()) {
          throw new Error(
            "Musely agent returned an empty response. Check that LLM API keys are configured."
          );
        }
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError" || /aborted/i.test(err.message)) return;
        setError(err.message);
        updateActive((c) => {
          const msgs = [...c.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === "assistant" && !last.content) msgs.pop();
          return { ...c, messages: msgs };
        });
      } finally {
        setStreaming(false);
        setStatusLine(null);
        abortRef.current = null;
        textareaRef.current?.focus();
      }
    },
    [active.messages, active.title, input, model, streaming, updateActive]
  );

  const startNewChat = () => {
    stop();
    const c = newConversation();
    persist([c, ...conversations], c.id);
    setError(null);
  };

  const deleteChat = (id: string) => {
    const list = conversations.filter((c) => c.id !== id);
    if (list.length === 0) {
      const c = newConversation();
      persist([c], c.id);
    } else {
      persist(list, list[0].id);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="hc-shell">
      <aside className="hc-sidebar">
        <button type="button" className="hc-sidebar-back" onClick={onBack}>
          ← Back
        </button>
        <button type="button" className="hc-new-chat" onClick={startNewChat}>
          + New chat
        </button>
        <div className="hc-conv-list">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={`hc-conv-item ${c.id === active.id ? "active" : ""}`}
            >
              <button type="button" className="hc-conv-btn" onClick={() => setActiveId(c.id)}>
                <span className="hc-conv-title">{c.title}</span>
              </button>
              {conversations.length > 1 && (
                <button
                  type="button"
                  className="hc-conv-del"
                  title="Delete"
                  onClick={() => deleteChat(c.id)}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="hc-main">
        <header className="hc-topbar">
          <div className="hc-topbar-title">Musely Agent</div>
          {models.length > 1 ? (
            <select
              className="hc-model-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={streaming}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            configuredModel && (
              <span className="hc-model-label" title="LLM from your Musely agent config">
                {configuredModel}
              </span>
            )
          )}
        </header>

        <div className="hc-messages" ref={messagesRef}>
          {active.messages.length === 0 ? (
            <div className="hc-empty">
              <div className="hc-empty-mark">M</div>
              <h1>How can Musely help?</h1>
              <p>
                Your personal writing assistant — curate what to read, brainstorm angles, and
                sharpen drafts.
              </p>
              <div className="hc-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="hc-suggestion" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            active.messages.map((m, i) => (
              <div key={i} className={`hc-row ${m.role}`}>
                <div className="hc-avatar">{m.role === "user" ? "You" : "M"}</div>
                <div className="hc-bubble">
                  {m.role === "assistant" ? (
                    <div className="hc-md">{renderChatMarkdown(m.content)}</div>
                  ) : (
                    <p className="hc-user-text">{m.content}</p>
                  )}
                  {streaming && i === active.messages.length - 1 && m.role === "assistant" && (
                    <span className="hc-cursor" aria-hidden />
                  )}
                </div>
              </div>
            ))
          )}
          {statusLine && (
            <div className="hc-status-line">
              <span className="hc-status-dot" />
              {statusLine}
            </div>
          )}
        </div>

        {error && <div className="hc-error">{error}</div>}

        <footer className="hc-composer-wrap">
          <div className="hc-composer">
            <textarea
              ref={textareaRef}
              className="hc-composer-input"
              rows={1}
              placeholder="Message Musely…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={streaming}
            />
            {streaming ? (
              <button type="button" className="hc-stop" onClick={stop} title="Stop">
                ■
              </button>
            ) : (
              <button
                type="button"
                className="hc-send"
                onClick={() => send()}
                disabled={!input.trim()}
                title="Send"
              >
                ↑
              </button>
            )}
          </div>
          <p className="hc-hint">Enter to send · Shift+Enter for newline</p>
        </footer>
      </div>
    </div>
  );
}
