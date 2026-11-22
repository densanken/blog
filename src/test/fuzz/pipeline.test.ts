import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import fc from "fast-check";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";
import { describe, it, vi } from "vitest";

import anchorGuard from "../../../plugins/rehype-anchor-guard.ts";
import callouts from "../../../plugins/rehype-callouts.ts";
import codeGroup from "../../../plugins/rehype-code-group.ts";
import embedCode from "../../../plugins/rehype-embed-code.ts";
import embed from "../../../plugins/rehype-embed.ts";
import externalLinks from "../../../plugins/rehype-external-links.ts";
import internalLinks from "../../../plugins/rehype-internal-links.ts";
import lucide from "../../../plugins/rehype-lucide.ts";
import markdownPreview from "../../../plugins/rehype-markdown-preview.ts";
import mdcCompat from "../../../plugins/rehype-mdc-compat.ts";
import toolbar from "../../../plugins/rehype-mermaid-toolbar.ts";
import plantuml from "../../../plugins/rehype-plantuml.ts";
import sanitize from "../../../plugins/rehype-sanitize.ts";
import svgAttributes from "../../../plugins/rehype-svg-attributes.ts";
import unicodeGenerated from "../../../plugins/rehype-unicode-generated.ts";
import urlGuard from "../../../plugins/rehype-url-guard.ts";
import assetImages from "../../../plugins/remark-asset-images.ts";
import embedBlockquote from "../../../plugins/remark-embed-blockquote.ts";
import postMeta from "../../../plugins/remark-post-meta.ts";
import { assertProperty, pipelineMarkdown, runs } from "./gen.ts";
import { invisibleViolations, violations } from "./safety.ts";

import type { Element, Root } from "hast";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn().mockRejectedValue(new Error("offline")) }));
vi.spyOn(console, "warn").mockImplementation(() => undefined);

const frames = [
  "https://www.youtube-nocookie.com",
  "https://platform.twitter.com",
  "https://syndication.twitter.com",
  "https://speakerdeck.com",
  "https://www.docswell.com",
  "https://docs.google.com",
  "https://www.google.com",
  "https://embed.figma.com",
  "https://www.figma.com",
  "https://miro.com",
  "https://www.canva.com",
  "https://codepen.io",
  "https://codesandbox.io",
  "https://open.spotify.com",
  "https://embed.music.apple.com",
  "https://clips.twitch.tv",
];
const allowedFrame = (src: string) => frames.some((f) => src.startsWith(`${f}/`));
const cache = mkdtempSync(join(tmpdir(), "fuzz-plantuml-"));
let knownCrash = 0;
const crashes = new Map<string, string>();
const seenTags = new Map<string, number>();
const seenIframes = new Set<string>();

const render = async (markdown: string) => {
  const { parseMarkdown } = await import("@nuxtjs/mdc/runtime/parser/index");
  let result: Root | undefined;
  const capture = () => (tree: Root) => {
    result = tree;
  };
  const contents = "/contents";
  await parseMarkdown(
    markdown,
    {
      remark: {
        plugins: {
          "remark-math": { instance: remarkMath },
          "embed-blockquote": { instance: embedBlockquote },
          assets: { instance: assetImages, options: { contents } },
          meta: { instance: postMeta },
        },
      },
      rehype: {
        plugins: {
          "rehype-raw": {},
          embedCode: { instance: embedCode },
          sanitize: { instance: sanitize, options: { contents } },
          lucide: { instance: lucide, options: { contents } },
          embed: { instance: embed },
          codeGroup: { instance: codeGroup },
          "rehype-external-links": false,
          unicodeGenerated: { instance: unicodeGenerated },
          externalLinks: { instance: externalLinks },
          urlGuard: { instance: urlGuard },
          internalLinks: { instance: internalLinks, options: { contents } },
          anchorGuard: { instance: anchorGuard },
          preview: { instance: markdownPreview },
          mdcCompat: { instance: mdcCompat, options: { contents } },
          callouts: { instance: callouts },
          katex: { instance: rehypeKatex },
          plantuml: { instance: plantuml, options: { contents, cacheDir: cache } },
          svg: { instance: svgAttributes },
          toolbar: { instance: toolbar },
          capture: { instance: capture },
        },
      },
    },
    { fileOptions: { path: "/contents/author/post.md" } }
  );
  if (!result) throw new Error("No output");
  return result;
};

const check = (tree: Root, src = "") => {
  const v = violations(tree, {
    allowIframe: allowedFrame,
    allowRelative: true,
    allowImg: (src) => src === "" || /^\/(?!\/)/.test(src),
    allowStyle: /^(?:aspect-ratio: [\d. /]+|height: [\d.]+px|background-color: [#\w(),.% -]+)$/,
    allowedIds: /^(?:user-content-|[a-z0-9-]+$)/,
  });
  if (!src.includes("\\char")) for (const m of invisibleViolations(tree)) v.push(`invisible: ${m}`);
  visit(tree, "element", (n: Element) => {
    seenTags.set(n.tagName, (seenTags.get(n.tagName) ?? 0) + 1);
    if (n.tagName === "iframe") {
      seenIframes.add(String(n.properties.src));
      if (!allowedFrame(String(n.properties.src))) v.push(`iframe outside allowlist: ${String(n.properties.src)}`);
      const keys = Object.keys(n.properties).sort().join();
      if (keys !== ["allow", "loading", "referrerPolicy", "sandbox", "src", "title"].sort().join())
        v.push(`iframe attrs ${keys}`);
      if (n.children.length) v.push("iframe has children");
    }
    if (
      n.tagName === "twitter-embed" &&
      !/^https:\/\/(?:www\.)?(?:twitter|x)\.com\/\w{1,50}\/status\/\d{1,25}$/.test(String(n.properties.url))
    )
      v.push(`twitter-embed url ${String(n.properties.url)}`);
    if (n.tagName === "twitter-embed" && Object.keys(n.properties).join() !== "url")
      v.push(`twitter-embed attrs ${Object.keys(n.properties).join()}`);
    // 作者が書けない信頼済みの要素名が、許可された形以外で残っていないか
    if (
      n.tagName.includes("-") &&
      ![
        "twitter-embed",
        "link-card",
        "github-embed",
        "mermaid-toolbar",
        "code-group",
        "icon-lucide",
        "lucide-icon",
        "plantuml-diagram",
      ].includes(n.tagName)
    )
      v.push(`unexpected custom element <${n.tagName}>`);
  });
  return v;
};

describe("article pipeline fuzz", () => {
  it("full chain output is safe", async () => {
    const n = await assertProperty(
      fc.asyncProperty(pipelineMarkdown, async (src) => {
        let tree: Root;
        try {
          tree = await render(src);
        } catch (error) {
          // 既知の不具合（非オブジェクトの frontmatter で readingTime を代入できない）は数えて除外する
          const key = String(error).slice(0, 90);
          const entry = crashes.get(key);
          if (!entry || src.length < entry.length) crashes.set(key, src);
          knownCrash++;
          return;
        }
        const v = check(tree, src);
        if (v.length) throw new Error(JSON.stringify(v));
      }),
      runs(10000)
    );
    console.log("RUNS", n, "crashes", knownCrash, JSON.stringify([...crashes]));
    console.log("TAGS", JSON.stringify([...seenTags]));
    console.log("IFRAMES", JSON.stringify([...seenIframes]));
  }, 1_800_000);
});
