import { h } from "hastscript";
import { VFile } from "vfile";
import { describe, expect, it, vi } from "vitest";

import embedCode from "../../../plugins/rehype-embed-code.ts";
import embed from "../../../plugins/rehype-embed.ts";
import sanitize from "../../../plugins/rehype-sanitize.ts";
import blockquote, { invalidTwitterRanges, withoutWidgets } from "../../../plugins/remark-embed-blockquote.ts";
import { safeFetch } from "../../../plugins/safe-fetch.ts";
import { stats } from "../../../plugins/warn.ts";

import type { Root } from "hast";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn().mockRejectedValue(new Error("offline")) }));

// 本番と同じ順（rehype-raw、埋め込みコード、sanitize、埋め込み）で Markdown を処理し、最終的な木を JSON にする
const render = async (markdown: string) => {
  const { parseMarkdown } = await import("@nuxtjs/mdc/runtime/parser/index");
  let output = "";
  const capture = () => (tree: Root) => {
    output = JSON.stringify(tree);
  };
  await parseMarkdown(
    markdown,
    {
      remark: { plugins: { blockquote: { instance: blockquote } } },
      rehype: {
        plugins: {
          "rehype-external-links": false,
          "rehype-raw": {},
          "embed-code": { instance: embedCode },
          sanitize: { instance: sanitize, options: { contents: "/contents" } },
          embed: { instance: embed, options: { contents: "/contents" } },
          capture: { instance: capture },
        },
      },
    },
    { fileOptions: { path: "/contents/author/post.md" } }
  );
  return output;
};

const sandbox = '"sandbox":["allow-scripts","allow-same-origin","allow-popups","allow-presentation"]';

