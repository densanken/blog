import { iframeSrc } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

const embedUrl = (url: URL) => {
  if (url.protocol !== "https:" || url.host !== "www.google.com" || url.searchParams.has("key")) return;
  if (url.searchParams.has("query_place_id")) return;
  if (url.pathname === "/maps/embed") {
    if (!url.searchParams.get("pb")) return;
    return url.href;
  }
  if (!/^\/maps(?:\/|$)/.test(url.pathname)) return;
  const coordinates = /\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),\d+(?:\.\d+)?z(?:\/|$)/.exec(url.pathname);
  const pathQuery = /^\/maps\/(?:place|search)\/([^/]+)/.exec(url.pathname)?.[1];
  let query: string | undefined = url.searchParams.get("q") ?? url.searchParams.get("query") ?? undefined;
  if (!query && pathQuery) {
    try {
      query = decodeURIComponent(pathQuery.replaceAll("+", " "));
    } catch {
      return;
    }
  }
  query ??= coordinates ? `${coordinates[1]!},${coordinates[2]!}` : undefined;
  if (!query?.trim()) return;
  const params = new URLSearchParams({ q: query, output: "embed" });
  return `https://www.google.com/maps?${params.toString()}`;
};

export const googleMaps: Embed = {
  fromUrl: (url) => {
    const src = embedUrl(url);
    if (src) return frame(src, "Google マップ", "16 / 9");
  },
  fromEmbedCode: (nodes, index) => {
    const src = iframeSrc(nodes[index]);
    const url = src ? URL.parse(src) : null;
    if (url?.pathname !== "/maps/embed") return;
    const result = embedUrl(url);
    if (result) return { url: result, length: 1 };
  },
};
