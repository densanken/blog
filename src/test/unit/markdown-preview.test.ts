import { load } from "cheerio";
import { VFile } from "vfile";
import { describe, expect, it, vi } from "vitest";

import preview, { isMarkdown, renderMarkdownPreview } from "../../../plugins/rehype-markdown-preview.ts";

import type { Root } from "hast";

describe("Markdown preview", () => {
  it("does not let KaTeX emit arbitrary characters through \\char", async () => {
    for (const source of ['$\\char"202E$', "$\\@char{8238}$", '$\\char"200B$'])
      expect(await renderMarkdownPreview(source), source).not.toMatch(/[\u202e]|&#x202e;|&#8238;/i);
  });
  it.each(["\n", "\r\n"])("hides leading frontmatter with %j line endings", async (newline) => {
    const source = ["---", "title: はじめての記事", "date: 2026-01-01", "---", "", "本文"].join(newline);
    expect(await renderMarkdownPreview(source)).toBe("<p>本文</p>");
  });
  it.each(["\n", "\r\n", "\r"])(
    "hides frontmatter with trailing spaces and tabs using %j line endings",
    async (newline) => {
      for (const opening of ["--- ", "---\t"]) {
        for (const closing of ["--- ", "---\t"]) {
          const source = [opening, "title: example", closing, "", "本文"].join(newline);
          expect(await renderMarkdownPreview(source)).toBe("<p>本文</p>");
          expect(await renderMarkdownPreview([opening, "title: example", closing].join(newline))).toBe("");
        }
      }
    }
  );
  it("hides frontmatter after a leading BOM", async () => {
    expect(await renderMarkdownPreview("\uFEFF---\ntitle: example\n---\n\n本文")).toBe("<p>本文</p>");
    expect(await renderMarkdownPreview("\uFEFF--- \r\ntitle: example\r\n---\t")).toBe("");
  });
  it("preserves horizontal rules, setext headings and unclosed frontmatter", async () => {
    expect(await renderMarkdownPreview("本文\n\n---\n\n見出し\n---")).toBe(
      '<p>本文</p>\n<hr>\n<p class="md-h2">見出し</p>'
    );
    expect(await renderMarkdownPreview("---\ntitle: unclosed")).toBe("<hr>\n<p>title: unclosed</p>");
    expect(await renderMarkdownPreview(`---\r\n${"unclosed\r\n".repeat(100)}`)).toContain("unclosed");
  });
  it("renders empty frontmatter-only previews and preserves the original code", async () => {
    const source = "---\ntitle: example\n---";
    const tree: Root = {
      type: "root",
      children: [{ type: "element", tagName: "pre", properties: { language: "md", code: source }, children: [] }],
    };
    await preview()(tree, new VFile());
    expect(tree.children[0]).toMatchObject({ properties: { code: source, markdownPreview: "" } });
    expect(await renderMarkdownPreview("---\n---\n")).toBe("");
  });
  it("does not warn about invisible characters or unsafe URLs in hidden frontmatter", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const output = await renderMarkdownPreview(
        "---\ntitle: foo\u200bbar\nurl: '[google.test](//gоogle.test)'\n---\n\n本文"
      );
      expect(output).toBe("<p>本文</p>");
      expect(warning).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it.each(["md", "markdown", "MD", "Markdown"])("recognizes %s", (language) => {
    expect(isMarkdown(language)).toBe(true);
  });
  it.each(["mdx", "text", "", undefined])("rejects %s", (language) => {
    expect(isMarkdown(language)).toBe(false);
  });
  it("renders Markdown without active HTML, components, images or embeds", async () => {
    const output = await renderMarkdownPreview(`
# Heading

**bold** [external](https://example.com/) [bad](javascript:alert(1))

<script>alert(1)</script>

<iframe src="https://evil.example/"></iframe>

<div onclick="alert(1)">raw html</div>

https://gist.github.com/user/abcdef

::evil-component{onclick="alert(1)"}
content
::

![local](./assets/secret.png) ![absolute](/contents/a/assets/a.png) ![remote](https://evil.example/image.png)
`);
    expect(output).toContain('<p class="md-h1">Heading</p>');
    expect(output).toContain("<strong>bold</strong>");
    expect(output).toContain('target="_blank"');
    expect(output).toContain('rel="noopener noreferrer"');
    expect(output).not.toMatch(
      /<script|<iframe|<div|<img|<evil-component|<[^>]+\sonclick=|javascript:|secret\.png|image\.png|<code-group/i
    );
    expect(output).toContain("https://gist.github.com/user/abcdef");
  });
  it("converts all heading levels and disables unresolved fragments", async () => {
    const source = Array.from({ length: 6 }, (_, i) => `${"#".repeat(i + 1)} Heading ${String(i + 1)}`).join("\n\n");
    const output = await renderMarkdownPreview(`${source}\n\n[link](#heading-1)`);
    for (let i = 1; i <= 6; i++) expect(output).toContain(`<p class="md-h${String(i)}">Heading ${String(i)}</p>`);
    expect(output).not.toMatch(/<h[1-6]\b|\sid=|href="#/);
  });
  it("sets a preview only on Markdown pre elements", async () => {
    const tree: Root = {
      type: "root",
      children: [
        { type: "element", tagName: "pre", properties: { language: "md", code: "**bold**" }, children: [] },
        { type: "element", tagName: "pre", properties: { language: "text", code: "**bold**" }, children: [] },
      ],
    };
    await preview()(tree, new VFile());
    expect(tree.children[0]).toMatchObject({ properties: { markdownPreview: "<p><strong>bold</strong></p>" } });
    expect(tree.children[1]).not.toHaveProperty("properties.markdownPreview");
  });
  it("creates a preview for an empty Markdown block without a filename", async () => {
    const tree: Root = {
      type: "root",
      children: [{ type: "element", tagName: "pre", properties: { language: "markdown", code: "" }, children: [] }],
    };
    await preview()(tree, new VFile());
    expect(tree.children[0]).toMatchObject({ properties: { markdownPreview: "" } });
  });
  it("keeps footnote links unique to each preview", async () => {
    const source = "footnote[^1]\n\n[^1]: Note";
    const first = await renderMarkdownPreview(source, 1);
    const second = await renderMarkdownPreview(source, 2);
    expect(first).toContain('aria-describedby="user-content-preview-1-user-content-footnote-label"');
    expect(first).toContain('id="user-content-preview-1-user-content-footnote-label"');
    expect(first).toContain('href="#user-content-preview-1-user-content-fn-1"');
    expect(first).toContain('id="user-content-preview-1-user-content-fn-1"');
    expect(first).toContain('href="#user-content-preview-1-user-content-fnref-1"');
    expect(second).toContain('id="user-content-preview-2-user-content-fn-1"');
  });
  it("keeps encoded footnotes connected when cleaned IDs collide", async () => {
    const output = await renderMarkdownPreview("one[^ab] two[^a%E2%80%8Bb]\n\n[^ab]: first\n\n[^a%E2%80%8Bb]: second");
    const $ = load(output);
    $("a[href^='#']").each((_i, element) => {
      const id = $(element).attr("href")!.slice(1);
      expect($(`[id="${id}"]`)).toHaveLength(1);
    });
    expect($("a[href^='#']")).toHaveLength(4);
    expect(output).toContain("-safe-2");
  });
  it("checks protocol-relative links in previews", async () => {
    const output = await renderMarkdownPreview("[google.test](//gоogle.test)");
    expect(output).toContain("url-warning");
    expect(output).toContain("xn--");
  });
  it.each(["。", "．", "｡"])("warns about Unicode dot %s in a displayed URL", async (dot) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const output = await renderMarkdownPreview(`[https://google${dot}test](https://evil.example)`);
    expect(output).toContain("url-warning");
    expect(output).toContain("evil.example");
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
  it("includes the article path in preview warnings", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const tree: Root = {
        type: "root",
        children: [
          {
            type: "element",
            tagName: "pre",
            properties: { language: "md", code: "[google.test](//gоogle.test)" },
            children: [],
          },
        ],
      };
      await preview()(tree, new VFile({ path: "contents/writer/article.md" }));
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^::warning file=contents\/writer\/article\.md::/));
    } finally {
      log.mockRestore();
      warning.mockRestore();
      vi.unstubAllEnvs();
    }
  });
  it("renders math without trusting HTML extensions", async () => {
    const output = await renderMarkdownPreview(String.raw`Math $x^2$ and $\htmlClass{evil}{x}$`);
    expect(output).toContain('class="katex"');
    expect(output).not.toContain('class="evil"');
  });
});

