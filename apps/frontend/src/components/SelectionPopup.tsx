import { useEffect, useRef, useState } from "react";

interface Props {
  context: string;
  x: number;
  y: number;
  onSubmit: (task: string) => void;
  onClose: () => void;
}

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

  // Keep popup on screen.
  const left = Math.min(x, window.innerWidth - 320);
  const top = Math.min(y, window.innerHeight - 220);

  return (
    <div className="sel-popup" ref={ref} style={{ left, top }}>
      <div className="sel-field">
        <span className="sel-label">Context</span>
        <div className="sel-context">"{context}"</div>
      </div>
      <div className="sel-field">
        <span className="sel-label">Task</span>
        <textarea
          ref={inputRef}
          className="input textarea sel-task"
          rows={2}
          placeholder="What should Hermes do with this?"
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
