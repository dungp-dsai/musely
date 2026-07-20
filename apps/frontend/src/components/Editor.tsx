import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, useEditorState, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import SelectionPopup from "./SelectionPopup";
import SelectionToolbar from "./SelectionToolbar";
import TaskHoverCard from "./TaskHoverCard";
import type { Feedback } from "../types";
import { api } from "../api";
import {
  TaskHighlight,
  setTaskHighlightState,
  TASK_HIGHLIGHT_META,
  type TaskHighlightItem,
} from "../extensions/taskHighlight";
import { ImageWithCaption } from "../extensions/imageWithCaption";

interface Props {
  initialContent: string;
  resetKey: string;
  syncKey?: number;
  syncContent?: string;
  placeholder?: string;
  feedbackItems: Feedback[];
  focusedFeedbackId: number | null;
  chatOpen?: boolean;
  onChange: (html: string) => void;
  onBaseline?: (html: string) => void;
  onQueueTask?: (context: string, task: string, from: number, to: number) => void;
  onOpenTaskChat?: (feedback: Feedback) => void;
}

type SelAnchor = { context: string; from: number; to: number; x: number; y: number };

function selectionAnchor(editor: TiptapEditor): SelAnchor | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const text = editor.state.doc.textBetween(from, to, " ").trim();
  if (!text) return null;
  const coords = editor.view.coordsAtPos(to);
  return {
    context: text,
    from,
    to,
    x: coords.left,
    y: coords.bottom + 10,
  };
}

