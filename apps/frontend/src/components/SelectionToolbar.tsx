import { useEffect, useRef } from "react";

interface Props {
  x: number;
  y: number;
  onAddTask: () => void;
  onDismiss: () => void;
}

/** Lightweight selection toolbar — does not steal focus from the editor. */
export default function SelectionToolbar({ x, y, onAddTask, onDismiss }: Props) {
  const ref = useRef<HTMLDivElement>(null);

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

  const left = Math.min(Math.max(12, x), window.innerWidth - 200);
  const top = Math.min(Math.max(12, y), window.innerHeight - 52);

  return (
    <div
      className="sel-toolbar"
      ref={ref}
      style={{ left, top }}
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
    </div>
  );
}
