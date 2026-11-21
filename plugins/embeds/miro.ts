import { iframeSrc } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

const embedUrl = (url: URL) => {
  if (url.protocol !== "https:" || url.host !== "miro.com") return;
  const match = /^\/app\/(?:board|live-embed)\/([a-zA-Z0-9_-]+=)\/?$/.exec(url.pathname);
  if (!match) return;
  const params = new URLSearchParams(url.search);
  params.set("embedMode", "view_only_without_ui");
  return `https://miro.com/app/live-embed/${match[1]!}/?${params.toString()}`;
};

export const miro: Embed = {
  fromUrl: (url) => {
    const src = embedUrl(url);
    if (src) return frame(src, "Miro のボード", "16 / 9");
  },
  fromEmbedCode: (nodes, index) => {
    const src = iframeSrc(nodes[index]);
    const url = src ? URL.parse(src) : null;
    if (!url?.pathname.startsWith("/app/live-embed/")) return;
    const result = embedUrl(url);
    if (result) return { url: result, length: 1 };
  },
};
