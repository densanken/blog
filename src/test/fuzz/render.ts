import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { vi } from "vitest";

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

import type { Root } from "hast";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn().mockRejectedValue(new Error("offline")) }));
vi.spyOn(console, "warn").mockImplementation(() => undefined);

const cache = mkdtempSync(join(tmpdir(), "fuzz-plantuml-"));
export const render = async (markdown: string) => {
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
