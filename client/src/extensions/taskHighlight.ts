import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface TaskHighlightItem {
  id: number;
  context: string;
  task: string;
  status: string;
  contextFrom: number | null;
  contextTo: number | null;
  colorIndex: number;
}

export const TASK_HIGHLIGHT_META = "taskHighlightUpdate";

export const taskHighlightPluginKey = new PluginKey("taskHighlight");

/** Shared state read by the ProseMirror plugin (updated from React). */
export let taskHighlightState: {
  items: TaskHighlightItem[];
  focusedId: number | null;
} = { items: [], focusedId: null };

export function setTaskHighlightState(items: TaskHighlightItem[], focusedId: number | null) {
  taskHighlightState = { items, focusedId };
}

function norm(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function findRangeInDoc(
  doc: PMNode,
  context: string,
  storedFrom: number | null,
  storedTo: number | null
): { from: number; to: number } | null {
  const needle = norm(context);
  if (!needle) return null;

  if (
    storedFrom != null &&
    storedTo != null &&
    storedFrom >= 0 &&
    storedTo <= doc.content.size &&
    storedFrom < storedTo
  ) {
    const slice = norm(doc.textBetween(storedFrom, storedTo, " "));
    if (slice === needle || slice.includes(needle) || needle.includes(slice)) {
      return { from: storedFrom, to: storedTo };
    }
  }

  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const text = node.text;
    let start = 0;
    while (start <= text.length) {
      const i = text.indexOf(context, start);
      if (i === -1) {
        const ni = text.indexOf(needle, start);
        if (ni === -1) break;
        found = { from: pos + ni, to: pos + ni + needle.length };
        return;
      }
      found = { from: pos + i, to: pos + i + context.length };
      return;
    }
  });
  return found;
}

function buildDecorations(doc: PMNode, items: TaskHighlightItem[], focusedId: number | null) {
  const decos: Decoration[] = [];
  for (const item of items) {
    if (!item.context.trim()) continue;
    const range = findRangeInDoc(doc, item.context, item.contextFrom, item.contextTo);
    if (!range) continue;
    const active = focusedId === item.id;
    decos.push(
      Decoration.inline(range.from, range.to, {
        class: `task-hl task-hl-c${item.colorIndex % 6}${active ? " task-hl-active" : ""}`,
        "data-feedback-id": String(item.id),
        "data-task-status": item.status,
      })
    );
  }
  return DecorationSet.create(doc, decos);
}

export const TaskHighlight = Extension.create({
  name: "taskHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: taskHighlightPluginKey,
        state: {
          init(_, { doc }) {
            const { items, focusedId } = taskHighlightState;
            return buildDecorations(doc, items, focusedId);
          },
          apply(tr, set, _oldState, newState) {
            if (tr.docChanged || tr.getMeta(TASK_HIGHLIGHT_META)) {
              const { items, focusedId } = taskHighlightState;
              return buildDecorations(newState.doc, items, focusedId);
            }
            return set.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return taskHighlightPluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

export const TASK_COLORS = [
  { bg: "#ffe8a3", border: "#d4a017", label: "amber" },
  { bg: "#cce5ff", border: "#2f6db8", label: "blue" },
  { bg: "#d4f5dc", border: "#2f8a4e", label: "green" },
  { bg: "#f5d4ff", border: "#8b44b8", label: "purple" },
  { bg: "#ffd4d4", border: "#c0392b", label: "red" },
  { bg: "#d4f0f5", border: "#1a8a9a", label: "teal" },
];
