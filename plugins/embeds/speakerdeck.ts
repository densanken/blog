import { attribute, hasClass, isElement } from "./code.ts";
import { frame, oembed } from "./frame.ts";
import { parseRatio, ratioOf, withRatio } from "./ratio.ts";

import type { Embed } from "./types.ts";

const playerId = /^[0-9a-f]{16,64}$/;

export const speakerdeck: Embed = {
  fromUrl: async (url, reserveFetch) => {
    const { hostname, pathname } = url;
    if (hostname !== "speakerdeck.com") return;
    // 埋め込みコードの iframe の URL（`/player/<ID>`）は、ページの URL がなく oEmbed を使えないため、直接 iframe にする
    const id = /^\/player\/([0-9a-f]+)$/.exec(pathname)?.[1];
    if (id !== undefined) {
      if (!playerId.test(id)) return;
      return frame(`https://speakerdeck.com/player/${id}`, "Speaker Deck のスライド", ratioOf(url, "16 / 9"));
    }
    if (/^\/[\w-]+\/[\w-]+$/.test(pathname)) {
      reserveFetch();
      return oembed("https://speakerdeck.com/oembed.json?url=", url, /^https:\/\/speakerdeck\.com\/player\/\w+$/).catch(
        () => undefined
      );
    }
  },
  // `<iframe class="speakerdeck-iframe" src="https://speakerdeck.com/player/<ID>" data-ratio="1.777">`
  fromEmbedCode: (nodes, index) => {
    const node = nodes[index];
    if (isElement(node, "script") && hasClass(node, "speakerdeck-embed")) {
      const src = attribute(node, "src");
      const id = attribute(node, "dataId");
      if (
        (src === "//speakerdeck.com/assets/embed.js" || src === "https://speakerdeck.com/assets/embed.js") &&
        id &&
        playerId.test(id)
      ) {
        return {
          url: withRatio(`https://speakerdeck.com/player/${id}`, parseRatio(attribute(node, "dataRatio"))),
          length: 1,
        };
      }
      return;
    }
    if (!isElement(node, "iframe") || !hasClass(node, "speakerdeck-iframe")) return;
    const id = /^https:\/\/speakerdeck\.com\/player\/([0-9a-f]{16,64})(?:[?#]|$)/.exec(
      attribute(node, "src") ?? ""
    )?.[1];
    if (id) {
      const { width, height } = node.properties;
      const dimensions = typeof width === "number" && typeof height === "number" ? width / height : undefined;
      return {
        url: withRatio(
          `https://speakerdeck.com/player/${id}`,
          parseRatio(attribute(node, "dataRatio")) ?? parseRatio(dimensions?.toFixed(4))
        ),
        length: 1,
      };
    }
  },
};
