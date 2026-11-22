import { siteUrl } from "../site.ts";
import { iframeSrc } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

const parents = [new URL(siteUrl).hostname, "localhost", "127.0.0.1"];

export const twitch: Embed = {
  fromUrl: ({ hostname, pathname }) => {
    const slug =
      hostname === "clips.twitch.tv"
        ? /^\/([\w-]+)\/?$/.exec(pathname)?.[1]
        : hostname === "www.twitch.tv"
          ? /^\/[\w-]+\/clip\/([\w-]+)\/?$/.exec(pathname)?.[1]
          : undefined;
    if (slug)
      return frame(
        `https://clips.twitch.tv/embed?clip=${slug}${parents.map((parent) => `&parent=${parent}`).join("")}`,
        "Twitch Clip",
        "16 / 9"
      );
  },
  fromEmbedCode: (nodes, index) => {
    const src = iframeSrc(nodes[index]);
    if (!src) return;
    let url: URL;
    try {
      url = new URL(src);
    } catch {
      return;
    }
    const slug = url.searchParams.get("clip");
    if (
      url.protocol === "https:" &&
      url.host === "clips.twitch.tv" &&
      url.pathname === "/embed" &&
      slug &&
      /^[\w-]+$/.test(slug)
    )
      return { url: `https://clips.twitch.tv/${slug}`, length: 1 };
  },
};