export default function Editor({
  initialContent,
  resetKey,
  syncKey,
  syncContent,
  placeholder,
  feedbackItems,
  focusedFeedbackId,
  chatOpen,
  onChange,
  onBaseline,
  onQueueTask,
  onOpenTaskChat,
}: Props) {
  const editorWrap = useRef<HTMLDivElement>(null);
  const [chip, setChip] = useState<SelAnchor | null>(null);
  const [composer, setComposer] = useState<SelAnchor | null>(null);
  const [hover, setHover] = useState<{ feedback: Feedback; x: number; y: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();
  const chipTimer = useRef<ReturnType<typeof setTimeout>>();
  const selecting = useRef(false);
  const composerOpen = useRef(false);
  const imageUploadInFlight = useRef(false);

  const highlightItems: TaskHighlightItem[] = useMemo(
    () =>
      feedbackItems
        .filter((f) => f.context.trim())
        .map((f) => ({
          id: f.id,
          context: f.context,
          task: f.content,
          status: f.status,
          contextFrom: f.context_from,
          contextTo: f.context_to,
          colorIndex: f.id % 6,
        })),
    [feedbackItems]
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder || "Start writing…" }),
      TaskHighlight,
      ImageWithCaption,
    ],
    content: initialContent || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (!editor) return;
    setTaskHighlightState(highlightItems, focusedFeedbackId);
    editor.view.dispatch(editor.state.tr.setMeta(TASK_HIGHLIGHT_META, true));
  }, [editor, highlightItems, focusedFeedbackId]);

  useEffect(() => {
    if (!focusedFeedbackId) return;
    const el = editorWrap.current?.querySelector(
      `[data-feedback-id="${focusedFeedbackId}"]`
    ) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusedFeedbackId]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(initialContent || "", { emitUpdate: false });
    onBaseline?.(editor.getHTML());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, editor]);

  useEffect(() => {
    if (!editor || !syncKey || !syncContent) return;
    editor.commands.setContent(syncContent, { emitUpdate: false });
    onBaseline?.(editor.getHTML());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey, editor]);

  useEffect(() => {
    const root = editorWrap.current?.querySelector(".ProseMirror");
    if (!root || chatOpen) return;

    const onMove = (e: Event) => {
      const me = e as MouseEvent;
      const el = (me.target as HTMLElement).closest(".task-hl") as HTMLElement | null;
      if (!el?.dataset.feedbackId) {
        hoverTimer.current = setTimeout(() => setHover(null), 120);
        return;
      }
      clearTimeout(hoverTimer.current);
      const id = Number(el.dataset.feedbackId);
      const fb = feedbackItems.find((f) => f.id === id);
      if (!fb) return;
      setHover({ feedback: fb, x: me.clientX, y: me.clientY });
    };

    const onClick = (e: Event) => {
      const el = (e.target as HTMLElement).closest(".task-hl") as HTMLElement | null;
      if (!el?.dataset.feedbackId || !onOpenTaskChat) return;
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(hoverTimer.current);
      setHover(null);
      const id = Number(el.dataset.feedbackId);
      const fb = feedbackItems.find((f) => f.id === id);
      if (fb) onOpenTaskChat(fb);
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("click", onClick);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("click", onClick);
      clearTimeout(hoverTimer.current);
    };
  }, [feedbackItems, editor, onOpenTaskChat, chatOpen]);

  useEffect(() => {
    if (chatOpen) setHover(null);
  }, [chatOpen]);

  useEffect(() => {
    composerOpen.current = Boolean(composer);
  }, [composer]);

  const clearSelectionUi = useCallback(() => {
    clearTimeout(chipTimer.current);
    setChip(null);
    setComposer(null);
  }, []);

  const scheduleChip = useCallback(() => {
    if (!editor || !onQueueTask || composerOpen.current) return;
    clearTimeout(chipTimer.current);
    const anchor = selectionAnchor(editor);
    if (!anchor) {
      setChip(null);
      return;
    }
    // Brief pause so drag-select / delete / copy aren't interrupted.
    chipTimer.current = setTimeout(() => {
      if (selecting.current || composerOpen.current) return;
      const next = selectionAnchor(editor);
      if (next) setChip(next);
      else setChip(null);
    }, 280);
  }, [editor, onQueueTask]);

  const openComposer = useCallback(
    (anchor?: SelAnchor | null) => {
      if (!editor || !onQueueTask) return;
      const next = anchor ?? selectionAnchor(editor);
      if (!next) return;
      clearTimeout(chipTimer.current);
      setChip(null);
      setComposer(next);
    },
    [editor, onQueueTask]
  );

  // Selection lifecycle: chip only (never auto-open the full form).
  useEffect(() => {
    if (!editor || !onQueueTask) return;

    const onSelectionUpdate = () => {
      if (selecting.current) {
        setChip(null);
        return;
      }
      if (composerOpen.current) return;
      const { empty } = editor.state.selection;
      if (empty) {
        clearTimeout(chipTimer.current);
        setChip(null);
        return;
      }
      scheduleChip();
    };

    editor.on("selectionUpdate", onSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", onSelectionUpdate);
      clearTimeout(chipTimer.current);
    };
  }, [editor, onQueueTask, scheduleChip]);

  // ⌘/Ctrl+K opens the composer for the current selection.
  useEffect(() => {
    if (!editor || !onQueueTask) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("textarea, input, .sel-popup")) return;
      if (!editor.isFocused && !editorWrap.current?.contains(document.activeElement)) return;
      const anchor = selectionAnchor(editor);
      if (!anchor) return;
      e.preventDefault();
      openComposer(anchor);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor, onQueueTask, openComposer]);

  // Paste image → upload + insert image block (caption via right-click).
  useEffect(() => {
    if (!editor) return;
    if (chatOpen) return;
    const root = editorWrap.current?.querySelector(".ProseMirror");
    if (!root) return;

    const onPaste = (e: Event) => {
      const ce = e as ClipboardEvent;
      if (imageUploadInFlight.current) return;
      const dt = ce.clipboardData;
      if (!dt) return;
      const items = Array.from(dt.items || []);
      const imageItem = items.find((it) => String(it.type || "").startsWith("image/"));
      if (!imageItem) return;

      const file = imageItem.getAsFile();
      if (!file) return;

      ce.preventDefault();
      ce.stopPropagation();

      imageUploadInFlight.current = true;
      void (async () => {
        try {
          const uploaded = await api.uploadEditorImage(file);
          (editor.chain().focus() as any)
            .insertImageWithCaption({
              src: uploaded.url,
              alt: "",
              caption: "",
              mediaId: uploaded.id,
            })
            .run();
        } catch {
          // Upload failed — leave paste alone.
        } finally {
          imageUploadInFlight.current = false;
        }
      })();
    };

    root.addEventListener("paste", onPaste);
    return () => root.removeEventListener("paste", onPaste);
  }, [editor, chatOpen]);

  const handleMouseDown = () => {
    selecting.current = true;
    clearTimeout(chipTimer.current);
    if (!composerOpen.current) setChip(null);
  };

  const handleMouseUp = () => {
    selecting.current = false;
    if (!composerOpen.current) scheduleChip();
  };

  const submitTask = (task: string) => {
    if (composer && onQueueTask) {
      onQueueTask(composer.context, task, composer.from, composer.to);
    }
    clearSelectionUi();
    editor?.commands.focus();
  };

  return (
    <div className="doc-shell" ref={editorWrap}>
      {editor && (
        <Toolbar
          editor={editor}
          canQueue={Boolean(onQueueTask)}
          onAddTask={() => openComposer()}
        />
      )}
      <div
        className="doc-editor"
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        <EditorContent editor={editor} />
      </div>
      {chip && !composer && (
        <SelectionToolbar
          x={chip.x}
          y={chip.y}
          onAddTask={() => openComposer(chip)}
          onDismiss={() => setChip(null)}
        />
      )}
      {composer && (
        <SelectionPopup
          context={composer.context}
          x={composer.x}
          y={composer.y}
          onSubmit={submitTask}
          onClose={() => {
            setComposer(null);
            editor?.commands.focus();
          }}
        />
      )}
      {hover && !chatOpen && <TaskHoverCard feedback={hover.feedback} x={hover.x} y={hover.y} />}
    </div>
  );
}

