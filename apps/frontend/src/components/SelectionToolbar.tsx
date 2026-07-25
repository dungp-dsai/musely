import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  x: number;
  y: number;
  onAddTask: () => void;
  onDismiss: () => void;
}

const VIEW_PAD = 12;

/** Lightweight selection toolbar — does not steal focus from the editor. */
export default function SelectionToolbar({ x, y, onAddTask, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const place = () => {
      const { width, height } = el.getBoundingClientRect();
      const maxLeft = Math.max(VIEW_PAD, window.innerWidth - width - VIEW_PAD);
      const maxTop = Math.max(VIEW_PAD, window.innerHeight - height - VIEW_PAD);
      let left = Math.min(Math.max(VIEW_PAD, x), maxLeft);
      let top = y;
      if (top + height > window.innerHeight - VIEW_PAD) {
        top = Math.min(y, window.innerHeight - VIEW_PAD) - height - 8;
      }
      top = Math.min(Math.max(VIEW_PAD, top), maxTop);
      setPos({ left, top });
    };

    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    // pointerdown so editor still receives the event for caret moves
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [onDismiss]);

  return createPortal(
    <div
      className="sel-toolbar"
      ref={ref}
      style={{ left: pos.left, top: pos.top }}
      role="toolbar"
      aria-label="Selection actions"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" className="sel-toolbar-btn" onClick={onAddTask}>
        <span className="sel-toolbar-icon" aria-hidden>
          ✦
        </span>
        Add AI task
      </button>
      <span className="sel-toolbar-hint" aria-hidden>
        ⌘K
      </span>
    </div>,
    document.body
  );
}
