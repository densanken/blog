import { h } from "hastscript";

import { attribute, hasClass, isElement, withScript } from "./code.ts";

import type { Embed } from "./types.ts";

export const widgetsSource = /^https:\/\/platform\.(?:twitter|x)\.com\/widgets\.js$/;

export const twitter: Embed = {
  fromUrl: ({ hostname, origin, pathname }) => {
    const [post] = /^\/\w+\/status\/\d+(?=\/|$)/.exec(pathname) ?? [];
    if (/^(www\.)?(twitter|x)\.com$/.test(hostname) && post) return h("twitter-embed", { url: `${origin}${post}` });
  },
  // `<blockquote class="twitter-tweet">...<a href="https://twitter.com/<user>/status/<ID>?...">...</a></blockquote>` と、widgets.js の script
  fromEmbedCode: (nodes, index) => {
    const quote = nodes[index];
    if (!isElement(quote, "blockquote") || !hasClass(quote, "twitter-tweet")) return;
    // 公式コードは本文、作者の表記、日時のリンクの順
    const children = quote.children.filter((child) => child.type !== "text" || child.value.trim());
    const [body, author, link] = children;
    if (children.length !== 3) return;
    if (!isElement(body, "p") || author?.type !== "text" || !isElement(link, "a")) return;
    const post = /^https:\/\/(?:twitter|x)\.com\/(\w{1,50})\/status\/(\d{1,25})(?:[/?#]|$)/.exec(
      attribute(link, "href") ?? ""
    );
    if (!post || !new RegExp(`^\\s*[—–-]\\s*[^\\n]+\\(@${post[1] ?? ""}\\)\\s*$`).test(author.value)) return;
    return {
      url: `https://twitter.com/${post[1] ?? ""}/status/${post[2] ?? ""}`,
      length: withScript(nodes, index, 1, widgetsSource),
    };
  },
};