function Toolbar({
  editor,
  canQueue,
  onAddTask,
}: {
  editor: TiptapEditor;
  canQueue?: boolean;
  onAddTask?: () => void;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      strike: editor?.isActive("strike") ?? false,
      code: editor?.isActive("code") ?? false,
      h1: editor?.isActive("heading", { level: 1 }) ?? false,
      h2: editor?.isActive("heading", { level: 2 }) ?? false,
      h3: editor?.isActive("heading", { level: 3 }) ?? false,
      bullet: editor?.isActive("bulletList") ?? false,
      ordered: editor?.isActive("orderedList") ?? false,
      quote: editor?.isActive("blockquote") ?? false,
      canUndo: editor?.can().chain().undo().run() ?? false,
      canRedo: editor?.can().chain().redo().run() ?? false,
      hasSelection: editor ? !editor.state.selection.empty : false,
    }),
  });

  const chain = () => editor.chain().focus();

  return (
    <div className="doc-toolbar">
      <button className="tb-btn" title="Undo (⌘Z)" disabled={!s.canUndo} onClick={() => chain().undo().run()}>
        ↶
      </button>
      <button className="tb-btn" title="Redo (⌘⇧Z)" disabled={!s.canRedo} onClick={() => chain().redo().run()}>
        ↷
      </button>
      <span className="tb-sep" />
      <button className={`tb-btn ${s.h1 ? "on" : ""}`} title="Heading 1" onClick={() => chain().toggleHeading({ level: 1 }).run()}>
        H1
      </button>
      <button className={`tb-btn ${s.h2 ? "on" : ""}`} title="Heading 2" onClick={() => chain().toggleHeading({ level: 2 }).run()}>
        H2
      </button>
      <button className={`tb-btn ${s.h3 ? "on" : ""}`} title="Heading 3" onClick={() => chain().toggleHeading({ level: 3 }).run()}>
        H3
      </button>
      <span className="tb-sep" />
      <button className={`tb-btn ${s.bold ? "on" : ""}`} title="Bold (⌘B)" onClick={() => chain().toggleBold().run()}>
        <strong>B</strong>
      </button>
      <button className={`tb-btn ${s.italic ? "on" : ""}`} title="Italic (⌘I)" onClick={() => chain().toggleItalic().run()}>
        <em>I</em>
      </button>
      <button className={`tb-btn ${s.strike ? "on" : ""}`} title="Strikethrough" onClick={() => chain().toggleStrike().run()}>
        <s>S</s>
      </button>
      <button className={`tb-btn ${s.code ? "on" : ""}`} title="Inline code" onClick={() => chain().toggleCode().run()}>
        {"</>"}
      </button>
      <span className="tb-sep" />
      <button className={`tb-btn ${s.bullet ? "on" : ""}`} title="Bullet list" onClick={() => chain().toggleBulletList().run()}>
        •
      </button>
      <button className={`tb-btn ${s.ordered ? "on" : ""}`} title="Numbered list" onClick={() => chain().toggleOrderedList().run()}>
        1.
      </button>
      <button className={`tb-btn ${s.quote ? "on" : ""}`} title="Quote" onClick={() => chain().toggleBlockquote().run()}>
        ❝
      </button>
      {canQueue && onAddTask ? (
        <>
          <span className="tb-sep" />
          <button
            className="tb-btn tb-ai"
            title="Add AI task (⌘K)"
            disabled={!s.hasSelection}
            onClick={onAddTask}
          >
            ✦ Task
          </button>
        </>
      ) : null}
    </div>
  );
}
