import { h } from "hastscript";

import { safeFetch } from "../safe-fetch.ts";
import { attribute, isElement } from "./code.ts";

import type { Embed } from "./types.ts";

export const gist: Embed = {
  fromUrl: async (url, reserveFetch) => {
    const match = /^https:\/\/gist\.github\.com\/[\w-]+\/([a-f\d]+)\/?(?:[?#].*)?$/i.exec(url.href);
    if (!match) return;
    reserveFetch();
    const data: unknown = JSON.parse(
      (await safeFetch(`https://api.github.com/gists/${match[1]!}`, { maxBytes: 1_000_000 })).toString()
    );
    if (!data || typeof data !== "object" || !("files" in data) || !data.files || typeof data.files !== "object")
      throw new Error("不正な Gist です");
    const requested = url.searchParams.get("file");
    const fragment = url.hash.startsWith("#file-") ? url.hash.slice(6).replace(/-L\d+(?:-L\d+)?$/, "") : undefined;
    const files = Object.entries(data.files).filter(([name]) =>
      requested !== null
        ? name === requested
        : fragment
          ? name.toLowerCase().replace(/[^a-z0-9_-]/g, "-") === fragment
          : true
    );
    if (!files.length) throw new Error("Gist にファイルがありません");
    return h(
      "div",
      files.map(([filename, value]: [string, unknown]) => {
        if (
          !value ||
          typeof value !== "object" ||
          !("content" in value) ||
          typeof value.content !== "string" ||
          ("truncated" in value && value.truncated)
        )
          throw new Error("Gist のファイルを取得できません");
        const code = value.content;
        const language = /\.(\w+)$/.exec(filename)?.[1] ?? "text";
        return h(
          "pre",
          {
            className: [`language-${language}`],
            language,
            filename,
            meta: `href=${url.href}`,
            code,
            markdownDefault: true,
            githubEmbed: true,
          },
          [h("code", { __ignoreMap: "" }, code)]
        );
      })
    );
  },
  fromEmbedCode: (nodes, index) => {
    const node = nodes[index];
    if (!isElement(node, "script") || Object.keys(node.properties).length !== 1 || node.children.length) return;
    const src = attribute(node, "src");
    const match = /^https:\/\/gist\.github\.com\/([\w-]+)\/([a-f\d]+)\.js(?:\?file=([^&#]+))?$/i.exec(src ?? "");
    if (!match) return;
    const url = new URL(`https://gist.github.com/${match[1]!}/${match[2]!}`);
    if (match[3]) {
      try {
        url.searchParams.set("file", decodeURIComponent(match[3].replace(/\+/g, " ")));
      } catch {
        return;
      }
    }
    return { url: url.href, length: 1 };
  },
};
