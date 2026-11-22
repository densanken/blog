import { iframeSrc } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

const pagePath =
  /^\/([a-z]{2})\/(album|playlist|song|music-video)\/([\w%.~-]{1,300})\/(\d{1,20}|pl\.[A-Za-z0-9-]{1,100})$/;

const validSlug = (slug: string) => {
  try {
    for (const char of decodeURIComponent(slug)) {
      const code = char.charCodeAt(0);
      if (code < 32 || code === 127 || char === "/" || char === "\\") return false;
    }
    return true;
  } catch {
    return false;
  }
};

// 曲の ID（アルバムの URL の `?i=<曲 ID>`）
const trackId = (search: URLSearchParams) => {
  const value = search.get("i");
  return value !== null && /^\d{1,20}$/.test(value) ? value : undefined;
};

export const appleMusic: Embed = {
  fromUrl: ({ hostname, pathname, searchParams }) => {
    const match = hostname === "music.apple.com" && pagePath.exec(pathname);
    if (!match || !validSlug(match[3] ?? "") || (match[2] === "playlist") !== match[4]?.startsWith("pl.")) return;
    const track = trackId(searchParams);
    // 高さは固定（1 曲はコンパクトなプレーヤー）
    const single = match[2] === "song" || track !== undefined;
    return frame(
      `https://embed.music.apple.com${pathname}${track ? `?i=${track}` : ""}`,
      "Apple Music",
      single ? 175 : 450,
      "embed-frame",
      // 再生に DRM（EME）が必要
      "encrypted-media; fullscreen"
    );
  },
  // `<iframe src="https://embed.music.apple.com/<国>/album/<スラッグ>/<ID>" allow="..." sandbox="..." height="450">`
  // 作者の allow、sandbox、高さは使わない
  fromEmbedCode: (nodes, index) => {
    const url = URL.parse(iframeSrc(nodes[index]) ?? "");
    if (
      url?.protocol !== "https:" ||
      url.hostname !== "embed.music.apple.com" ||
      url.port ||
      url.username ||
      url.password
    )
      return;
    const match = pagePath.exec(url.pathname);
    if (!match || !validSlug(match[3] ?? "") || (match[2] === "playlist") !== match[4]?.startsWith("pl.")) return;
    const track = trackId(url.searchParams);
    return { url: `https://music.apple.com${url.pathname}${track ? `?i=${track}` : ""}`, length: 1 };
  },
};
