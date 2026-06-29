import type { Feedback } from "../types";
import { TASK_COLORS } from "../extensions/taskHighlight";

interface Props {
  feedback: Feedback;
  x: number;
  y: number;
}

/** Lightweight preview on hover — task only. Click highlight for full panel. */
export default function TaskHoverCard({ feedback, x, y }: Props) {
  const color = TASK_COLORS[feedback.id % TASK_COLORS.length];
  const left = Math.min(x, window.innerWidth - 280);
  const top = Math.min(y + 12, window.innerHeight - 100);

  return (
    <div
      className="task-hover-card task-hover-card--preview"
      style={{ left, top, borderColor: color.border }}
      role="tooltip"
    >
      <div className="task-hover-stripe" style={{ background: color.border }} />
      <div className="task-hover-body">
        <div className="task-hover-task">{feedback.content}</div>
        <div className="task-hover-hint">Click for findings & chat</div>
      </div>
    </div>
  );
}