it("keeps generated math spacing while cleaning author input", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const output = await renderMarkdownPreview(`${String.raw`$\frac{a}{b}$`}\n\nfoo\u200bbar`);
    expect(output).toContain('class="vlist-s">\u200b');
    expect(output).toContain("foobar");
    expect(warning).toHaveBeenCalledTimes(1);
  } finally {
    warning.mockRestore();
  }
});

it("shows mail addresses as text and highlights preview code", async () => {
  const output = await renderMarkdownPreview(
    "foo@example.com <foo@example.com> [text](mailto:foo@example.com)\n\n```python\nfrom x import y\n\nprint(y)\n```"
  );
  const $ = load(output);
  expect($("a")).toHaveLength(0);
  expect($("p").text()).toBe("foo@example.com foo@example.com text");
  expect($("pre.shiki .line")).toHaveLength(3);
  expect($("pre.shiki span[style]").length).toBeGreaterThan(0);
  expect(output).toContain("--shiki-dark");
});

it("renders GitHub Alerts and leaves unknown markers as blockquotes", async () => {
  const types = ["note", "tip", "important", "warning", "caution"];
  const source = types.map((type) => `> [!${type.toUpperCase()}]\n> text`).join("\n\n");
  const $ = load(await renderMarkdownPreview(`${source}\n\n> [!UNKNOWN]\n> text\n\n# Heading`));
  for (const type of types) {
    expect($(`[data-callout="${type}"] .callout-title-icon svg`)).toHaveLength(1);
  }
  expect($("blockquote").text()).toContain("[!UNKNOWN]");
  expect($("p.md-h1").text()).toBe("Heading");
});

it("visualizes invisible characters in highlighted code", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const output = await renderMarkdownPreview("```python\na\u200bb\n```");
    expect(load(output)("code").text()).toContain("U+200B");
    expect(output).toContain("shiki");
    expect(warning).toHaveBeenCalled();
  } finally {
    warning.mockRestore();
  }
});
