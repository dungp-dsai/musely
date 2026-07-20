import { Node, mergeAttributes } from "@tiptap/core";

export type ImageWithCaptionAttrs = {
  src: string;
  alt: string;
  caption: string;
  mediaId?: string | null;
};

/**
 * Block image with a caption (figcaption).
 * Stored as:
 * <figure class="musely-figure" data-media-id="...">
 *   <img src="..." alt="..." />
 *   <figcaption>...</figcaption>
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
      mediaId: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: "figure.musely-figure",
        getAttrs: (node) => {
          const el = node as HTMLElement;
          const figure = el as HTMLElement;
          const img = figure.querySelector("img") as HTMLImageElement | null;
          const figcap = figure.querySelector("figcaption") as HTMLElement | null;
          return {
            src: img?.getAttribute("src") ?? "",
            alt: img?.getAttribute("alt") ?? "",
            caption: figcap?.textContent ?? "",
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

    // Tiptap/ProseMirror atom nodes shouldn't have `0` content.
    return [
      "figure",
      attrs,
      ["img", { src: node.attrs.src, alt: node.attrs.alt, loading: "lazy" }],
      ["figcaption", node.attrs.caption || ""],
    ];
  },

  addCommands() {
    return {
      insertImageWithCaption:
        (attrs: ImageWithCaptionAttrs) =>
        ({ commands }: any) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),

      setImageCaption:
        (mediaId: string, caption: string) =>
        ({ state, dispatch }: any) => {
          let updated = false;
          const { tr, doc } = state;

          doc.descendants((node: any, pos: number) => {
            if (node.type.name !== this.name) return true;
            if ((node.attrs.mediaId ?? null) !== mediaId) return true;
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              caption,
              alt: caption,
            });
            updated = true;
            return false;
          });

          if (!updated) return false;
          dispatch?.(tr);
          return true;
        },
    } as any;
  },
});

