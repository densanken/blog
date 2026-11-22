import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseMarkdown } from "@nuxtjs/mdc/runtime/parser/index";
import { load } from "cheerio";
import { toHtml } from "hast-util-to-html";
import { h } from "hastscript";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { VFile } from "vfile";
import { describe, expect, it, vi } from "vitest";

import anchorGuard from "../../../plugins/rehype-anchor-guard.ts";
import internalLinks from "../../../plugins/rehype-internal-links.ts";
import preview from "../../../plugins/rehype-markdown-preview.ts";
import sanitize from "../../../plugins/rehype-sanitize.ts";
import unicodeGuard from "../../../plugins/rehype-unicode-code.ts";
import urlGuard from "../../../plugins/rehype-url-guard.ts";
import { checkGeneratedLinks } from "../../../scripts/check-generated-links.ts";

import type { Root } from "hast";

describe("link regressions", () => {
  it("reserves footnote IDs before Unicode cleanup resolves collisions", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let html = "";
    try {
      const source =
        '<span id="fn-ab">fake</span> <span id="fnref-ab">fake</span> x[^a%E2%80%8Bb]\n\n[^a%E2%80%8Bb]: real';
      await parseMarkdown(
        source,
        {
          rehype: {
            plugins: {
              "rehype-raw": {},
              sanitize: { instance: sanitize, options: { contents: "/contents" } },
              unicodeGuard: { instance: unicodeGuard },
              anchorGuard: { instance: anchorGuard },
              capture: {
                instance: () => (tree: Root) => {
                  html = toHtml(tree);
                },
              },
            },
          },
        },
        { fileOptions: { path: "/contents/a/post.md" } }
      );
      const $ = load(html);
      expect($("section li").attr("id")).toBe("user-content-fn-ab");
      expect($("sup a").attr("id")).toBe("user-content-fnref-ab");
      expect($("sup a").attr("href")).toBe("#user-content-fn-ab");
      expect($("section li a").attr("href")).toBe("#user-content-fnref-ab");
      expect($("span[id$='-safe-2']")).toHaveLength(2);
    } finally {
      warning.mockRestore();
    }
  });
  it.each([
    '<a id="fnref-1" data-footnote-ref href="#x">fake</a> text[^1]\n\n[^1]: real',
    '<span id="fn-%D0%B0">fake</span> <span id="fnref-%D0%B0">fake</span> x[^a] y[^а]\n\n[^a]: first\n\n[^а]: second',
  ])("keeps footnotes connected despite forged or confusable anchors", async (source) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let html = "";
    try {
      await parseMarkdown(
        source,
        {
          rehype: {
            plugins: {
              "rehype-raw": {},
              sanitize: { instance: sanitize, options: { contents: "/contents" } },
              anchorGuard: { instance: anchorGuard },
              capture: {
                instance: () => (tree: Root) => {
                  html = toHtml(tree);
                },
              },
            },
          },
        },
        { fileOptions: { path: "/contents/a/post.md" } }
      );
      const $ = load(html);
      $("sup a[data-footnote-ref]").each((_index, element) => {
        const ref = $(element);
        const footnote = $("section[data-footnotes] li").filter(
          (_i, item) => `#${$(item).attr("id") ?? ""}` === ref.attr("href")
        );
        expect(footnote).toHaveLength(1);
        expect(footnote.find("a[data-footnote-backref]").attr("href")).toBe(`#${ref.attr("id") ?? ""}`);
      });
      expect($("sup a[data-footnote-ref]").length).toBe(source.includes("second") ? 2 : 1);
    } finally {
      warning.mockRestore();
    }
  });
  it("reserves generated footnote anchors before conflicting author IDs", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let html = "";
    try {
      await parseMarkdown(
        '<span id="fn-1">Fake</span> <span id="fnref-1">Fake ref</span> <span id="footnote-label">Fake label</span>\n\ntext[^1]\n\n[^1]: Real',
        {
          rehype: {
            plugins: {
              "rehype-raw": {},
              sanitize: { instance: sanitize, options: { contents: "/contents" } },
              anchorGuard: { instance: anchorGuard },
              capture: {
                instance: () => (tree: Root) => {
                  html = toHtml(tree);
                },
              },
            },
          },
        },
        { fileOptions: { path: "/contents/a/post.md" } }
      );
      const $ = load(html);
      const ref = $("a[data-footnote-ref]");
      const footnote = $("section[data-footnotes] li");
      const label = $("section[data-footnotes] h2");
      expect(footnote.text()).toContain("Real");
      expect(footnote.attr("id")).toBe("user-content-fn-1");
      expect(ref.attr("id")).toBe("user-content-fnref-1");
      expect(label.attr("id")).toBe("user-content-footnote-label");
      expect(ref.attr("href")).toBe("#user-content-fn-1");
      expect(footnote.find("a[data-footnote-backref]").attr("href")).toBe("#user-content-fnref-1");
      expect(ref.attr("aria-describedby")).toBe("user-content-footnote-label");
      for (const id of ["user-content-fn-1", "user-content-fnref-1", "user-content-footnote-label"]) {
        expect($(`[id="${id}"]`)).toHaveLength(1);
      }
      expect($("span[id$='-safe-2']")).toHaveLength(3);
      expect(warning).toHaveBeenCalledTimes(3);
    } finally {
      warning.mockRestore();
    }
  });
  it.each(["。", "．", "｡"])("warns about Unicode dot %s in a displayed URL", (dot) => {
    const parser = unified().use(remarkParse).use(remarkRehype);
    const tree = parser.runSync(parser.parse(`[https://google${dot}com](https://evil.example)`));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    urlGuard()(tree, new VFile({ path: "post.md" }));
    expect(JSON.stringify(tree)).toContain("url-warning");
    expect(JSON.stringify(tree)).toContain("evil.example");
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
  it.each(["[google.com](//gоogle.com)", '<a href="//gоogle.com">google.com</a>'])(
    "checks protocol-relative Markdown and HTML: %s",
    (source) => {
      const parser = unified().use(remarkParse).use(remarkRehype);
      const $ = load(source);
      const tree: Root = source.startsWith("<")
        ? { type: "root", children: [h("a", { href: $("a").attr("href") }, $("a").text())] }
        : parser.runSync(parser.parse(source));
      urlGuard()(tree, new VFile({ path: "post.md" }));
      expect(JSON.stringify(tree)).toContain("url-warning");
      expect(JSON.stringify(tree)).toContain("xn--");
    }
  );
  it.each(["text", "md"])("checks the filename link of a %s code block", (language) => {
    const tree: Root = {
      type: "root",
      children: [h("pre", { language, filename: "example.txt", meta: "[example.txt] href=https://gоogle.com" })],
    };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    urlGuard()(tree, new VFile({ path: "post.md" }));
    expect(tree.children[0]).toMatchObject({
      properties: { filenameUrlHost: "xn--gogle-jye.com", filenameUrlWarning: true },
    });
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
  it("does not treat a filename as a domain label", () => {
    const tree: Root = {
      type: "root",
      children: [h("pre", { filename: "example.txt", meta: "href=https://github.com/example" })],
    };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    urlGuard()(tree, new VFile({ path: "post.md" }));
    expect(tree.children[0]).not.toHaveProperty("properties.filenameUrlWarning");
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
  });
  it("keeps encoded footnote references connected when cleaned IDs collide", () => {
    const parser = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const file = new VFile({
      path: "post.md",
      value: "one[^ab] two[^a%E2%80%8Bb]\n\n[^ab]: first\n\n[^a%E2%80%8Bb]: second",
    });
    const tree = parser.runSync(parser.parse(file), file);
    unicodeGuard()(tree, file);
    anchorGuard()(tree, file);
    const $ = load(toHtml(tree));
    $("a[href^='#']").each((_i, element) => {
      const id = $(element).attr("href")!.slice(1);
      expect($(`[id="${id}"]`)).toHaveLength(1);
    });
    expect($("a[href^='#']")).toHaveLength(4);
    $("a[data-footnote-ref]").each((index, element) => {
      const ref = $(element);
      const note = $("section li").filter((_i, item) => `#${$(item).attr("id") ?? ""}` === ref.attr("href"));
      expect(note.text()).toContain(index === 0 ? "first" : "second");
      expect(note.find("a[data-footnote-backref]").attr("href")).toBe(`#${ref.attr("id") ?? ""}`);
    });
    expect($("[id$='-safe-2']").length).toBeGreaterThan(0);
  });
  it("canonicalizes existing article links and preserves missing ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "links-"));
    try {
      mkdirSync(join(dir, "Writer", "Nested"), { recursive: true });
      writeFileSync(join(dir, "Writer", "profile.yaml"), "name: Writer\n");
      writeFileSync(join(dir, "Writer", "Nested", "Hello.md"), "---\ndate: 2020-01-01\n---\n");
      writeFileSync(join(dir, "Writer", "Future.md"), "---\ndate: 2999-01-01\n---\n");
      const tree: Root = {
        type: "root",
        children: [
          h("a", { href: "/@WRITER/Nested/Hello?q=1#x" }, "x"),
          h("a", { href: "/@WRITER/Missing" }, "y"),
          h("a", { href: "/@WRITER/Future" }, "future"),
          h("a", { href: "./HELLO/" }, "relative"),
          h("a", { href: "/%40writer/nested/%68ello" }, "encoded"),
          h("a", { href: "#fn-1" }, "footnote"),
          h("a", { href: "/privacy?x=1#top" }, "page"),
          h("a", { href: "https://blog.densanken.com/@writer" }, "author"),
          h("a", { href: "/feed.xml" }, "file"),
        ],
      };
      const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      internalLinks({ contents: dir })(tree, new VFile({ path: join(dir, "Writer", "Nested", "Other.md") }));
      expect(tree.children[0]).toMatchObject({ properties: { href: "/@Writer/nested/hello/?q=1#x" } });
      expect(tree.children[1]).toMatchObject({ properties: { href: "/@WRITER/Missing" } });
      expect(tree.children[2]).toMatchObject({ properties: { href: "/@WRITER/Future" } });
      expect(tree.children[3]).toMatchObject({ properties: { href: "/@Writer/nested/hello/" } });
      expect(tree.children[4]).toMatchObject({ properties: { href: "/@Writer/nested/hello/" } });
      expect(tree.children[5]).toMatchObject({ properties: { href: "#fn-1" } });
      expect(tree.children[6]).toMatchObject({ properties: { href: "/privacy/?x=1#top" } });
      expect(tree.children[7]).toMatchObject({ properties: { href: "https://blog.densanken.com/@writer/" } });
      expect(tree.children[8]).toMatchObject({ properties: { href: "/feed.xml" } });
      expect(log).toHaveBeenCalled();
      log.mockRestore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("does not treat the paging of an author page as an article", () => {
    const dir = mkdtempSync(join(tmpdir(), "internal-"));
    try {
      mkdirSync(join(dir, "Writer"), { recursive: true });
      writeFileSync(join(dir, "Writer", "profile.yaml"), "name: Writer\n");
      const tree: Root = {
        type: "root",
        children: [h("a", { href: "/@Writer/page/2" }, "next"), h("a", { href: "/@Writer/page/2/" }, "next")],
      };
      const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      internalLinks({ contents: dir })(tree, new VFile({ path: join(dir, "Writer", "Other.md") }));
      expect(tree.children[0]).toMatchObject({ properties: { href: "/@Writer/page/2/" } });
      expect(tree.children[1]).toMatchObject({ properties: { href: "/@Writer/page/2/" } });
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("warns about invalid links in generated output", () => {
    const dir = mkdtempSync(join(tmpdir(), "generated-"));
    try {
      mkdirSync(join(dir, "@writer", "hello"), { recursive: true });
      writeFileSync(join(dir, "@writer", "hello", "index.html"), '<a href="/@WRITER/Hello">x</a>');
      const log = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      checkGeneratedLinks(dir);
      expect(log).toHaveBeenCalled();
      log.mockClear();
      writeFileSync(join(dir, "@writer", "hello", "index.html"), '<a href="/@writer/hello">x</a>');
      checkGeneratedLinks(dir);
      expect(log).toHaveBeenCalled();
      log.mockClear();
      writeFileSync(
        join(dir, "@writer", "hello", "index.html"),
        '<a href="#fn-1">note</a><a href="/@writer/hello/">x</a>'
      );
      checkGeneratedLinks(dir);
      expect(log).not.toHaveBeenCalled();
      log.mockRestore();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("avoids IDs already present in the article", async () => {
    const tree: Root = {
      type: "root",
      children: [
        h("span", { id: "user-content-preview-0-user-content-fn-1" }),
        h("pre", { language: "md", code: "note[^1]\n\n[^1]: text" }),
      ],
    };
    await preview()(tree, new VFile());
    const output = (tree.children[1] as ReturnType<typeof h>).properties.markdownPreview;
    expect(output).toContain('id="user-content-preview-0-user-content-fn-1-safe-2"');
    expect(output).toContain('href="#user-content-preview-0-user-content-fn-1-safe-2"');
  });
  it("avoids preview IDs that differ from article IDs only by a variation selector", async () => {
    const tree: Root = {
      type: "root",
      children: [
        h("span", { id: "user-content-preview-0-user-content-fn-1\u{E01EF}" }),
        h("pre", { language: "md", code: "note[^1]\n\n[^1]: text" }),
      ],
    };
    await preview()(tree, new VFile());
    const output = (tree.children[1] as ReturnType<typeof h>).properties.markdownPreview;
    expect(output).toContain('id="user-content-preview-0-user-content-fn-1-safe-2"');
    expect(output).toContain('href="#user-content-preview-0-user-content-fn-1-safe-2"');
  });
});
