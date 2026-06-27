import { useMemo } from "react";
import { diffWords } from "diff";

interface Props {
  oldText: string;
  newText: string;
}

// Google-Docs-style inline diff: additions highlighted, removals struck through.
export default function DiffView({ oldText, newText }: Props) {
  const parts = useMemo(() => diffWords(oldText ?? "", newText ?? ""), [oldText, newText]);

  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.value.match(/\S+/g)?.length ?? 0), 0);
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + (p.value.match(/\S+/g)?.length ?? 0), 0);

  return (
    <div className="diff-wrap">
      <div className="diff-legend">
        <span className="legend ins">+{added} added</span>
        <span className="legend del">−{removed} removed</span>
      </div>
      <div className="diff-body">
        {parts.length === 0 && <span className="muted">Empty.</span>}
        {parts.map((p, i) =>
          p.added ? (
            <ins key={i} className="d-ins">
              {p.value}
            </ins>
          ) : p.removed ? (
            <del key={i} className="d-del">
              {p.value}
            </del>
          ) : (
            <span key={i}>{p.value}</span>
          )
        )}
      </div>
    </div>
  );
}
