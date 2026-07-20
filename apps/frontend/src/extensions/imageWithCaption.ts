import { Node, mergeAttributes } from "@tiptap/core";

export type ImageWithCaptionAttrs = {
  src: string;
  alt: string;
  caption: string;
  showCaption?: boolean;
  mediaId?: string | null;
};

type MenuState = {
  el: HTMLDivElement;
  onDoc: (e: Event) => void;
  onKey: (e: KeyboardEvent) => void;
};

/**
 * Block image with an optional user-editable caption.
 * Right-click the image → Add caption / Remove caption.
 *
 * Stored as:
 * <figure class="musely-figure" data-media-id="...">
 *   <img src="..." alt="..." />
 *   <figcaption>...</figcaption>   <!-- only when caption is non-empty -->
 * </figure>
 */
export const ImageWithCaption = Node.create({
  name: "imageWithCaption",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      caption: { default: "" },
      showCaption: { default: false },
      mediaId: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure.musely-figure",
        getAttrs: (node) => {
          const figure = node as HTMLElement;
          const img = figure.querySelector("img") as HTMLImageElement | null;
          const figcap = figure.querySelector("figcaption") as HTMLElement | null;
          const caption = (figcap?.textContent ?? "").trim();
          return {
            src: img?.getAttribute("src") ?? "",
            alt: img?.getAttribute("alt") ?? "",
            caption,
            showCaption: Boolean(caption),
            mediaId: figure.getAttribute("data-media-id"),
          };
        },
      },
      {
        tag: "img",
        getAttrs: (node) => {
          const el = node as HTMLImageElement;
          return {
            src: el.getAttribute("src") ?? "",
            alt: el.getAttribute("alt") ?? "",
            caption: "",
            showCaption: false,
            mediaId: el.getAttribute("data-media-id"),
          };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = mergeAttributes(HTMLAttributes, {
      class: "musely-figure",
      "data-media-id": node.attrs.mediaId ?? undefined,
    });
    const caption = String(node.attrs.caption || "").trim();
    const children: any[] = [
      ["img", { src: node.attrs.src, alt: node.attrs.alt || caption, loading: "lazy" }],
    ];
    if (caption) {
      children.push(["figcaption", caption]);
    }
    return ["figure", attrs, ...children];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const figure = document.createElement("figure");
      figure.className = "musely-figure";
      if (node.attrs.mediaId) {
        figure.setAttribute("data-media-id", String(node.attrs.mediaId));
      }

      const img = document.createElement("img");
      img.src = node.attrs.src || "";
      img.alt = node.attrs.alt || node.attrs.caption || "";
      img.loading = "lazy";
      img.draggable = false;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "musely-figure-caption";
      input.value = node.attrs.caption || "";
      input.setAttribute("aria-label", "Image caption");
      input.hidden = !(node.attrs.showCaption || String(node.attrs.caption || "").trim());

      figure.appendChild(img);
      figure.appendChild(input);

      let menu: MenuState | null = null;

      const closeMenu = () => {
        if (!menu) return;
        document.removeEventListener("mousedown", menu.onDoc, true);
        document.removeEventListener("keydown", menu.onKey, true);
        menu.el.remove();
        menu = null;
      };

      const patchAttrs = (patch: Record<string, unknown>, focusCaption = false) => {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (typeof pos !== "number") return;
        const current = editor.state.doc.nodeAt(pos);
        if (!current || current.type.name !== "imageWithCaption") return;
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch });
            return true;
          })
          .run();
        if (focusCaption) {
          requestAnimationFrame(() => {
            input.hidden = false;
            input.focus();
            input.select();
          });
        }
      };

      const openMenu = (x: number, y: number) => {
        closeMenu();
        const el = document.createElement("div");
        el.className = "musely-figure-menu";
        el.setAttribute("role", "menu");

        const hasCaption = !input.hidden;
        const item = document.createElement("button");
        item.type = "button";
        item.className = "musely-figure-menu-item";
        item.setAttribute("role", "menuitem");
        item.textContent = hasCaption ? "Remove caption" : "Add caption";
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeMenu();
          if (hasCaption) {
            input.value = "";
            input.hidden = true;
            patchAttrs({ caption: "", showCaption: false, alt: "" });
          } else {
            input.hidden = false;
            patchAttrs({ showCaption: true }, true);
          }
        });
        el.appendChild(item);
        document.body.appendChild(el);

        const rect = el.getBoundingClientRect();
        const left = Math.min(x, window.innerWidth - rect.width - 8);
        const top = Math.min(y, window.innerHeight - rect.height - 8);
        el.style.left = `${Math.max(8, left)}px`;
        el.style.top = `${Math.max(8, top)}px`;

        const onDoc = (e: Event) => {
          if (e.target instanceof Node && el.contains(e.target)) return;
          closeMenu();
        };
        const onKey = (e: KeyboardEvent) => {
          if (e.key === "Escape") closeMenu();
        };
        document.addEventListener("mousedown", onDoc, true);
        document.addEventListener("keydown", onKey, true);
        menu = { el, onDoc, onKey };
      };

      const commit = () => {
        const caption = input.value.trim();
        if (!caption) {
          input.value = "";
          input.hidden = true;
          patchAttrs({ caption: "", showCaption: false, alt: "" });
          return;
        }
        patchAttrs({ caption, showCaption: true, alt: caption });
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          input.blur();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          const pos = typeof getPos === "function" ? getPos() : null;
          const current = typeof pos === "number" ? editor.state.doc.nodeAt(pos) : null;
          input.value = String(current?.attrs.caption || "");
          input.blur();
        }
      });
      input.addEventListener("change", commit);
      input.addEventListener("blur", commit);

      figure.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY);
      });

      return {
        dom: figure,
        // Keep ProseMirror from treating caption keystrokes as editing/replacing the atom.
        stopEvent: (event) => {
          const t = event.target as Node | null;
          if (!t) return false;
          if (t === input || input.contains(t)) return true;
          if (menu?.el.contains(t)) return true;
          return false;
        },
        ignoreMutation: () => true,
        selectNode: () => {
          figure.classList.add("is-selected");
        },
        deselectNode: () => {
          figure.classList.remove("is-selected");
        },
        update: (updated) => {
          if (updated.type.name !== "imageWithCaption") return false;
          if (img.src !== (updated.attrs.src || "")) {
            img.src = updated.attrs.src || "";
          }
          const nextCaption = updated.attrs.caption || "";
          const visible = Boolean(updated.attrs.showCaption || String(nextCaption).trim());
          input.hidden = !visible;
          if (document.activeElement !== input && input.value !== nextCaption) {
            input.value = nextCaption;
          }
          img.alt = updated.attrs.alt || nextCaption || "";
          if (updated.attrs.mediaId) {
            figure.setAttribute("data-media-id", String(updated.attrs.mediaId));
          } else {
            figure.removeAttribute("data-media-id");
          }
          return true;
        },
        destroy: () => {
          closeMenu();
          input.removeEventListener("change", commit);
          input.removeEventListener("blur", commit);
        },
      };
    };
  },

  addCommands() {
    return {
      insertImageWithCaption:
        (attrs: ImageWithCaptionAttrs) =>
        ({ commands }: any) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              showCaption: false,
              ...attrs,
            },
          }),
    } as any;
  },
});
