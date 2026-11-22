import { figmaEmbedHost } from "../site.ts";
import { iframeSrc } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

const embedUrl = (url: URL) => {
  if (url.protocol !== "https:" || !["www.figma.com", "figma.com", "embed.figma.com"].includes(url.host)) return;
  const match = /^\/(design|file|proto|board|slides|deck)\/([a-zA-Z0-9]+)(?:\/[^/]*)?\/?$/.exec(url.pathname);
  if (!match) return;
  const kind = match[1] === "file" ? "design" : match[1]!;
  const params = new URLSearchParams(url.search);
  params.delete("embed_host");
  params.set("embed-host", figmaEmbedHost);
  return { src: `https://embed.figma.com/${kind}/${match[2]!}?${params.toString()}`, kind };
};

export const figma: Embed = {
  fromUrl: (url) => {
    const result = embedUrl(url);
    if (result)
      return frame(
        result.src,
        result.kind === "board" ? "FigJam のボード" : "Figma のファイル",
        result.kind === "board" ? "4 / 3" : "16 / 9",
        "embed-frame",
        "fullscreen",
        "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms allow-modals allow-storage-access-by-user-activation"
      );
  },
  fromEmbedCode: (nodes, index) => {
    const src = iframeSrc(nodes[index]);
    let url = src ? URL.parse(src) : null;
    if (!url) return;
    if (url.origin === "https://www.figma.com" && url.pathname === "/embed") {
      const original = URL.parse(url.searchParams.get("url") ?? "");
      if (original?.protocol !== "https:" || !["www.figma.com", "figma.com"].includes(original.host)) return;
      for (const [key, value] of url.searchParams) {
        if (["url", "embed_host", "embed_origin"].includes(key)) continue;
        original.searchParams.set(key === "node_id" ? "node-id" : key, value);
      }
      url = original;
    } else if (!["https://embed.figma.com", "https://www.figma.com"].includes(url.origin)) return;
    const result = embedUrl(url);
    if (result) return { url: result.src, length: 1 };
  },
};
