import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  context: string;
  x: number;
  y: number;
  onSubmit: (task: string) => void;
  onClose: () => void;
}

const VIEW_PAD = 12;
const POPUP_WIDTH = 300;

/** Full task composer — only opened after an intentional action (chip / ⌘K). */
export default function SelectionPopup({ context, x, y, onSubmit, onClose }: Props) {
  const [task, setTask] = useState("");
  const [pos, setPos] = useState({ left: x, top: y });
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the whole popup (including Queue button) inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const place = () => {
      const { width, height } = el.getBoundingClientRect();
      const maxLeft = Math.max(VIEW_PAD, window.innerWidth - width - VIEW_PAD);
      const maxTop = Math.max(VIEW_PAD, window.innerHeight - height - VIEW_PAD);

      let left = Math.min(Math.max(VIEW_PAD, x), maxLeft);
      // Prefer below the selection; flip above when there isn't room.
      let top = y;
      if (top + height > window.innerHeight - VIEW_PAD) {
        top = Math.min(y, window.innerHeight - VIEW_PAD) - height - 20;
      }
      top = Math.min(Math.max(VIEW_PAD, top), maxTop);
      setPos({ left, top });
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [x, y, context]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const submit = () => {
    if (!task.trim()) return;
    onSubmit(task.trim());
  };

  return createPortal(
    <div
      className="sel-popup"
      ref={ref}
      style={{ left: pos.left, top: pos.top, width: POPUP_WIDTH }}
    >
      <div className="sel-field">
        <span className="sel-label">Selected text</span>
        <div className="sel-context">“{context}”</div>
      </div>
      <div className="sel-field">
        <span className="sel-label">Task for Musely</span>
        <textarea
          ref={inputRef}
          className="input textarea sel-task"
          rows={2}
          placeholder="What should Musely do with this?"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
      </div>
      <button className="btn btn-primary full" onClick={submit} disabled={!task.trim()}>
        Queue for AI
      </button>
    </div>,
    document.body
  );
}
