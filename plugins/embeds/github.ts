import { safeFetch } from "../safe-fetch.ts";

import type { Embed } from "./types.ts";
import type { Element } from "hast";

export const github: Embed = {
  fromUrl: async (url, reserveFetch): Promise<Element | undefined> => {
    const [, repo, ref, path, from, to = from] =
      /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/blob\/([\w.-]+)\/([^#?]+)(?:#L(\d+)(?:-L(\d+))?)?$/.exec(url.href) ??
      [];
    if (!repo || !ref || !path) return;
    reserveFetch();
    const body = await safeFetch(`https://raw.githubusercontent.com/${repo}/${ref}/${path}`, { maxBytes: 200_000 });
    const lines = body.toString().replace(/\n$/, "").split("\n");
    const code = `${(from ? lines.slice(Number(from) - 1, Number(to)) : lines).join("\n")}\n`;
    const language = /\.(\w+)$/.exec(path)?.[1] ?? "text";
    const filename = `${repo}/${path}${from ? `:L${from}${to === from ? "" : `-L${String(to)}`}` : ""}`;
    // MDC のコードブロックと同じ構造にする（ProsePre が href をファイル名のリンク先、showLineNumbers を行番号の開始値として使う）
    const meta = `href=${url.href} showLineNumbers=${from ?? "1"}`;
    return {
      type: "element",
      tagName: "pre",
      properties: { className: [`language-${language}`], language, filename, meta, code, githubEmbed: true },
      children: [
        {
          type: "element",
          tagName: "code",
          properties: { __ignoreMap: "" },
          children: [{ type: "text", value: code }],
        },
      ],
    };
  },
  // GitHub には、コードの埋め込みコードがない（Gist の script は対象外）
  fromEmbedCode: () => undefined,
};
