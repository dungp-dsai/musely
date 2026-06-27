import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, useEditorState, type Editor as TiptapEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import SelectionPopup from "./SelectionPopup";
import TaskHoverCard from "./TaskHoverCard";
import type { Feedback } from "../types";
import {
  TaskHighlight,
  setTaskHighlightState,
  TASK_HIGHLIGHT_META,
  type TaskHighlightItem,
} from "../extensions/taskHighlight";

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

type PopupState = { context: string; from: number; to: number; x: number; y: number } | null;
type HoverState = { feedback: Feedback; x: number; y: number } | null;

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
  const [popup, setPopup] = useState<PopupState>(null);
  const [hover, setHover] = useState<HoverState>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();

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
    ],
    content: initialContent || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Refresh highlight decorations when tasks or focus changes.
  useEffect(() => {
    if (!editor) return;
    setTaskHighlightState(highlightItems, focusedFeedbackId);
    editor.view.dispatch(editor.state.tr.setMeta(TASK_HIGHLIGHT_META, true));
  }, [editor, highlightItems, focusedFeedbackId]);

  // Scroll to and pulse the focused highlight.
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

  // Hover → task preview. Click → full chat panel.
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

  const openPopupForSelection = useCallback(() => {
    if (!editor || !onQueueTask) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const text = editor.state.doc.textBetween(from, to, " ").trim();
    if (!text) return;

    const coords = editor.view.coordsAtPos(to);
    const wrap = editorWrap.current?.getBoundingClientRect();
    const x = wrap ? coords.left - wrap.left : coords.left;
    const y = wrap ? coords.bottom - wrap.top + 8 : coords.bottom + 8;
    setPopup({ context: text, from, to, x, y });
  }, [editor, onQueueTask]);

  const handleMouseUp = () => {
    setTimeout(openPopupForSelection, 10);
  };

  const submitTask = (task: string) => {
    if (popup && onQueueTask) onQueueTask(popup.context, task, popup.from, popup.to);
    setPopup(null);
    editor?.commands.focus();
  };

  return (
    <div className="doc-shell" ref={editorWrap}>
      {editor && <Toolbar editor={editor} />}
      <div className="doc-editor" onMouseUp={handleMouseUp}>
        <EditorContent editor={editor} />
      </div>
      {popup && (
        <SelectionPopup
          context={popup.context}
          x={popup.x}
          y={popup.y}
          onSubmit={submitTask}
          onClose={() => setPopup(null)}
        />
      )}
      {hover && !chatOpen && <TaskHoverCard feedback={hover.feedback} x={hover.x} y={hover.y} />}
    </div>
  );
}

function Toolbar({ editor }: { editor: TiptapEditor }) {
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
    </div>
  );
}
