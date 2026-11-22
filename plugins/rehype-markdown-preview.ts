import { toHtml } from "hast-util-to-html";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { createHighlighter } from "shiki";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";

import { highlight } from "./highlight.ts";
import anchorGuard, { anchorShape } from "./rehype-anchor-guard.ts";
import callouts from "./rehype-callouts.ts";
import externalLinks from "./rehype-external-links.ts";
import { schema, unwrapLinks } from "./rehype-sanitize.ts";
import unicodeCode from "./rehype-unicode-code.ts";
import urlGuard from "./rehype-url-guard.ts";

import type { Root } from "hast";

export const isMarkdown = (language: unknown) => typeof language === "string" && /^(?:md|markdown)$/i.test(language);

// HTML と MDC を解析せず、埋め込みや画像の取得も行わない
// 画像は第三者の変更による通信とローカルアセット参照を避けるため、代替テキストだけを残す
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype)
  .use(() => (tree: Root) => {
    visit(tree, "element", (node, index, parent) => {
      if (typeof node.properties.id === "string") node.properties.id = node.properties.id.replace(/^user-content-/, "");
      if (node.tagName === "img" && parent && index !== undefined) {
        parent.children.splice(index, 1, { type: "text", value: node.properties.alt ?? "" });
      }
      if (
        node.tagName === "a" &&
        typeof node.properties.href === "string" &&
        !/^(?:https?:\/\/|\/\/|#)/i.test(node.properties.href)
      ) {
        delete node.properties.href;
      }
    });
  })
  .use(rehypeSanitize, schema)
  .use(() => unwrapLinks)
  // 作者の入力を検査してから信頼できる数式のマークアップを生成する
  .use(unicodeCode)
  .use(externalLinks)
  .use(urlGuard)
  .use(anchorGuard)
  .use(callouts)
  .use(rehypeKatex);

const highlighter = createHighlighter({ themes: Object.values(highlight.theme), langs: [] });

export const renderMarkdownPreview = async (source: string, index = 0, used = new Set<string>(), file?: VFile) => {
  const content = source.replace(
    /^\uFEFF?---[ \t]*(?:\r\n|\r(?!\n)|\n)(?:[^\r\n]*(?:\r\n|\r(?!\n)|\n))*?---[ \t]*(?:\r\n|\r(?!\n)|\n|$)/,
    ""
  );
  const tree = processor.runSync(processor.parse(content), new VFile({ value: content, path: file?.path }));
  const shiki = await highlighter;
  const blocks: { node: import("hast").Element; language: string; code: string }[] = [];
  visit(tree, "element", (node) => {
    if (node.tagName !== "pre") return;
    const code = node.children[0];
    if (code?.type !== "element" || code.tagName !== "code") return;
    const language = Array.isArray(code.properties.className)
      ? (code.properties.className.find((name) => name.startsWith("language-")) ?? "").slice(9)
      : "";
    if (!highlight.langs.includes(language as (typeof highlight.langs)[number])) return;
    blocks.push({
      node,
      language,
      code: code.children
        .map((child) => (child.type === "text" ? child.value : ""))
        .join("")
        .replace(/\n$/, ""),
    });
  });
  for (const block of blocks) {
    if (!shiki.getLoadedLanguages().includes(block.language))
      await shiki.loadLanguage(block.language as (typeof highlight.langs)[number]);
    const rendered = shiki.codeToHast(block.code, {
      lang: block.language,
      themes: { light: highlight.theme.default, dark: highlight.theme.dark },
    });
    const pre = rendered.children[0];
    if (pre?.type === "element") {
      block.node.properties = pre.properties;
      block.node.children = pre.children;
      const code = block.node.children[0];
      if (code?.type === "element")
        code.children = code.children.filter((child) => child.type !== "text" || child.value !== "\n");
    }
  }
  const ids = new Map<string, string>();
  visit(tree, "element", (node) => {
    const { properties } = node;
    if (/^h[1-6]$/.test(node.tagName)) {
      properties.className = [
        ...(Array.isArray(properties.className) ? properties.className : []),
        `md-${node.tagName}`,
      ];
      if (properties.id === "user-content-footnote-label") {
        node.children = [
          { type: "element", tagName: "span", properties: { id: properties.id }, children: node.children },
        ];
      }
      delete properties.id;
      node.tagName = "p";
    }
    if (typeof properties.id === "string") {
      const original = properties.id;
      const base = `user-content-preview-${String(index)}-${original}`;
      let id = base;
      let suffix = 2;
      while (used.has(anchorShape(id))) id = `${base}-safe-${String(suffix++)}`;
      used.add(anchorShape(id));
      ids.set(original, id);
      properties.id = id;
    }
  });
  visit(tree, "element", ({ properties }) => {
    if (typeof properties.href === "string" && properties.href.startsWith("#")) {
      const id = ids.get(properties.href.slice(1));
      if (id) properties.href = `#${id}`;
      else delete properties.href;
    }
    if (Array.isArray(properties.ariaDescribedBy)) {
      properties.ariaDescribedBy = properties.ariaDescribedBy.map((id) => ids.get(id) ?? id);
    }
  });
  return toHtml(tree);
};

export default () => async (tree: Root, file: VFile) => {
  let index = 0;
  const used = new Set<string>();
  visit(tree, "element", ({ properties }) => {
    for (const value of [properties.id, properties.name]) {
      if (typeof value === "string") used.add(anchorShape(value));
    }
  });
  const blocks: import("hast").Element[] = [];
  visit(tree, "element", (node) => {
    if (node.tagName === "pre" && isMarkdown(node.properties.language) && typeof node.properties.code === "string")
      blocks.push(node);
  });
  for (const node of blocks)
    node.properties.markdownPreview = await renderMarkdownPreview(String(node.properties.code), index++, used, file);
};
