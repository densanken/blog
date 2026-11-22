import { parseMarkdown } from "@nuxtjs/mdc/runtime/parser/index";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";

import callouts from "../../../plugins/rehype-callouts.ts";
import { renderMarkdownPreview } from "../../../plugins/rehype-markdown-preview.ts";
import compat from "../../../plugins/rehype-mdc-compat.ts";
import sanitize from "../../../plugins/rehype-sanitize.ts";

const parse = (source: string) =>
  parseMarkdown(
    source,
    {
      rehype: {
        plugins: {
          sanitize: { instance: sanitize, options: { contents: "/contents" } },
          compat: { instance: compat },
          callouts: { instance: callouts },
        },
      },
    },
    { fileOptions: { path: "/contents/writer/post.md" } }
  );

describe("GitHub Alerts", () => {
  it.each(["", "\\", "  "])("preserves body breaks after a title ending in %j", async (ending) => {
    const source = `> [!NOTE]${ending}\n> first\\\n> second  \n> third\n>\n> fourth\\\n> fifth`;
    const article = JSON.stringify((await parse(source)).body);
    expect(article.match(/"tag":"br"/g)).toHaveLength(3);
    expect(article).toContain('"value":"Note"');
    const $ = load(await renderMarkdownPreview(source));
    expect($(".callout-title-text").text()).toBe("Note");
    const paragraphs = $(".callout-content > p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs.eq(0).html()).toMatch(/^first<br\s*\/?>(?:\n)?second<br\s*\/?>(?:\n)?third$/);
    expect(paragraphs.eq(1).find("br")).toHaveLength(1);
  });
  it("preserves custom titles and breaks in nested alerts", async () => {
    const source = "> [!TIP] Custom title\n> outer\\\n> line\n>\n> > [!NOTE] Nested title  \n> > inner  \n> > line";
    const article = JSON.stringify((await parse(source)).body);
    expect(article.match(/"tag":"br"/g)).toHaveLength(2);
    expect(article).toContain("Custom title");
    expect(article).toContain("Nested title");
    const $ = load(await renderMarkdownPreview(source));
    expect(
      $(".callout-title-text")
        .map((_, node) => $(node).text())
        .get()
    ).toEqual(["Custom title", "Nested title"]);
    expect(
      $(".callout-content > p")
        .map((_, node) => $(node).find("br").length)
        .get()
    ).toEqual([1, 1]);
  });
  it("leaves unknown alerts and ordinary blockquotes unchanged", async () => {
    const source = "> [!UNKNOWN]\n> first\\\n> second\n\n> ordinary [!NOTE]\\\n> quote";
    const article = JSON.stringify((await parse(source)).body);
    expect(article.match(/"tag":"br"/g)).toHaveLength(2);
    expect(article).not.toContain("data-callout");
    const $ = load(await renderMarkdownPreview(source));
    expect($("blockquote")).toHaveLength(2);
    expect($("blockquote br")).toHaveLength(2);
    expect($("[data-callout]")).toHaveLength(0);
  });
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "keeps %s as an ordinary blockquote in articles and previews",
    async (type) => {
      const source = `> [!${type}]\n> text`;
      const article = JSON.stringify((await parse(source)).body);
      expect(article).toContain('"tag":"blockquote"');
      expect(article).toContain(type === "__proto__" ? '"value":"proto"' : `"value":"!${type}"`);
      expect(article).toContain('"value":"["');
      expect(article).toContain('"value":"]"');
      expect(article).not.toContain("data-callout");
      const $ = load(await renderMarkdownPreview(source));
      expect($("blockquote").text()).toContain("text");
      expect($("blockquote").text()).toContain(type === "__proto__" ? "[!proto]" : `[!${type}]`);
      expect($("[data-callout]")).toHaveLength(0);
    }
  );
  it.each(["note", "TIP", "Important", "wArNiNg", "caution"])("renders %s in articles and previews", async (type) => {
    const source = `> [!${type}]\n> text`;
    expect(JSON.stringify((await parse(source)).body)).toContain(`"data-callout":"${type.toLowerCase()}"`);
    const $ = load(await renderMarkdownPreview(source));
    expect($(`[data-callout="${type.toLowerCase()}"]`)).toHaveLength(1);
  });
  it("renders an alert nested inside an ordinary blockquote", async () => {
    const source = "> [!constructor]\n>\n> > [!NOTE]\n> > text";
    expect(JSON.stringify((await parse(source)).body)).toContain('"data-callout":"note"');
    const $ = load(await renderMarkdownPreview(source));
    expect($("blockquote [data-callout=note]")).toHaveLength(1);
  });
});
