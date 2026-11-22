import { attribute, hasClass, isElement, skipBlank } from "./code.ts";
import { frame, oembed } from "./frame.ts";
import { parseRatio, ratioOf, withRatio } from "./ratio.ts";

import type { Embed } from "./types.ts";

export const docswell: Embed = {
  fromUrl: async (url, reserveFetch) => {
    const { hostname, pathname } = url;
    if (hostname !== "www.docswell.com") return;
    // 埋め込みコードの URL（`/slide/<ID>/embed`）は、ページの URL がなく oEmbed を使えないため、直接 iframe にする
    const id = /^\/slide\/(\w+)\/embed$/.exec(pathname)?.[1];
    if (id !== undefined)
      return frame(`https://www.docswell.com/slide/${id}/embed`, "Docswell のスライド", ratioOf(url, "16 / 9"));
    if (pathname.startsWith("/s/")) {
      reserveFetch();
      return oembed(
        "https://www.docswell.com/service/oembed?url=",
        url,
        /^https:\/\/www\.docswell\.com\/slide\/\w+\/embed$/
      ).catch(() => undefined);
    }
  },
  // `<script async class="docswell-embed" src="https://www.docswell.com/..." data-src="https://www.docswell.com/slide/<ID>/embed" data-aspect="0.5625">` と、その後のリンクの div
  fromEmbedCode: (nodes, index) => {
    const script = nodes[index];
    if (isElement(script, "iframe")) {
      const id = /^https:\/\/www\.docswell\.com\/slide\/(\w+)\/embed$/.exec(attribute(script, "src") ?? "")?.[1];
      if (id) return { url: `https://www.docswell.com/slide/${id}/embed`, length: 1 };
      return;
    }
    if (!isElement(script, "script") || !hasClass(script, "docswell-embed")) return;
    if (attribute(script, "src") !== "https://www.docswell.com/assets/libs/docswell-embed/docswell-embed.min.js")
      return;
    const id = /^https:\/\/www\.docswell\.com\/slide\/(\w+)\/embed$/.exec(attribute(script, "dataSrc") ?? "")?.[1];
    if (!id) return;
    // data-aspect は、高さ / 幅
    const url = withRatio(
      `https://www.docswell.com/slide/${id}/embed`,
      parseRatio(attribute(script, "dataAspect"), true)
    );
    // 公式の説明は、タイトルと作者を含む同じスライドへのリンク
    const next = skipBlank(nodes, index + 1);
    const links = nodes[next];
    const children = isElement(links, "div") && hasClass(links, "docswell-link") ? links.children : [];
    const [slide] = children;
    const slideUrl = isElement(slide, "a") ? URL.parse(attribute(slide, "href") ?? "") : null;
    const linked =
      children.length === 1 &&
      slideUrl?.origin === "https://www.docswell.com" &&
      new RegExp(`^/s/[\\w-]+/${id}(?:-[^/]+)?$`).test(slideUrl.pathname) &&
      isElement(slide, "a") &&
      slide.children.every((child) => child.type === "text");
    return { url, length: linked ? next + 1 - index : 1 };
  },
};
