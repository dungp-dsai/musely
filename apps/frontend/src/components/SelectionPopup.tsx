import { useEffect, useRef, useState } from "react";

interface Props {
  context: string;
  x: number;
  y: number;
  onSubmit: (task: string) => void;
  onClose: () => void;
}

/** Full task composer — only opened after an intentional action (chip / ⌘K). */
export default function SelectionPopup({ context, x, y, onSubmit, onClose }: Props) {
  const [task, setTask] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  const left = Math.min(Math.max(12, x), window.innerWidth - 320);
  const top = Math.min(Math.max(12, y), window.innerHeight - 240);

  return (
    <div className="sel-popup" ref={ref} style={{ left, top }}>
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
    </div>
  );
}