describe("embed code", () => {
  it.each(["<!--", "<script>"])("ignores MDC attribute value %s when finding split quotes", async (value) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const prefix = `:icon{name="rocket" label="${value}"}\n\n`;
      const valid = await render(
        `${prefix}<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote>`
      );
      expect(valid).toContain('"tagName":"twitter-embed"');
      for (const ending of ["\n\n</blockquote>", ""]) {
        const html = await render(`${prefix}<blockquote>First\n\nhttps://youtu.be/inside${ending}`);
        expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      }
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it.each(["x.com", "twitter.com"])("converts a split %s quote with or without script", async (host) => {
    for (const script of ["", '<script async src="https://platform.x.com/widgets.js"></script>']) {
      const html = await render(
        `<blockquote class="twitter-tweet"><p>First line\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://${host}/user/status/123">date</a></blockquote>\n${script}`
      );
      expect(html).toContain('"tagName":"twitter-embed"');
      expect(html).toContain("twitter.com/user/status/123");
      expect(html).not.toContain("t.co/example");
    }
  });
  it.each([
    String.raw`\</p>\</blockquote>\<iframe src="https://www.youtube.com/embed/escaped"></iframe>`,
    '&lt;/p>&lt;/blockquote>&lt;iframe src="https://www.youtube.com/embed/escaped"></iframe>',
    '`</p></blockquote><iframe src="https://www.youtube.com/embed/escaped"></iframe>`',
    ":icon{label=\"</p></blockquote><iframe src='https://www.youtube.com/embed/escaped'></iframe>\"}",
  ])("does not activate Markdown content inside a split quote: %s", async (content) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        `<blockquote class="twitter-tweet"><p>First\n\n${content}\n\n</p>— Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote>`
      );
      expect(html).not.toContain('"tagName":"iframe"');
      expect(html).not.toContain("youtube-nocookie.com/embed/escaped");
      expect(html.includes('"tagName":"twitter-embed"') || warning.mock.calls.length > 0).toBe(true);
    } finally {
      warning.mockRestore();
    }
  });
  it("does not extract the post URL from a Markdown link", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        '<blockquote class="twitter-tweet"><p>First\n\ntext</p>— Name (@user) [date](https://x.com/user/status/123)</blockquote>'
      );
      expect(html).not.toContain('"tagName":"twitter-embed"');
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("processes consecutive split quotes", async () => {
    const quote = (id: string) =>
      `<blockquote class="twitter-tweet"><p>First\n\ntext</p>— Name (@user) <a href="https://x.com/user/status/${id}">date</a></blockquote>`;
    const html = await render(quote("1") + quote("2"));
    expect(html).toContain("twitter.com/user/status/1");
    expect(html).toContain("twitter.com/user/status/2");
    expect(html.match(/"tagName":"twitter-embed"/g)).toHaveLength(2);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const invalid = await render(`${quote("1")}<blockquote>first\n\nhttps://youtu.be/inside\n\n</blockquote>`);
      expect(invalid).not.toContain("youtube-nocookie.com/embed/inside");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("converts a split X quote immediately after a suppressed quote", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        '<blockquote>first\n\nhttps://youtu.be/inside\n\n</blockquote>\n<blockquote class="twitter-tweet"><p>First\n\ntext</p>— Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote>'
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      expect(html).toContain('"tagName":"twitter-embed"');
      expect(html).toContain("twitter.com/user/status/123");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("consumes the widgets.js script after an official X quote with blank lines in the body", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const before = stats.defects;
    try {
      const html = await render(
        '<blockquote class="twitter-tweet"><p lang="ja" dir="ltr">First line\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://x.com/user/status/123?ref_src=twsrc%5Etfw">November 4, 2026</a></blockquote>\n<script async src="https://platform.x.com/widgets.js" charset="utf-8"></script>\n\nAfter'
      );
      expect(html).toContain('"tagName":"twitter-embed"');
      expect(html).not.toContain("<script");
      expect(html).not.toContain('"tagName":"script"');
      expect(stats.defects).toBe(before);
      expect(warning).not.toHaveBeenCalled();
      // another script is kept for sanitize to remove and report
      const other = await render(
        '<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote>\n<script async src="https://example.com/other.js"></script>'
      );
      expect(other).not.toContain('"tagName":"script"');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("<script>"));
      expect(stats.defects).toBeGreaterThan(before);
    } finally {
      warning.mockRestore();
    }
  });
  // CodeQL（js/bad-tag-filter）が、一致しないと指摘した終了タグの書き方
  const endTags = ["</script>", "</script >", "</script foo>", "</script\nbar>", "</SCRIPT>"];
  it.each(endTags)("withoutWidgets removes the widgets.js script that ends with %j", (end) => {
    const widgets = `<script async src="https://platform.x.com/widgets.js" charset="utf-8">${end}`;
    expect(withoutWidgets(widgets)).toBe("");
    expect(withoutWidgets(`${widgets}after`)).toBe("after");
    // widgets.js 以外の script は、そのまま残して、sanitize に渡す
    const other = `<script async src="https://example.com/other.js">${end}`;
    expect(withoutWidgets(other)).toBe(other);
  });
  // 終了タグの属性値は、引用符で囲めば `>` を含められる（HTML のパーサーは、この `>` で終了タグを終えない）
  it.each([`</script foo=">">`, `</script foo='>'>`, `</script a="x>y" b='>'>`])(
    "withoutWidgets removes the whole end tag %j and keeps the text after it",
    (end) => {
      const widgets = `<script async src="https://platform.x.com/widgets.js">${end}`;
      expect(withoutWidgets(`${widgets}after`)).toBe("after");
      expect(withoutWidgets(widgets)).toBe("");
    }
  );
  it("withoutWidgets keeps a script whose end tag is not closed", () => {
    const widgets = `<script async src="https://platform.x.com/widgets.js"></script foo=">`;
    expect(withoutWidgets(widgets)).toBe(widgets);
  });
  // CommonMark の HTML ブロックは、`</script>` の行で終わる（`</script >` などでは終わらない）ため、
  // 後ろの本文まで同じ HTML ノードに入る。その場合は、script を取り除いた残りがあるので、公式のコードとして消費せず、
  // sanitize が取り除いて報告する（どの書き方でも、script は出力に残らない）
  it.each(endTags)("never keeps a widgets.js script that ends with %j", async (end) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        `<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote>\n<script async src="https://platform.x.com/widgets.js" charset="utf-8">${end}\n\nAfter`
      );
      expect(html).toContain('"tagName":"twitter-embed"');
      expect(html).not.toContain('"tagName":"script"');
      expect(html).toContain("After");
    } finally {
      warning.mockRestore();
    }
  });
  it("converts consecutive split X quotes, each followed by widgets.js", async () => {
    const quote = (id: number) =>
      `<blockquote class="twitter-tweet"><p>Post ${String(id)}\n\nhttps://t.co/example${String(id)}</p>&mdash; Name (@user) <a href="https://x.com/user/status/${String(id)}">date</a></blockquote>\n<script async src="https://platform.x.com/widgets.js" charset="utf-8"></script>`;
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(`${quote(1)}\n\n${quote(2)}\n\nAfter`);
      expect(html.match(/"tagName":"twitter-embed"/g)).toHaveLength(2);
      expect(html).toContain("status/1");
      expect(html).toContain("status/2");
      expect(html).not.toContain('"tagName":"blockquote"');
      expect(html).not.toContain('"tagName":"script"');
      expect(html).not.toContain("t.co/example");
    } finally {
      warning.mockRestore();
    }
  });
  it.each(["  ", "<div>", "<!-- preceding -->\n"])("converts a split X quote after %s", async (prefix) => {
    const suffix = prefix === "<div>" ? "</div>" : "";
    const html = await render(
      `${prefix}<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote>${suffix}`
    );
    expect(html).toContain('"tagName":"twitter-embed"');
    expect(html).not.toContain("t.co/example");
  });
  it.each(["  ", "<div>", "<!-- preceding -->\n"])("suppresses an unmatched quote after %s", async (prefix) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(`${prefix}<blockquote class="twitter-tweet"><p>First\n\nhttps://youtu.be/abc_123`);
      expect(html).not.toContain("youtube-nocookie.com/embed/abc_123");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it.each(["", ' class="other"', ' class="twitter-tweet"'])("suppresses split quotes with%s", async (attributes) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        `<blockquote${attributes}>First\n\nhttps://youtu.be/inside\n\n<iframe src="https://www.youtube.com/embed/iframe"></iframe>\n\n</blockquote>\n\nhttps://youtu.be/outside`
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      expect(html).not.toContain("youtube-nocookie.com/embed/iframe");
      expect(html).toContain("youtube-nocookie.com/embed/outside");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it.each(["<!-- comment -->", "<div>after</div>"])("preserves HTML following a split X quote: %s", async (suffix) => {
    const html = await render(
      `<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote>${suffix}`
    );
    expect(html).toContain('"tagName":"twitter-embed"');
    if (suffix.startsWith("<div>")) expect(html).toContain("after");
  });
  it("suppresses a split quote starting in an inline HTML node", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        "before <blockquote>first\n\nhttps://youtu.be/inside\n\n</blockquote>\n\nhttps://youtu.be/outside"
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      expect(html).toContain("youtube-nocookie.com/embed/outside");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("restores an X quote following inline text", async () => {
    const html = await render(
      'before <blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote>'
    );
    expect(html).toContain("before");
    expect(html).toContain('"tagName":"twitter-embed"');
  });
  it("ends an unmatched quote at the enclosing HTML element", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        "<div>\n\n<blockquote>first\n\nhttps://youtu.be/inside\n\n</div>\n\nhttps://youtu.be/outside"
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      expect(html).toContain("youtube-nocookie.com/embed/outside");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it.each(["trailing **important**", "trailing `code`"])(
    "preserves Markdown following a split X quote: %s",
    async (suffix) => {
      const html = await render(
        `<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote> ${suffix}`
      );
      expect(html).toContain('"tagName":"twitter-embed"');
      expect(html).toContain("trailing");
      expect(html).toContain(suffix.includes("**") ? '"tagName":"strong"' : '"tagName":"code"');
    }
  );
  it.each(["script>", "!--"])("ignores escaped HTML before a split quote: %s", async (tag) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        `\\<${tag}\n\n<blockquote>first\n\nhttps://youtu.be/inside\n\n</blockquote>\n\nhttps://youtu.be/outside`
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      expect(html).toContain("youtube-nocookie.com/embed/outside");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("ignores a closing tag in a Markdown link title", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        '<blockquote>hi\n\n[label](https://example.com "</blockquote>")\n\nhttps://youtu.be/inside\n\n</blockquote>\n\nhttps://youtu.be/outside'
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      expect(html).toContain("youtube-nocookie.com/embed/outside");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("ends an unmatched quote at an implicitly closed parent", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        "<section><div><blockquote>first\n\nhttps://youtu.be/inside\n\n</section>\n\nhttps://youtu.be/outside"
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      expect(html).toContain("youtube-nocookie.com/embed/outside");
    } finally {
      warning.mockRestore();
    }
  });
  it("converts a split quote inside details", async () => {
    const html = await render(
      '<details>\n<summary>Example</summary>\n\n<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example</p>&mdash; Name (@user) <a href="https://x.com/user/status/123">date</a></blockquote>\n\n</details>'
    );
    expect(html).toContain('"tagName":"twitter-embed"');
    expect(html).not.toContain("t.co/example");
  });
  it("does not turn an unmatched X quote into embeds", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render('<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example');
      expect(html).not.toContain("twitter-embed");
      expect(safeFetch).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("keeps unrelated formatting after an unmatched quote", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        '<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example\n\nhttps://www.youtube.com/watch?v=abc_123\n\n## Next\n\n**Important** [reference](https://example.com)'
      );
      expect(html).toContain('"tagName":"strong"');
      expect(html).toContain("https://example.com");
      expect(html).not.toContain("youtube-nocookie.com/embed/abc_123");
    } finally {
      warning.mockRestore();
    }
  });
  it("suppresses every embed inside an oversized X quote and resumes after it", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        `<blockquote class="twitter-tweet"><p>First\n\nhttps://t.co/example\n\nhttps://youtu.be/abc_123\n\n<iframe src="https://www.youtube.com/embed/inside"></iframe>\n\n${"x".repeat(10_001)}\n\n</blockquote>\n\nhttps://youtu.be/outside`
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/abc_123");
      expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      expect(html).toContain("youtube-nocookie.com/embed/outside");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("inherits the position of a rejected quote for generated paragraphs", async () => {
    const file = new VFile({ path: "/contents/author/post.md" });
    invalidTwitterRanges.set(file, [[10, 100]]);
    const quote = h("blockquote", [h("iframe", { src: "https://www.youtube.com/embed/abc_123" })]);
    quote.position = { start: { line: 1, column: 1, offset: 10 }, end: { line: 1, column: 90, offset: 99 } };
    const tree: Root = { type: "root", children: [quote] };
    embedCode()(tree, file);
    await embed()(tree, file);
    expect(JSON.stringify(tree)).not.toContain("youtube-nocookie.com/embed/abc_123");
  });
  it("suppresses embeds after a nested blockquote inside a rejected X quote", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        '<blockquote class="twitter-tweet"><p>first\n\n<blockquote>nested</blockquote>\n\nhttps://youtu.be/abc_123\n\n</blockquote>'
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/abc_123");
    } finally {
      warning.mockRestore();
    }
  });
  it.each(["<!-- </blockquote> -->", '<span title="</blockquote>">text</span>'])(
    "ignores a fake closing tag in %s when rejecting a quote",
    async (fake) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      try {
        const html = await render(
          `<blockquote class="twitter-tweet"><p>first\n\n${fake}\n\n<blockquote>nested</blockquote>\n\nhttps://youtu.be/abc_123\n\n</p></blockquote>\n\nhttps://youtu.be/outside`
        );
        expect(html).not.toContain("youtube-nocookie.com/embed/abc_123");
        expect(html).toContain("youtube-nocookie.com/embed/outside");
        expect(warning).toHaveBeenCalled();
      } finally {
        warning.mockRestore();
      }
    }
  );
  it("ignores a closing tag in a code fence when suppressing an unmatched quote", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        '<blockquote class="twitter-tweet"><p>first\n\n```html\n</blockquote>\n```\n\nhttps://youtu.be/abc_123'
      );
      expect(html).not.toContain("youtube-nocookie.com/embed/abc_123");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("preserves fenced code and suppresses embeds inside a closed X quote", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const html = await render(
        '<blockquote class="twitter-tweet"><p>first\n\n```html\n</blockquote>\n<iframe src="https://www.youtube.com/embed/inside"></iframe>\n```\n\nhttps://youtu.be/inside-link\n\n</p></blockquote>\n\nhttps://youtu.be/outside'
      );
      expect(html).toContain('"tagName":"code"');
      expect(html).toContain('<iframe src=\\"https://www.youtube.com/embed/inside\\"></iframe>');
      expect(html).not.toContain("youtube-nocookie.com/embed/inside");
      expect(html).toContain("youtube-nocookie.com/embed/outside");
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("分割された引用内の埋め込みを無視しました"));
    } finally {
      warning.mockRestore();
    }
  });
  it("warns about an invalid Google Slides iframe", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(
        await render('<iframe src="https://docs.google.com/presentation/d/e/abc/pubembed"></iframe>')
      ).not.toContain("iframe");
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("公開 ID"));
    } finally {
      warning.mockRestore();
    }
  });
  it("uses the dimensions in a Canva iframe", async () => {
    const html = await render(
      '<iframe src="https://www.canva.com/design/DACHZTlgWkU/view?embed" width="600" height="900"></iframe>'
    );
    expect(html).toContain("aspect-ratio: 0.6667 / 1");
  });
  it("uses the padding ratio in a Canva wrapper", async () => {
    const html = await render(
      '<div style="position: relative; padding-top: 150%;"><iframe src="https://www.canva.com/design/DACHZTlgWkU/view?embed"></iframe></div>'
    );
    expect(html).toContain("aspect-ratio: 0.6667 / 1");
  });
  it("converts official Canva oEmbed code", async () => {
    const html = await render(
      '<iframe src="https://www.canva.com/design/DACHZTlgWkU/view?embed&amp;meta" height="1080" width="1920" style="border: none; border-radius: 8px; width: 1920px; height: 1080px;" allowfullscreen="allowfullscreen" allow="fullscreen"></iframe>'
    );
    expect(html).toContain("www.canva.com/design/DACHZTlgWkU/view?embed");
  });
  it("converts official youtube oEmbed code", async () => {
    const html = await render(
      '<iframe width="200" height="113" src="https://www.youtube.com/embed/SX_ViT4Ra7k?feature=oembed" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen title="米津玄師  Kenshi Yonezu  - Lemon"></iframe>'
    );
    expect(html).toContain("youtube-nocookie.com/embed/SX_ViT4Ra7k");
  });
  it("converts official x oEmbed code", async () => {
    const html = await render(
      '<blockquote class="twitter-tweet"><p lang="ja" dir="ltr">Lemon10億再生ありがとうございます。推敲するだけの十分な時間がなく、読み返せばおよそめでたくもないクソ雑な文章になってしまっているので、これまでに聴いてくれた皆への感謝をせめて追記させてください。本当にありがとう！これからもLemonをよろしくお願いします。<a href="https://t.co/zUmBtRgiCL">https://t.co/zUmBtRgiCL</a> <a href="https://t.co/B7qsJRWgga">https://t.co/B7qsJRWgga</a></p>&mdash; 米津玄師　ハチ (@hachi_08) <a href="https://x.com/hachi_08/status/2117795304166789490?ref_src=twsrc%5Etfw">November 4, 2026</a></blockquote>\n<script async src="https://platform.x.com/widgets.js" charset="utf-8"></script>'
    );
    expect(html).toContain("twitter-embed");
  });
  it("converts official speaker oEmbed code", async () => {
    const html = await render(
      '<iframe id="talk_frame_14897" class="speakerdeck-iframe" src="https://speakerdeck.com/player/50021f75cf1db900020005e7" width="710" height="532" style="aspect-ratio:710/532; border:0; padding:0; margin:0; background:transparent;" frameborder="0" allowtransparency="true" allowfullscreen="allowfullscreen"></iframe>'
    );
    expect(html).toContain("speakerdeck.com/player/50021f75cf1db900020005e7");
    expect(html).toContain("aspect-ratio: 1.3346 / 1");
  });
  it("converts official spotify-track oEmbed code", async () => {
    const html = await render(
      '<iframe style="border-radius: 12px" width="100%" height="152" title="Spotify Embed: Lemon" frameborder="0" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" src="https://open.spotify.com/embed/track/04TshWXkhV1qkqHzf31Hn6?utm_source=oembed"></iframe>'
    );
    expect(html).toContain("open.spotify.com/embed/track/04TshWXkhV1qkqHzf31Hn6");
  });
  it("converts official spotify-album oEmbed code", async () => {
    const html = await render(
      '<iframe style="border-radius: 12px" width="100%" height="352" title="Spotify Embed: STRAY SHEEP" frameborder="0" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" src="https://open.spotify.com/embed/album/052EiTRYh35MuDVJN9Emdh?utm_source=oembed"></iframe>'
    );
    expect(html).toContain("open.spotify.com/embed/album/052EiTRYh35MuDVJN9Emdh");
  });

  it("converts a YouTube iframe", async () => {
    const html = await render(
      '<iframe width="560" height="315" src="https://www.youtube.com/embed/SX_ViT4Ra7k?si=abc" title="x" frameborder="0" allowfullscreen onload="evil()" style="position:fixed"></iframe>'
    );
    expect(html).toContain('"src":"https://www.youtube-nocookie.com/embed/SX_ViT4Ra7k"');
    expect(html).toContain(sandbox);
    expect(html).not.toMatch(/evil|position:fixed|frameborder|width="560"/);
    expect(await render('<iframe src="https://www.youtube-nocookie.com/embed/abc_1"></iframe>')).toContain(
      "youtube-nocookie.com/embed/abc_1"
    );
  });
  it("converts a Speaker Deck iframe with its ratio", async () => {
    const id = "a".repeat(32);
    const html = await render(
      `<iframe class="speakerdeck-iframe" frameborder="0" src="https://speakerdeck.com/player/${id}" title="t" allowfullscreen="true" style="border: 0px; aspect-ratio: 9 / 1;" data-ratio="1.7777777777777777"></iframe>`
    );
    expect(html).toContain(`"src":"https://speakerdeck.com/player/${id}"`);
    expect(html).toContain("aspect-ratio: 1.7778 / 1");
    expect(html).not.toContain("9 / 1");
    expect(safeFetch).not.toHaveBeenCalled();
  });
  it.each(["//speakerdeck.com/assets/embed.js", "https://speakerdeck.com/assets/embed.js"])(
    "converts a Speaker Deck script from %s",
    async (src) => {
      const html = await render(
        `<script defer class="speakerdeck-embed" data-id="50021f75cf1db900020005e7" data-ratio="1.3345864661654134" src="${src}"></script>`
      );
      expect(html).toContain('"src":"https://speakerdeck.com/player/50021f75cf1db900020005e7"');
      expect(html).toContain("aspect-ratio: 1.3346 / 1");
      expect(html).not.toContain("speakerdeck-embed");
    }
  );
  it("ignores an invalid Speaker Deck script ratio", async () => {
    const html = await render(
      '<script class="speakerdeck-embed" data-id="50021f75cf1db900020005e7" data-ratio="1;background:url(x)" src="//speakerdeck.com/assets/embed.js"></script>'
    );
    expect(html).toContain("aspect-ratio: 16 / 9");
    expect(html).not.toContain("background");
  });
  it("ignores an invalid ratio", async () => {
    const id = "b".repeat(32);
    const html = await render(
      `<iframe class="speakerdeck-iframe" src="https://speakerdeck.com/player/${id}" data-ratio="1;background:url(x)"></iframe>`
    );
    expect(html).toContain("aspect-ratio: 16 / 9");
    expect(html).not.toContain("background");
  });
  it("converts a Docswell script and its link div", async () => {
    const html = await render(
      '<script async class="docswell-embed" src="https://www.docswell.com/assets/libs/docswell-embed/docswell-embed.min.js" data-src="https://www.docswell.com/slide/LK7J5V/embed" data-aspect="0.5625"></script><div class="docswell-link"><a href="https://www.docswell.com/s/ku-suke/LK7J5V-hello-docswell">Docswell（ドクセル）はじめました by @ku-suke</a></div>'
    );
    expect(html).toContain('"src":"https://www.docswell.com/slide/LK7J5V/embed"');
    expect(html).toContain("aspect-ratio: 1.7778 / 1");
    expect(html).not.toMatch(/"tagName":"script"|docswell-link|ドクセル/);
  });
  it("preserves unrelated Docswell descriptions", async () => {
    const script =
      '<script class="docswell-embed" src="https://www.docswell.com/assets/libs/docswell-embed/docswell-embed.min.js" data-src="https://www.docswell.com/slide/LK7J5V/embed"></script>';
    const other = '<div>補足説明 <a href="https://www.docswell.com/s/other/OTHER">別のスライド</a></div>';
    expect(await render(`${script}\n${other}`)).toMatch(/補足説明.*別のスライド/);
    const mismatched =
      '<div class="docswell-link"><a href="https://www.docswell.com/s/other/OTHER">Other</a> by <a href="https://www.docswell.com/user/other">Author</a></div>';
    expect(await render(`${script}\n${mismatched}`)).toMatch(/Other.*Author/);
    const mismatchedSingle =
      '<div class="docswell-link"><a href="https://www.docswell.com/s/other/OTHER">Other</a></div>';
    expect(await render(`${script}\n${mismatchedSingle}`)).toContain("Other");
    const extraSingle =
      '<div class="docswell-link"><a href="https://www.docswell.com/s/u/LK7J5V-title">Title</a> Extra</div>';
    expect(await render(`${script}\n${extraSingle}`)).toContain("Extra");
    const encoded =
      '<div class="docswell-link"><a href="https://www.docswell.com/s/u/LK7J5V-%E6%97%A5%E6%9C%AC">日本語</a></div>';
    expect(await render(`${script}\n${encoded}`)).not.toContain("日本語");
    const extra =
      '<div class="docswell-link"><a href="https://www.docswell.com/s/u/LK7J5V-title">Title</a> by <a href="https://www.docswell.com/user/u">Author</a> Extra</div>';
    expect(await render(`${script}\n${extra}`)).toContain("Extra");
  });
  it("removes unsupported playlist iframe and keeps a video with a list parameter", async () => {
    const path = "video" + "series";
    expect(await render(`<iframe src="https://www.youtube.com/embed/${path}?list=PLabc"></iframe>`)).not.toContain(
      "embed-frame"
    );
    expect(await render("https://www.youtube.com/watch?v=abc_123&list=PLabc")).toContain(
      "youtube-nocookie.com/embed/abc_123"
    );
  });
  it("converts a Google Slides iframe", async () => {
    const html = await render(
      '<iframe src="https://docs.google.com/presentation/d/e/2PACX-1vABC_def/embed?start=false&loop=false&delayms=3000" frameborder="0" width="960" height="569" allowfullscreen="true" mozallowfullscreen="true"></iframe>'
    );
    expect(html).toContain('"src":"https://docs.google.com/presentation/d/e/2PACX-1vABC_def/pubembed"');
    expect(html).toContain(sandbox);
  });
  it("converts a shared Google Slides iframe", async () => {
    const html = await render('<iframe src="https://docs.google.com/presentation/d/abc/embed?start=false"></iframe>');
    expect(html).toContain('"src":"https://docs.google.com/presentation/d/abc/embed"');
  });

  it("converts a published Google Slides iframe", async () => {
    const html = await render(
      '<iframe src="https://docs.google.com/presentation/d/e/2PACX-1vABC_def/pubembed?start=false"></iframe>'
    );
    expect(html).toContain('"src":"https://docs.google.com/presentation/d/e/2PACX-1vABC_def/pubembed"');
  });
  it("converts a Canva wrapper div and its description", async () => {
    const html = await render(
      '<div style="position: relative; width: 100%; height: 0; padding-top: 56.25%;"><iframe loading="lazy" style="position: absolute; inset: 0" src="https://www.canva.com/design/DAF1/tok_en-1/view?embed" allowfullscreen="allowfullscreen" allow="fullscreen"></iframe></div>\n<a href="https://www.canva.com/design/DAF1/tok_en-1/view?utm_content=DAF1" target="_blank" rel="noopener">Title</a> by Someone'
    );
    expect(html).toContain('"src":"https://www.canva.com/design/DAF1/tok_en-1/view?embed"');
    expect(html).toMatch(/Title.*Someone/);
    expect(html).not.toMatch(/position: absolute|padding-top/);
  });
  it("preserves unrelated Canva links after an embed or description", async () => {
    const frame = '<iframe src="https://www.canva.com/design/DAF1/token/view?embed"></iframe>';
    const other = '<a href="https://www.canva.com/design/OTHER/token/view">Other design</a>';
    const another = '<a href="https://www.canva.com/design/ANOTHER/view">Another design</a>';
    const first = await render(`${frame}\n${other}\n${another}`);
    expect(first).toContain("Other design");
    expect(first).toContain("Another design");
    const description = '<a href="https://www.canva.com/design/DAF1/token/view?share=1">Description</a>';
    const second = await render(`${frame}\n${description}\n${other}`);
    expect(second).toContain("Description");
    expect(second).toContain("Other design");
    const byOther = await render(`${frame}\n${description} by ${other}`);
    expect(byOther).toContain("Other design");
    const normalized = await render(
      `${frame}\n${description} by <a href="https://www.canva.com/foo/../design/OTHER/view">Other normalized</a>`
    );
    expect(normalized).toContain("Other normalized");
    const pricing = await render(`${frame}\n${description} by <a href="https://www.canva.com/pricing">Pricing</a>`);
    expect(pricing).toContain("Pricing");
    const author = await render(`${frame}\n${description} by <a href="https://www.canva.com/p/person">Author</a>`);
    expect(author).not.toContain("Author");
    const wrongToken = await render(`${frame}\n<a href="https://www.canva.com/design/DAF1/other/view">Wrong token</a>`);
    expect(wrongToken).toContain("Wrong token");
  });
  it("preserves Canva author text mixed with unrelated text", async () => {
    const frame = '<iframe src="https://www.canva.com/design/DAF1/token/view?embed"></iframe>';
    const description = '<a href="https://www.canva.com/design/DAF1/token/view">Description</a>';
    const html = await render(
      `${frame}\n${description} by Alice. Unrelated text <a href="https://www.canva.com/p/alice">Profile</a>`
    );
    expect(html).toContain("Alice. Unrelated text");
    expect(html).toContain("Profile");
  });
  it("converts CodePen embeds", async () => {
    const html = await render(
      '<p class="codepen" data-height="300" data-default-tab="result" data-slug-hash="PNaGbb" data-user="codepen" style="height: 300px; border: 2px solid; padding: 1em;"><span>See the Pen <a href="https://codepen.io/codepen/pen/PNaGbb">Title</a> by X (<a href="https://codepen.io/codepen">@codepen</a>) on <a href="https://codepen.io">CodePen</a>.</span></p>\n<script async src="https://cpwebassets.codepen.io/assets/embed/ei.js"></script>'
    );
    expect(html).toContain('"src":"https://codepen.io/codepen/embed/PNaGbb?default-tab=result"');
    expect(html).toContain("embed-codepen");
    expect(html).not.toMatch(/"tagName":"script"|See the Pen|padding/);
    const iframe = await render(
      '<iframe height="300" style="width: 100%;" scrolling="no" title="T" src="https://codepen.io/user-1/embed/AbC123?default-tab=html%2Cresult" frameborder="no" loading="lazy" allowtransparency="true" allowfullscreen="true"></iframe>'
    );
    expect(iframe).toContain('"src":"https://codepen.io/user-1/embed/AbC123?default-tab=result"');
  });
  it("converts CodePen editor URLs and embeds with UUIDs", async () => {
    const id = "0199bfac-1c24-78b0-8124-973bee74df24";
    const expected = `"src":"https://codepen.io/editor/anon/embed/${id}?default-tab=result"`;
    expect(await render(`https://codepen.io/editor/team/codepen/pen/${id}`)).toContain(expected);
    expect(await render(`<iframe src="https://codepen.io/editor/anon/embed/${id}?height=450"></iframe>`)).toContain(
      expected
    );
    expect(await render(`<iframe src="//codepen.io/editor/anon/embed/${id}"></iframe>`)).toContain(expected);
    expect(await render(`<p class="codepen" data-slug-hash="${id}" data-user="codepen"></p>`)).toContain(expected);
    expect(await render(`https://codepen.io/codepen/pen/${id}`)).toContain(expected);
  });
  it("converts a CodeSandbox iframe without the author's sandbox and allow", async () => {
    const html = await render(
      '<iframe src="https://codesandbox.io/embed/my-app-x1y2z3?fontsize=14&theme=dark" style="width:100%;height:500px" title="t" allow="camera; microphone" sandbox="allow-top-navigation allow-forms"></iframe>'
    );
    expect(html).toContain('"src":"https://codesandbox.io/embed/my-app-x1y2z3"');
    expect(html).toContain(sandbox);
    expect(html).not.toMatch(/camera|allow-top-navigation|allow-forms|500px/);
    expect(
      await render('<iframe src="https://codesandbox.io/p/sandbox/react-example-123?file=/src/index.js"></iframe>')
    ).toContain('"src":"https://codesandbox.io/embed/react-example-123"');
    expect(await render("https://codesandbox.io/p/devbox/abc-123")).toContain(
      '"src":"https://codesandbox.io/embed/abc-123"'
    );
  });
  it("converts a Spotify iframe to a fixed-height frame with only encrypted-media allowed", async () => {
    const html = await render(
      '<iframe data-testid="embed-iframe" style="border-radius:12px;position:fixed" src="https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=generator" width="100%" height="352" allow="autoplay; camera; encrypted-media" sandbox="allow-top-navigation"></iframe>'
    );
    expect(html).toContain('"src":"https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M"');
    expect(html).toContain('"style":"height: 352px"');
    expect(html).toContain('"allow":"encrypted-media; fullscreen"');
    expect(html).toContain(sandbox);
    expect(html).not.toMatch(/camera|autoplay|position:fixed|allow-top-navigation|utm_source/);
    expect(
      await render('<iframe src="https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC"></iframe>')
    ).toContain('"style":"height: 152px"');
  });
  it("converts an Apple Music iframe and keeps the track ID", async () => {
    const html = await render(
      '<iframe allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" frameborder="0" height="450" style="width:100%;max-width:660px;overflow:hidden;" sandbox="allow-top-navigation allow-forms" src="https://embed.music.apple.com/jp/album/some-album/1234567890?i=1234567891&l=en"></iframe>'
    );
    expect(html).toContain('"src":"https://embed.music.apple.com/jp/album/some-album/1234567890?i=1234567891"');
    expect(html).toContain('"style":"height: 175px"');
    expect(html).not.toMatch(/allow-top-navigation|allow-forms|660px|autoplay|l=en/);
    expect(await render('<iframe src="https://embed.music.apple.com/jp/playlist/x/pl.abc123"></iframe>')).toContain(
      '"style":"height: 450px"'
    );
    expect(await render('<iframe src="https://embed.music.apple.com/jp/playlist/x/pl.u-abc123"></iframe>')).toContain(
      "embed.music.apple.com/jp/playlist/x/pl.u-abc123"
    );
  });
  it("preserves commentary around an X post link", async () => {
    const html = await render(
      '<blockquote class="twitter-tweet"><p>Comment <a href="https://x.com/u/status/1">linked post</a></p>Extra commentary</blockquote>'
    );
    expect(html).toContain("Extra commentary");
    expect(html).toContain("linked post");
  });
  it("preserves commentary after X attribution", async () => {
    const html = await render(
      '<blockquote class="twitter-tweet"><p>hello</p>— Name (@user) Important commentary <a href="https://twitter.com/user/status/123">date</a></blockquote>'
    );
    expect(html).toContain("Important commentary");
  });
  it("converts an X post and its widgets script", async () => {
    const html = await render(
      '<blockquote class="twitter-tweet"><p lang="ja" dir="ltr">hello</p>&mdash; Name (@user) <a href="https://twitter.com/user/status/1234567890?ref_src=twsrc%5Etfw">May 1, 2026</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>'
    );
    expect(html).toContain('"tagName":"twitter-embed"');
    expect(html).toContain("https://twitter.com/user/status/1234567890");
    expect(html).not.toMatch(/"tagName":"script"|hello|ref_src/);
  });
  it("handles embed code inside a paragraph without nesting", async () => {
    const html = await render(`<p><iframe src="https://www.youtube.com/embed/abc"></iframe></p>`);
    expect(html).not.toMatch(/"tagName":"p"[^[]*\[\{"type":"element","tagName":"div"/);
    expect(html).toContain("youtube-nocookie.com/embed/abc");
  });
});

describe("embed code in details", () => {
  const codes = [
    '<iframe src="https://www.youtube.com/embed/abc_123"></iframe>',
    '<p class="codepen" data-slug-hash="PNaGbb" data-user="codepen"><span>See</span></p>\n<script async src="https://cpwebassets.codepen.io/assets/embed/ei.js"></script>',
  ];
  it("converts embed code directly under details and under nested details, and keeps code blocks as text", async () => {
    const html = await render(
      `<details>\n<summary>例</summary>\n\n${codes[0] ?? ""}\n\n${codes[1] ?? ""}\n\nhttps://youtu.be/xyz_789\n\n<details>\n<summary>記法</summary>\n\n${codes[0] ?? ""}\n\n<iframe src="https://evil.example/x"></iframe>\n\n\`\`\`html\n${codes[0] ?? ""}\n${(codes[1] ?? "").split("\n")[1] ?? ""}\n\`\`\`\n\n</details>\n\n</details>`
    );
    expect(html).toContain('"src":"https://www.youtube-nocookie.com/embed/abc_123"');
    expect(html).toContain('"src":"https://codepen.io/codepen/embed/PNaGbb?default-tab=result"');
    expect(html).toContain('"src":"https://www.youtube-nocookie.com/embed/xyz_789"');
    expect(html).not.toContain("evil.example");
    // コードブロックは、変換されずに文字列のまま残る
    expect(html).toContain('"code":"<iframe src=\\"https://www.youtube.com/embed/abc_123\\"></iframe>');
    expect(html.match(/"tagName":"iframe"/g)).toHaveLength(4);
  });
});

describe("unrecognized embed code", () => {
  it.each([
    '<iframe src="https://evil.example/embed/abc"></iframe>',
    '<iframe src="https://www.youtube.com.evil.example/embed/abc"></iframe>',
    '<iframe src="https://www.youtube.com/embed/abc$%22onload=evil"></iframe>',
    '<iframe src="https://codesandbox.io/embed/new?x=1"></iframe>',
    '<iframe src="https://codesandbox.io.evil.example/embed/abc"></iframe>',
    '<iframe src="https://codesandbox.io/embed/a%22b"></iframe>',
    '<iframe src="https://open.spotify.com.evil.example/embed/track/4uLU6hMCjMI75M1A2tKUQC"></iframe>',
    '<iframe src="https://open.spotify.com/embed/user/4uLU6hMCjMI75M1A2tKUQC"></iframe>',
    '<iframe src="https://open.spotify.com/embed/track/a%22b"></iframe>',
    '<iframe src="https://embed.music.apple.com.evil.example/jp/album/x/1"></iframe>',
    '<iframe src="https://embed.music.apple.com/jp/artist/x/1"></iframe>',
    '<iframe src="https://embed.music.apple.com/jp/album/x/12%22abc"></iframe>',
    '<iframe src="javascript:evil()"></iframe>',
    '<iframe class="speakerdeck-iframe" src="https://speakerdeck.com/player/xyz"></iframe>',
    '<iframe class="speakerdeck-iframe" src="https://evil.example/player/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"></iframe>',
    '<iframe src="https://docs.google.com/presentation/d/e/a%22b/embed"></iframe>',
    '<iframe src="https://www.canva.com.evil.example/design/a/b/view?embed"></iframe>',
    '<iframe src="https://codepen.io/user/embed/a<b"></iframe>',
    '<script async class="docswell-embed" src="https://evil.example/x.js" data-src="https://www.docswell.com/slide/ABC/embed"></script>',
    '<script async class="docswell-embed" src="https://bcdn.docswell.com/x.js" data-src="https://evil.example/slide/ABC/embed"></script>',
    '<script src="https://platform.twitter.com/widgets.js"></script>',
    '<script src="https://evil.example/x.js"></script>',
    '<p class="codepen" data-slug-hash="a&quot; onclick=evil" data-user="u"></p>',
  ])("removes %s", async (code) => {
    const html = await render(code);
    expect(html).not.toMatch(/"tagName":"(?:iframe|script|twitter-embed)"|evil|onclick|embed-frame/);
  });
  it("does not use a script after a non-matching embed", async () => {
    const html = await render(
      '<blockquote class="twitter-tweet"><a href="https://evil.example/u/status/1">x</a></blockquote><script src="https://platform.twitter.com/widgets.js"></script>'
    );
    expect(html).not.toContain('"tagName":"script"');
  });
});
