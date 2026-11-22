import { attribute, iframeSrc, isElement, onlyChild, skipBlank } from "./code.ts";
import { frame } from "./frame.ts";
import { parseRatio, ratioOf, withRatio } from "./ratio.ts";

import type { Embed } from "./types.ts";
import type { RootContent } from "hast";

const embedSrc = /^https:\/\/www\.canva\.com\/design\/([\w-]+)(?:\/([\w-]+))?\/view\?embed(?:[&#]|$)/;

export const canva: Embed = {
  // トークンのない公開リンク（`/design/<ID>/view`）と、トークンのあるリンク（`/design/<ID>/<トークン>/view`）
  fromUrl: (url) => {
    const { hostname, pathname } = url;
    const canva =
      hostname === "www.canva.com" &&
      /^\/design\/([\w-]+)(?:\/(view|watch)|\/([\w-]+)\/(?:view|watch|edit))$/.exec(pathname);
    if (canva)
      return frame(
        `https://www.canva.com/design/${canva[1] ?? ""}${canva[3] ? `/${canva[3]}` : ""}/view?embed`,
        "Canva のデザイン",
        ratioOf(url, "16 / 9")
      );
  },
  // div で包んだ `<iframe src="https://www.canva.com/design/<ID>/<トークン>/view?embed">` と、その後のリンク（`<a href="...">タイトル</a> by 作者`）
  fromEmbedCode: (nodes, index) => {
    const node = nodes[index];
    const inner: RootContent | undefined = isElement(node, "div") ? onlyChild(node) : node;
    const match = embedSrc.exec(iframeSrc(inner) ?? "");
    if (!match) return;
    const [, id, token] = match;
    const url = `https://www.canva.com/design/${id ?? ""}${token ? `/${token}` : ""}/view`;
    // 作者リンクまで公式の構造と一致するときだけ説明を消費する
    let length = 1;
    const next = skipBlank(nodes, index + 1);
    const link = nodes[next];
    const href = isElement(link, "a") ? URL.parse(attribute(link, "href") ?? "") : null;
    const by = nodes[next + 1];
    const author = nodes[next + 2];
    const authorUrl = isElement(author, "a") ? URL.parse(attribute(author, "href") ?? "") : null;
    if (
      href?.origin === "https://www.canva.com" &&
      href.pathname === new URL(url).pathname &&
      isElement(link, "a") &&
      link.children.every((child) => child.type === "text") &&
      by?.type === "text" &&
      /^\s+by\s+$/.test(by.value) &&
      authorUrl?.origin === "https://www.canva.com" &&
      /^\/p\/[\w-]+\/?$/.test(authorUrl.pathname) &&
      isElement(author, "a") &&
      author.children.every((child) => child.type === "text")
    )
      length = next + 3 - index;
    const { width, height } = isElement(inner, "iframe") ? inner.properties : {};
    const dimensions = typeof width === "number" && typeof height === "number" ? width / height : undefined;
    const padding = isElement(node, "div")
      ? /(?:^|;)\s*padding-top\s*:\s*(\d{1,3}(?:\.\d+)?)%(?:\s*;|\s*$)/i.exec(attribute(node, "style") ?? "")?.[1]
      : undefined;
    const ratio =
      parseRatio(dimensions?.toFixed(4)) ?? (padding ? parseRatio(String(Number(padding) / 100), true) : undefined);
    return { url: withRatio(url, ratio), length };
  },
};
