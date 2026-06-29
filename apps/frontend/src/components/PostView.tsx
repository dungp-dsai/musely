import { useEffect, useMemo, useRef, useState } from "react";
import type { Post, Version } from "../types";
import { api } from "../api";
import { relativeTime, formatDateTime, htmlToText } from "../utils";
import DiffView from "./DiffView";
import Editor from "./Editor";
import QueuePanel from "./QueuePanel";
import TaskChatPanel from "./TaskChatPanel";

function loadEditorContent(post: Post): string {
  return post.draft_content || post.versions[0]?.content || "";
}

interface Props {
  post: Post;
  onChanged: () => void;
  onDeleted: () => void;
}

type Mode = "editor" | "history";

export default function PostView({ post, onChanged, onDeleted }: Props) {
  const versions = post.versions; // newest first
  const latest: Version | undefined = versions[0];

  const [mode, setMode] = useState<Mode>("editor");
  const [title, setTitle] = useState(post.title);
  const [draft, setDraft] = useState(() => loadEditorContent(post));
  const [savingVersion, setSavingVersion] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [focusedFeedbackId, setFocusedFeedbackId] = useState<number | null>(null);
  const [chatTaskId, setChatTaskId] = useState<number | null>(null);
  const [aiPull, setAiPull] = useState<{ id: number; content: string } | null>(null);
  const persistedDraft = useRef(loadEditorContent(post));
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();

  // History comparison selection.
  const [toId, setToId] = useState<number | null>(latest?.id ?? null);
  const [fromId, setFromId] = useState<number | null>(versions[1]?.id ?? null);

  useEffect(() => {
    setTitle(post.title);
    const content = loadEditorContent(post);
    setDraft(content);
    persistedDraft.current = content;
  }, [post.id]);

  // Adopt AI-written versions when the editor matches the last autosaved draft.
  useEffect(() => {
    const serverDraft = post.draft_content ?? "";
    const latestContent = latest?.content ?? "";
    if (
      latest?.source === "ai" &&
      latestContent &&
      draft === serverDraft &&
      latestContent !== draft
    ) {
      setDraft(latestContent);
      persistedDraft.current = latestContent;
      setAiPull({ id: latest.id, content: latestContent });
      api.updatePost(post.id, { draftContent: latestContent }).catch(() => {});
    }
  }, [latest?.id, latest?.content, latest?.source, post.draft_content, post.id, draft]);

  // Keep history selection valid when versions change.
  useEffect(() => {
    if (!versions.find((v) => v.id === toId)) {
      const newTo = latest?.id ?? null;
      setToId(newTo);
      const idx = versions.findIndex((v) => v.id === newTo);
      setFromId(versions[idx + 1]?.id ?? null);
    }
  }, [versions]);

  const versionContent = latest?.content ?? "";
  const versionDirty = draft !== versionContent;
  const isEmpty = htmlToText(draft).trim() === "";

  // Autosave draft only (no new version).
  useEffect(() => {
    if (draft === persistedDraft.current) return;
    autosaveTimer.current = setTimeout(async () => {
      setAutosaving(true);
      try {
        await api.updatePost(post.id, { draftContent: draft });
        persistedDraft.current = draft;
      } finally {
        setAutosaving(false);
      }
    }, 2000);
    return () => clearTimeout(autosaveTimer.current);
  }, [draft, post.id]);

  const toVersion = useMemo(() => versions.find((v) => v.id === toId), [versions, toId]);
  const fromVersion = useMemo(() => versions.find((v) => v.id === fromId), [versions, fromId]);

  const saveTitle = async () => {
    if (title === post.title) return;
    await api.updatePost(post.id, { title });
    onChanged();
  };

  const saveVersion = async () => {
    if (isEmpty || (!versionDirty && versions.length > 0)) return;
    setSavingVersion(true);
    try {
      await api.addVersion(post.id, {
        content: draft,
        title,
        note: versions.length === 0 ? "First draft" : "Edit",
        source: "user",
      });
      await api.updatePost(post.id, { draftContent: draft });
      persistedDraft.current = draft;
      onChanged();
    } finally {
      setSavingVersion(false);
    }
  };

  // ⌘S / Ctrl+S to save a new version.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveVersion();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, versionContent, isEmpty, versions.length, title, post.id]);

  const copyDoc = async () => {
    const text = htmlToText(draft);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([draft], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const queueTask = async (context: string, task: string, from: number, to: number) => {
    await api.addFeedback(post.id, {
      task,
      context,
      contextFrom: from,
      contextTo: to,
      versionId: latest?.id,
    });
    onChanged();
  };

  const markFeedbackDone = async (id: number) => {
    await api.setFeedbackStatus(id, "done");
    if (focusedFeedbackId === id) setFocusedFeedbackId(null);
    if (chatTaskId === id) setChatTaskId(null);
    onChanged();
  };

  const removeFeedback = async (id: number) => {
    await api.deleteFeedback(id);
    if (focusedFeedbackId === id) setFocusedFeedbackId(null);
    if (chatTaskId === id) setChatTaskId(null);
    onChanged();
  };

  const openTaskChat = (id: number) => {
    setChatTaskId(id);
    setFocusedFeedbackId(id);
    setQueueOpen(false);
  };

  const restore = async (v: Version) => {
    if (!confirm(`Restore v${v.version_number} as a new version?`)) return;
    await api.addVersion(post.id, {
      content: v.content,
      title,
      note: `Restored v${v.version_number}`,
      source: "user",
    });
    setMode("editor");
    onChanged();
  };

  const remove = async () => {
    if (!confirm(`Delete "${post.title}" and all its versions?`)) return;
    await api.deletePost(post.id);
    onDeleted();
  };

  const activeTasks = post.feedback.filter((f) => f.status !== "done");
  const chatTask = chatTaskId ? activeTasks.find((f) => f.id === chatTaskId) ?? post.feedback.find((f) => f.id === chatTaskId) : null;

  const pickHistory = (v: Version) => {
    setToId(v.id);
    const idx = versions.findIndex((x) => x.id === v.id);
    setFromId(versions[idx + 1]?.id ?? null);
  };

  return (
    <div className="postview">
      <header className="post-header">
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          placeholder="Untitled"
        />
        <div className="mode-switch">
          <button className={mode === "editor" ? "on" : ""} onClick={() => setMode("editor")}>
            Editor
          </button>
          <button
            className={mode === "history" ? "on" : ""}
            onClick={() => setMode("history")}
            disabled={versions.length === 0}
          >
            History
          </button>
        </div>
        <button className="btn btn-ghost danger" onClick={remove} title="Delete piece">
          Delete
        </button>
      </header>

      {mode === "editor" ? (
        <div className="editor-layout">
          <div className="draft-pane">
            <div className="editor-status">
              {latest ? (
                <>
                  <span className={`pill ${latest.source}`}>
                    {latest.source === "ai" ? "Hermes AI" : "You"}
                  </span>
                  <span className="muted">
                    v{latest.version_number}
                    {versionDirty
                      ? " · unsaved version"
                      : ` · saved ${relativeTime(latest.created_at)}`}
                    {autosaving ? " · drafting…" : ""}
                  </span>
                </>
              ) : (
                <span className="muted">
                  {versionDirty || draft ? "Unsaved draft" : "Start writing"}
                  {autosaving ? " · drafting…" : ""}
                </span>
              )}
              <div className="status-actions">
                <button
                  className={`btn btn-ghost save-btn ${versionDirty ? "ready" : ""}`}
                  onClick={saveVersion}
                  disabled={savingVersion || isEmpty || (!versionDirty && versions.length > 0)}
                  title="Save as new version (⌘S)"
                >
                  {savingVersion
                    ? "Saving…"
                    : versions.length === 0
                      ? "Save version"
                      : versionDirty
                        ? "Save version"
                        : "Saved"}
                </button>
                <button className="btn btn-ghost copy-btn" onClick={copyDoc} title="Copy formatted text">
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>

            <Editor
              initialContent={loadEditorContent(post)}
              resetKey={String(post.id)}
              syncKey={aiPull?.id ?? 0}
              syncContent={aiPull?.content}
              feedbackItems={activeTasks}
              focusedFeedbackId={focusedFeedbackId}
              chatOpen={!!chatTaskId}
              onChange={setDraft}
              onQueueTask={queueTask}
              onOpenTaskChat={(fb) => openTaskChat(fb.id)}
            />
          </div>

          {chatTask && (
            <TaskChatPanel
              taskId={chatTask.id}
              feedback={chatTask}
              onClose={() => setChatTaskId(null)}
              onMarkDone={markFeedbackDone}
              onCancel={removeFeedback}
            />
          )}

          {!chatTaskId && (
            <QueuePanel
              items={activeTasks}
              open={queueOpen}
              selectedId={focusedFeedbackId}
              onToggle={() => setQueueOpen((v) => !v)}
              onSelect={(id) => openTaskChat(id)}
              onDelete={removeFeedback}
              onMarkDone={markFeedbackDone}
            />
          )}
        </div>
      ) : (
        <div className="history-grid">
          <div className="diff-pane">
            <div className="compare-bar">
              <label>
                Compare
                <select
                  value={fromId ?? ""}
                  onChange={(e) => setFromId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">(empty / original)</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.id === toId}>
                      v{v.version_number} · {v.source === "ai" ? "AI" : "you"}
                    </option>
                  ))}
                </select>
              </label>
              <span className="arrow">→</span>
              <label>
                with
                <select value={toId ?? ""} onChange={(e) => setToId(Number(e.target.value))}>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.version_number} · {v.source === "ai" ? "AI" : "you"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {toVersion && (
              <div className="diff-header">
                <span className="muted">
                  Changes from {fromVersion ? `v${fromVersion.version_number}` : "original"} to{" "}
                  v{toVersion.version_number} · {formatDateTime(toVersion.created_at)}
                </span>
                <button className="btn btn-secondary sm" onClick={() => restore(toVersion)}>
                  Restore this version
                </button>
              </div>
            )}

            {toVersion && (
              <DiffView
                oldText={htmlToText(fromVersion?.content ?? "")}
                newText={htmlToText(toVersion.content)}
              />
            )}
          </div>

          <aside className="timeline-pane">
            <div className="section-label">Version history</div>
            {versions.map((v) => (
              <button
                key={v.id}
                className={`timeline-item ${toId === v.id ? "active" : ""}`}
                onClick={() => pickHistory(v)}
              >
                <div className="tl-top">
                  <span className="tl-num">v{v.version_number}</span>
                  <span className={`pill ${v.source}`}>{v.source === "ai" ? "AI" : "you"}</span>
                </div>
                <div className="tl-note">{v.note || "No note"}</div>
                <div className="tl-time muted tiny">{relativeTime(v.created_at)}</div>
              </button>
            ))}
          </aside>
        </div>
      )}
    </div>
  );
}
