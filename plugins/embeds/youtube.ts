import { iframeSrc } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

export const videoFrame = (id: string) =>
  frame(`https://www.youtube-nocookie.com/embed/${id}`, "YouTube の動画", "16 / 9");
export const videoId = (value: string | null | undefined) =>
  typeof value === "string" && /^[\w-]{1,32}$/.test(value) ? value : undefined;
export const youtube: Embed = {
  fromUrl: ({ hostname, pathname, searchParams }) => {
    if (hostname === "youtu.be") {
      const id = videoId(pathname.slice(1));
      return id ? videoFrame(id) : undefined;
    }
    if (!/^(www\.|m\.)?youtube\.com$/.test(hostname)) return;
    if (/^\/embed\/video(?:series)$/.test(pathname)) return;
    const id = videoId(
      pathname === "/watch" ? searchParams.get("v") : /^\/(?:shorts|embed|live)\/([\w-]+)$/.exec(pathname)?.[1]
    );
    if (id) return videoFrame(id);
  },
  // `<iframe src="https://www.youtube.com/embed/<ID>?...">`（youtube-nocookie.com も）
  fromEmbedCode: (nodes, index) => {
    const src = iframeSrc(nodes[index]) ?? "";
    const id = /^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/([\w-]{1,32})(?:[?#]|$)/.exec(src)?.[1];
    if (id && !/^video(?:series)$/.test(id)) return { url: `https://www.youtube.com/watch?v=${id}`, length: 1 };
  },
};
