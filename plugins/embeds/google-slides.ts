import { iframeSrc } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

export const invalidPublishedSlides = (url: URL) =>
  url.protocol === "https:" &&
  url.hostname === "docs.google.com" &&
  url.pathname.startsWith("/presentation/d/e/") &&
  !/^\/presentation\/d\/e\/2PACX-[\w-]+\/(?:pub|pubembed|pubhtml|embed)\/?$/.test(url.pathname);

const embedUrl = (url: URL) => {
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com") return;
  const published = /^\/presentation\/d\/e\/(2PACX-[\w-]+)\/(?:pub|pubembed|pubhtml|embed)\/?$/.exec(url.pathname);
  const shared = /^\/presentation\/d\/(?!e\/)([\w-]+)(?:\/(edit|view|present|preview|embed|pub|pubembed))?\/?$/.exec(
    url.pathname
  );
  if (!published && !shared) return;
  const base = published
    ? `e/${published[1]!}/pubembed`
    : `${shared![1]!}/${shared![2]?.startsWith("pub") ? "pubembed" : "embed"}`;
  const hash = /^#slide=id\.[\w-]+$/.test(url.hash) ? url.hash : "";
  return `https://docs.google.com/presentation/d/${base}${hash}`;
};

export const googleSlides: Embed = {
  fromUrl: (url) => {
    if (invalidPublishedSlides(url)) {
      throw new Error("Google スライドの公開 ID が不正です");
    }
    const src = embedUrl(url);
    if (src) return frame(src, "Google スライド", "960 / 569");
  },
  fromEmbedCode: (nodes, index) => {
    const src = iframeSrc(nodes[index]);
    if (!src) return;
    try {
      const url = embedUrl(new URL(src));
      if (url) return { url, length: 1 };
    } catch {
      return;
    }
  },
};
