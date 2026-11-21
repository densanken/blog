import { attribute, hasClass, hrefs, iframeSrc, isElement, withScript } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

const scriptSrc = /^https:\/\/(?:cpwebassets\.codepen\.io|static\.codepen\.io)\//;
const idPattern = "(?:\\w+|[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12})";
const editorPen = new RegExp(`^/editor/(?:team/)?[\\w-]+/pen/(${idPattern})$`);
const editorEmbed = new RegExp(
  `^(?:https:)?//codepen\\.io/editor/(?:team/)?[\\w-]+/embed/(?:preview/)?(${idPattern})(?:[?#]|$)`
);

export const codepen: Embed = {
  // チームの Pen は `/team/<チーム名>/pen/<ID>`
  fromUrl: ({ hostname, pathname }) => {
    if (hostname !== "codepen.io") return;
    const editor = editorPen.exec(pathname);
    if (editor)
      return frame(
        `https://codepen.io/editor/anon/embed/${editor[1] ?? ""}?default-tab=result`,
        "CodePen",
        "16 / 9",
        "embed-frame embed-codepen"
      );
    const pen = new RegExp(`^/((?:team/)?[\\w-]+)/(?:pen|full|details)/(${idPattern})$`).exec(pathname);
    if (pen) {
      const path = pen[2]?.includes("-") ? `editor/anon/embed/${pen[2]}` : `${pen[1] ?? ""}/embed/${pen[2] ?? ""}`;
      return frame(`https://codepen.io/${path}?default-tab=result`, "CodePen", "16 / 9", "embed-frame embed-codepen");
    }
  },
  // `<p class="codepen" data-slug-hash="<ID>" data-user="<ユーザー>">` と、embed の script
  // `<iframe src="https://codepen.io/<ユーザー>/embed/<ID>?...">` も受け付ける
  fromEmbedCode: (nodes, index) => {
    const node = nodes[index];
    const editor = editorEmbed.exec(iframeSrc(node) ?? "");
    if (editor) return { url: `https://codepen.io/editor/anon/pen/${editor[1] ?? ""}`, length: 1 };
    const iframe = new RegExp(
      `^https://codepen\\.io/((?:team/)?[\\w-]+)/embed/(?:preview/)?(${idPattern})(?:[?#]|$)`
    ).exec(iframeSrc(node) ?? "");
    if (iframe) return { url: `https://codepen.io/${iframe[1] ?? ""}/pen/${iframe[2] ?? ""}`, length: 1 };
    if (!isElement(node, "p") || !hasClass(node, "codepen")) return;
    const slug = attribute(node, "dataSlugHash") ?? "";
    const user = attribute(node, "dataUser") ?? "";
    if (!new RegExp(`^${idPattern}$`).test(slug) || !/^[\w-]+$/.test(user)) return;
    // チームの Pen は、中のリンク（`https://codepen.io/team/<チーム名>/pen/<ID>`）から求める
    const team = hrefs(node)
      .map((href) => new RegExp(`^https://codepen\\.io/(team/[\\w-]+)/pen/${slug}(?:[?#]|$)`).exec(href)?.[1])
      .find((value) => value !== undefined);
    return { url: `https://codepen.io/${team ?? user}/pen/${slug}`, length: withScript(nodes, index, 1, scriptSrc) };
  },
};
