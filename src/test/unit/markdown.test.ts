import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { load } from "cheerio";
import { h } from "hastscript";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import sharp from "sharp";
import { unified } from "unified";
import { VFile } from "vfile";
import { describe, expect, it, vi } from "vitest";

import * as imageCheck from "../../../plugins/image-check.ts";
import embed from "../../../plugins/rehype-embed.ts";
import compat from "../../../plugins/rehype-mdc-compat.ts";
import toolbar from "../../../plugins/rehype-mermaid-toolbar.ts";
import sanitize from "../../../plugins/rehype-sanitize.ts";
import svgAttributes from "../../../plugins/rehype-svg-attributes.ts";
import assetImages from "../../../plugins/remark-asset-images.ts";
import postMeta from "../../../plugins/remark-post-meta.ts";
import { safeFetch } from "../../../plugins/safe-fetch.ts";
import { child, isElement } from "../hast.ts";

import type { Element, Root } from "hast";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn().mockRejectedValue(new Error("offline")) }));

const root = (...children: Element[]): Root => ({ type: "root", children });
const link = (url: string, text = url) => h("a", { href: url }, text);

describe("sanitization", () => {
  it("renders all email link forms as text", async () => {
    const source = "foo@example.com <foo@example.com> [text](mailto:foo@example.com)";
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
    const tree = processor.runSync(processor.parse(source));
    const result = await sanitize({ contents: "/contents" })(tree, new VFile({ value: source, path: "post.md" }));
    const paragraph = child(result, 0);
    expect(paragraph.children.every((node) => node.type === "text")).toBe(true);
    expect(paragraph.children.map((node) => (node.type === "text" ? node.value : "")).join("")).toBe(
      "foo@example.com foo@example.com text"
    );
  });
  it("enforces the article length limit", async () => {
    await expect(
      sanitize({ contents: "/contents" })(root(), new VFile({ value: "a".repeat(500_000), path: "post.md" }))
    ).resolves.toBeDefined();
    await expect(
      sanitize({ contents: "/contents" })(root(), new VFile({ value: "a".repeat(500_001), path: "post.md" }))
    ).rejects.toThrow(/記事が大きすぎます/);
  });
  it("strips dangerous markup and attributes while preserving safe content", async () => {
    const tree = root(
      ...["data:text/html,evil", "vbscript:evil", "JaVa\tScript:evil", " javascript:evil"].map((href) =>
        h("a", { href }, "bad")
      ),
      h("a", { href: load('<a href="java&#x73;cript:evil">bad</a>')("a").attr("href") }, "bad"),
      h("iframe", { src: "https://example.com" }),
      h("form", [h("input")]),
      h("svg", [h("script", "evil")]),
      h("p", { style: "color:red" }, "plain"),
      h("script", "evil"),
      h("style", "evil"),
      h("custom-widget", "component"),
      h("mark", { id: "document", onclick: "evil" }, "safe"),
      h("a", { href: "javascript:evil" }, "bad"),
      h("a", { href: "mailto:a@example.com" }, "mail"),
      h("a", { href: "https://example.com", name: "anchor" }, "good"),
      h("a", { id: "anchor-id" }),
      h("pre", { code: "paste attack" }, [h("code", "displayed")]),
      h("details", [h("summary", "Summary"), h("p", "body")])
    );
    const result = await sanitize({ contents: "/contents" })(tree, new VFile({ value: "", path: "post.md" }));
    expect(JSON.stringify(result)).not.toMatch(/evil|custom-widget|paste attack|onclick|mailto/);
    expect(JSON.stringify(result)).toContain("user-content-document");
    expect(JSON.stringify(result)).toContain("user-content-anchor");
    const pre = result.children.filter(isElement).find((node) => node.tagName === "pre");
    assert.ok(pre);
    expect(pre.properties.code).toBe("displayed");
    expect(JSON.stringify(result)).toContain("summary");
    expect(JSON.stringify(result)).not.toMatch(/iframe|form|svg|style/);
    expect(result.children.filter(isElement).filter((node) => node.tagName === "a")).toHaveLength(2);
    expect(JSON.stringify(result)).toContain("user-content-anchor-id");
  });
});

describe("embeds", () => {
  it("replaces link-only paragraphs with sandboxed provider frames and preserves text paragraphs", async () => {
    const tree = root(
      h("p", [link("https://youtu.be/abc_123")]),
      h("p", ["watch ", link("https://youtu.be/xyz")]),
      h("p", [link("https://evil.example/video")])
    );
    await embed()(tree, new VFile({ path: "test.md" }));
    expect(child(child(tree, 0), 0).properties).toMatchObject({
      src: "https://www.youtube-nocookie.com/embed/abc_123",
      sandbox: ["allow-scripts", "allow-same-origin", "allow-popups", "allow-presentation"],
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    expect(child(tree, 1).tagName).toBe("p");
    expect(child(child(tree, 2), 0).tagName).toBe("iframe");
    expect(child(tree, 3).tagName).toBe("p");
  });
  it("limits external fetches without counting frames", async () => {
    vi.mocked(safeFetch).mockClear();
    const tree = root(
      ...Array.from({ length: 51 }, (_, index) => h("p", [link(`https://youtu.be/id${String(index)}`)])),
      ...Array.from({ length: 51 }, (_, index) =>
        h("p", [link(`https://github.com/user/repo/blob/main/file${String(index)}`)])
      )
    );
    await embed()(tree, new VFile({ path: "test.md" }));
    expect(tree.children.filter(isElement).filter((node) => node.tagName === "div")).toHaveLength(51);
    expect(safeFetch).toHaveBeenCalledTimes(50);
    expect(tree.children.at(-1)).toMatchObject({ tagName: "p" });
  });
  it("leaves the fetch budget for a link card after frames", async () => {
    vi.mocked(safeFetch).mockClear();
    const tree = root(
      ...Array.from({ length: 51 }, (_, index) => h("p", [link(`https://youtu.be/id${String(index)}`)])),
      h("p", [link("https://example.com/article")])
    );
    await embed()(tree, new VFile({ path: "test.md" }));
    expect(safeFetch).toHaveBeenCalledWith("https://example.com/article", expect.anything());
  });
});

it("calculates reading time and excerpts from body paragraphs", async () => {
  const processor = unified().use(remarkParse).use(postMeta);
  const file = new VFile();
  const context: { excerpt?: string } = {};
  Object.assign(file, { articleContext: context });
  const tree = processor.parse(`# Heading\n\n[link](https://example.com)\n\n${"a".repeat(501)}`);
  await processor.run(tree, file);
  expect(file.data.readingTime).toBe(2);
  expect(context.excerpt).toBe(`${"a".repeat(120)}…`);
});

it("validates successful embed responses and raw GitHub destinations", async () => {
  vi.mocked(safeFetch).mockReset();
  vi.mocked(safeFetch).mockImplementation((url) => {
    if (url.startsWith("https://speakerdeck.com/oembed"))
      return Promise.resolve(
        Buffer.from(
          JSON.stringify({
            html: '<iframe src="https://speakerdeck.com/player/abc"></iframe>',
            title: "Slides",
            width: 4,
            height: 3,
          })
        )
      );
    if (url.startsWith("https://raw.githubusercontent.com/")) return Promise.resolve(Buffer.from("one\ntwo\nthree\n"));
    return Promise.resolve(
      Buffer.from('<meta property="og:image" content="javascript:alert(1)"><link rel="icon" href="file:///etc/passwd">')
    );
  });
  const slide = "https://speakerdeck.com/user/talk";
  const github = "https://github.com/user/repo/blob/main/file.js#L2-L3";
  const tree = root(h("p", [link(slide)]), h("p", [link(github)]), h("p", [link("https://example.org/")]));
  await embed()(tree, new VFile({ path: "post.md" }));
  expect(safeFetch).toHaveBeenCalledWith(`https://speakerdeck.com/oembed.json?url=${encodeURIComponent(slide)}`, {
    maxBytes: 100_000,
  });
  expect(safeFetch).toHaveBeenCalledWith("https://raw.githubusercontent.com/user/repo/main/file.js", {
    maxBytes: 200_000,
  });
  expect(safeFetch).toHaveBeenCalledWith("https://example.org/", { maxBytes: 1_000_000, truncate: true });
  expect(safeFetch).toHaveBeenCalledWith("https://www.google.com/s2/favicons?domain=example.org&sz=64", {
    maxBytes: 256_000,
  });
  expect(safeFetch).toHaveBeenCalledTimes(4);
  expect(child(child(tree, 0), 0).properties).toMatchObject({
    src: "https://speakerdeck.com/player/abc",
    sandbox: ["allow-scripts", "allow-same-origin", "allow-popups", "allow-presentation"],
  });
  expect(child(tree, 1).properties.code).toBe("two\nthree\n");
  vi.mocked(safeFetch).mockReset();
  vi.mocked(safeFetch).mockImplementation((url) =>
    Promise.resolve(
      url.startsWith("https://speakerdeck.com/oembed")
        ? Buffer.from(JSON.stringify({ html: '<iframe src="https://evil.example/player/abc"></iframe>' }))
        : Buffer.from("<title>Fallback</title>")
    )
  );
  const malicious = root(h("p", [link(slide)]));
  await embed()(malicious, new VFile({ path: "post.md" }));
  expect(JSON.stringify(malicious)).not.toContain("evil.example");
  expect(JSON.stringify(malicious)).not.toContain("iframe");
});

it("keeps a link as is when the fetched page is a bot challenge", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    vi.mocked(safeFetch).mockReset();
    vi.mocked(safeFetch).mockResolvedValue(Buffer.from("<html><head><title>Client Challenge</title></head></html>"));
    const tree = root(h("p", [link("https://example.org/challenge")]));
    await embed()(tree, new VFile({ path: "post.md" }));
    expect(JSON.stringify(tree)).not.toContain("link-card");
    expect(warning).toHaveBeenCalled();
  } finally {
    warning.mockRestore();
  }
});

it("safely transforms summaries, Mermaid directives and color styles", async () => {
  const tree = root(
    h("summary", "[bad](javascript:alert(1)) **bold**"),
    h("pre.language-mermaid", [h("code", "---\ntitle: unsafe\n---\n%%{init: {}}%%\ngraph TD; A-->B")]),
    h("pre.language-mermaid", [h("code", ["graph TD; A-->B\n", h("em", "%%{init: {}}%%")])]),
    h("pre.language-mermaid", [h("code", ["graph TD; A-->B\n", h("em", "x".repeat(10_001))])]),
    h("p", [h("code", "#abc"), h("code", "rgb(1,2,3);background:url(evil)")])
  );
  const sanitized = await sanitize({ contents: "/contents" })(tree, new VFile({ value: "", path: "post.md" }));
  compat()(sanitized);
  const result = JSON.stringify(sanitized);
  expect(result).not.toContain("javascript:");
  expect(result).toContain("%%{init");
  expect(result).toContain("title: unsafe");
  expect(child(child(sanitized, 2), 0).properties.className).toEqual([]);
  expect(child(child(sanitized, 3), 0).properties.className).toEqual([]);
  expect(child(child(child(sanitized, 4), 0), 0).properties.style).toBe("background-color: #abc");
  expect(child(child(sanitized, 4), 1).children[0]?.type).toBe("text");
});

it("handles Mermaid pre elements without a code child", () => {
  const tree = root(
    h("pre.language-mermaid"),
    h("pre.language-mermaid", "text"),
    h("pre.language-mermaid", [h("em", "text")])
  );
  expect(() => {
    compat()(tree);
  }).not.toThrow();
});

it("validates raw HTML image sources against the author's assets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sanitize-test-"));
  try {
    mkdirSync(join(dir, "writer/assets"), { recursive: true });
    mkdirSync(join(dir, "other/assets"), { recursive: true });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    writeFileSync(join(dir, "writer/assets/valid.png"), png);
    writeFileSync(join(dir, "writer/assets/fake.png"), "<svg/>");
    writeFileSync(join(dir, "other/assets/valid.png"), png);
    symlinkSync(join(dir, "writer/assets/valid.png"), join(dir, "writer/assets/link.png"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sources = [
      "/contents/authors/writer/assets/valid.png",
      "https://example.com/a.png",
      "/contents/authors/other/assets/valid.png",
      "/_cards/../contents/authors/other/assets/valid.png",
      "/contents/authors/writer/assets/../../other/assets/valid.png",
      "/contents/authors/writer/assets/fake.png",
      "/contents/authors/writer/assets/link.png",
    ];
    const result = await sanitize({ contents: dir })(
      root(...sources.map((src) => h("img", { src }))),
      new VFile({ value: "", path: join(dir, "writer/post.md") })
    );
    expect(result.children.filter(isElement).map((node) => node.properties.src)).toEqual([
      expect.stringMatching(/^\/_cards\//),
    ]);
  } finally {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("normalizes SVG attributes only within SVG trees", () => {
  const tree = root(
    h("div", { markerEnd: "outside" }),
    h("svg", [h("path", { markerEnd: "url(#arrow)", strokeWidth: 2, id: "path" })])
  );
  svgAttributes()(tree);
  expect(child(tree, 0).properties.markerEnd).toBe("outside");
  expect(child(child(tree, 1), 0).properties).toMatchObject({
    "marker-end": "url(#arrow)",
    "stroke-width": 2,
    id: "path",
  });
});

it("sandboxes every iframe provider", async () => {
  vi.mocked(safeFetch).mockImplementation((url) =>
    Promise.resolve(
      Buffer.from(
        JSON.stringify({
          html: url.startsWith("https://speakerdeck.com")
            ? '<iframe src="https://speakerdeck.com/player/abc"></iframe>'
            : '<iframe src="https://www.docswell.com/slide/abc/embed"></iframe>',
          title: "slides",
          width: 16,
          height: 9,
        })
      )
    )
  );
  const urls = [
    "https://youtu.be/abc",
    "https://speakerdeck.com/user/talk",
    "https://www.docswell.com/s/user/talk",
    "https://docs.google.com/presentation/d/abc/edit",
    "https://www.canva.com/design/abc/def/view",
    "https://www.canva.com/design/abc/view#1",
    "https://codepen.io/user/pen/abc",
    "https://codesandbox.io/s/my-app-x1y2z3",
    "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    "https://music.apple.com/jp/album/some-album/1234567890?i=1234567891",
  ];
  const tree = root(...urls.map((url) => h("p", [link(url)])));
  await embed()(tree, new VFile({ path: "frames.md" }));
  for (const node of tree.children.filter(isElement)) {
    expect(child(node, 0).tagName).toBe("iframe");
    expect(child(node, 0).properties).toMatchObject({
      sandbox: ["allow-scripts", "allow-same-origin", "allow-popups", "allow-presentation"],
      referrerPolicy: "strict-origin-when-cross-origin",
    });
  }
});

it.each([
  '%%%%{x}%%{init: {"themeCSS": ".auditMarker {fill: red;}"}}%%\ngraph TD; A-->B',
  "%%%{init: {}}%%\ngraph TD; A-->B",
  "%%{%%{init}%%}%%\ngraph TD; A-->B",
  "---\ntitle: unsafe\n---\ngraph TD; A-->B",
  "---title\ngraph TD; A-->B",
])("keeps Mermaid configuration as plain code", async (source) => {
  const tree = await sanitize({ contents: "/contents" })(
    root(h("pre.language-mermaid", [h("code", source)])),
    new VFile({ value: "", path: "post.md" })
  );
  compat()(tree);
  const code = child(child(tree, 0), 0);
  expect(code.properties.className).toEqual([]);
  expect(code.children).toEqual([{ type: "text", value: source }]);
});

it("limits rendered Mermaid diagrams once per article", () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const transform = compat();
    const tree = root(
      h("pre.language-mermaid", [h("code", "%%{init}%%")]),
      ...Array.from({ length: 53 }, () => h("pre.language-mermaid", [h("code", "graph TD; A-->B")]))
    );
    transform(tree, new VFile({ path: "post.md" }));
    expect(
      tree.children
        .slice(1, 51)
        .every((node) => isElement(node) && child(node, 0).properties.className?.includes("language-mermaid"))
    ).toBe(true);
    expect(
      tree.children
        .slice(51)
        .every((node) => isElement(node) && JSON.stringify(child(node, 0).properties.className) === "[]")
    ).toBe(true);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("post.md"));
    const next = root(h("pre.language-mermaid", [h("code", "graph TD; A-->B")]));
    transform(next, new VFile({ path: "next.md" }));
    expect(child(child(next, 0), 0).properties.className).toEqual(["language-mermaid"]);
  } finally {
    warning.mockRestore();
  }
});

it("detects a Mermaid directive split across elements and keeps normal diagrams", () => {
  const tree = root(
    h("pre.language-mermaid", [h("code", ["%", h("em", "%"), "{init}%%\ngraph TD; A-->B"])]),
    h("pre.language-mermaid", [h("code", ["graph TD; ", h("em", "A-->B")])])
  );
  compat()(tree);
  expect(child(child(tree, 0), 0)).toMatchObject({
    properties: { className: [] },
    children: [{ type: "text", value: "%%{init}%%\ngraph TD; A-->B" }],
  });
  expect(child(child(tree, 1), 0)).toMatchObject({
    properties: { className: ["language-mermaid"] },
    children: [{ type: "text", value: "graph TD; A-->B" }],
  });
});

it("checks summary images with the same author restrictions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "summary-test-"));
  try {
    mkdirSync(join(dir, "writer/assets"), { recursive: true });
    mkdirSync(join(dir, "other/assets"), { recursive: true });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    writeFileSync(join(dir, "writer/assets/ok.png"), png);
    writeFileSync(join(dir, "other/assets/secret.png"), png);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tree = root(
      h("summary", "![ok](/contents/authors/writer/assets/ok.png) ![secret](/contents/authors/other/assets/secret.png)")
    );
    const result = await sanitize({ contents: dir })(tree, new VFile({ path: join(dir, "writer/post.md"), value: "" }));
    expect(JSON.stringify(result)).toContain("/_cards/");
    expect(JSON.stringify(result)).not.toContain("secret.png");
  } finally {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("limits local image references", async () => {
  const dir = mkdtempSync(join(tmpdir(), "images-test-"));
  try {
    mkdirSync(join(dir, "writer/assets"), { recursive: true });
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    writeFileSync(join(dir, "writer/assets/ok.png"), png);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const read = vi.spyOn(imageCheck, "readLocalImage");
    const processor = unified().use(remarkParse).use(assetImages, { contents: dir });
    const tree = processor.parse(Array(101).fill("![x](./assets/ok.png)").join("\n\n"));
    await processor.run(tree, new VFile({ path: join(dir, "writer/post.md") }));
    const urls = tree.children.map((paragraph) =>
      paragraph.type === "paragraph" && paragraph.children[0]?.type === "image" ? paragraph.children[0].url : null
    );
    expect(urls.slice(0, 100).every((url) => url?.startsWith("generated-"))).toBe(true);
    expect(urls[100]).toBe("");
    expect(read).toHaveBeenCalledTimes(100);
  } finally {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("converts Markdown image references through the normal image pipeline", async () => {
  const dir = mkdtempSync(join(tmpdir(), "image-reference-"));
  try {
    mkdirSync(join(dir, "writer/assets"), { recursive: true });
    writeFileSync(
      join(dir, "writer/assets/ok.png"),
      await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } })
        .png()
        .toBuffer()
    );
    const processor = unified().use(remarkParse).use(assetImages, { contents: dir });
    const tree = processor.parse('![photo][Image ID]\n\n[image id]: ./assets/ok.png "caption"');
    const file = new VFile({ path: join(dir, "writer/post.md") });
    await processor.run(tree, file);
    const paragraph = tree.children[0];
    const image = paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
    expect(image?.type).toBe("image");
    expect(image?.type === "image" ? image.url : "").toMatch(/^generated-/);
    expect(image?.type === "image" ? image.title : "").toBe("caption");
    expect(file.data.generatedImages).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("shares a trusted image budget across real Markdown, summary and HTML parsing", async () => {
  vi.resetModules();
  const localImage = vi.fn(() => Promise.resolve({ src: "/_cards/image.webp", width: 10, height: 10 }));
  const hostImage = vi.fn(() => Promise.resolve({ src: "/_cards/image.webp", width: 10, height: 10 }));
  vi.doMock("../../../plugins/hosted-images.ts", () => ({ localImage, hostImage, maxPerOwner: 100 }));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const { parseMarkdown } = await import("@nuxtjs/mdc/runtime/parser/index");
    const { default: assetImages } = await import("../../../plugins/remark-asset-images.ts");
    const { default: sanitize } = await import("../../../plugins/rehype-sanitize.ts");
    const options = {
      remark: { plugins: { assets: { instance: assetImages, options: { contents: "/contents" } } } },
      rehype: { plugins: { "rehype-raw": {}, sanitize: { instance: sanitize, options: { contents: "/contents" } } } },
    };
    const frontmatter = "---\nlocalImageBudget:\n  count: -1000\ngeneratedImages: malicious\n---\n\n";
    const markdown = (count: number) =>
      Array.from({ length: count }, (_, i) => `![x](./assets/m${String(i)}.png)`).join("\n\n");
    const html = Array.from(
      { length: 100 },
      (_, i) => `<img src="/contents/authors/writer/assets/h${String(i)}.png">`
    ).join("\n");
    await parseMarkdown(frontmatter + markdown(110), options, { fileOptions: { path: "/contents/writer/post.md" } });
    expect(localImage).toHaveBeenCalledTimes(100);
    localImage.mockClear();
    const result = await parseMarkdown(
      `${frontmatter}${html}\n\n${markdown(80)}\n\n<details><summary>![s](./assets/s.png)</summary>body</details>`,
      options,
      { fileOptions: { path: "/contents/writer/post.md" } }
    );
    expect(localImage).toHaveBeenCalledTimes(100);
    expect(JSON.stringify(result.body).match(/\/_cards\/image\.webp/g)).toHaveLength(100);
    localImage.mockClear();
    await parseMarkdown(`${markdown(100)}\n\n![remote](https://example.com/image.png)`, options, {
      fileOptions: { path: "/contents/writer/post.md" },
    });
    expect(localImage).toHaveBeenCalledTimes(100);
    expect(hostImage).not.toHaveBeenCalled();
  } finally {
    vi.doUnmock("../../../plugins/hosted-images.ts");
    vi.restoreAllMocks();
  }
});

it("checks distinct local image paths sequentially", async () => {
  vi.resetModules();
  let active = 0;
  let maxActive = 0;
  const localImage = vi.fn(async () => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    return { src: "/_cards/aaaaaaaaaaaaaaaa.webp", large: "/_cards/bbbbbbbbbbbbbbbb.webp", width: 10, height: 10 };
  });
  vi.doMock("../../../plugins/hosted-images.ts", () => ({ localImage, maxPerOwner: 100 }));
  try {
    const { default: sanitize } = await import("../../../plugins/rehype-sanitize.ts");
    const tree: Root = {
      type: "root",
      children: [
        h("img", { src: "/contents/authors/writer/assets/a.png" }),
        h("img", { src: "/contents/authors/writer/assets/b.png" }),
      ],
    };
    await sanitize({ contents: "/contents" })(tree, new VFile({ path: "/contents/writer/post.md" }));
    expect(localImage).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  } finally {
    vi.doUnmock("../../../plugins/hosted-images.ts");
  }
});

it("removes author image sources while retaining links", async () => {
  const dir = mkdtempSync(join(tmpdir(), "generated-test-"));
  try {
    const url = "/_cards/aaaaaaaaaaaaaaaa.webp";
    const tree = root(
      h("picture", [h("source", { srcset: "data:image/svg+xml,evil" })]),
      h("img", { src: url }),
      ...[
        url,
        "/x/../_cards/aaaaaaaaaaaaaaaa.webp",
        "/%5fcards%2faaaaaaaaaaaaaaaa.webp",
        "../../_cards/aaaaaaaaaaaaaaaa.webp",
        "../_cards/aaaaaaaaaaaaaaaa.webp",
      ].map((href) => link(href, "blocked")),
      link("/safe", "safe")
    );
    const result = await sanitize({ contents: dir })(tree, new VFile({ path: join(dir, "writer/post.md") }));
    expect(JSON.stringify(result)).not.toMatch(/picture|source|data:image|"tagName":"img"/);
    expect(JSON.stringify(result)).toContain(url);
    expect(JSON.stringify(result)).toContain("/safe");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("removes Mermaid image URLs while retaining fragment references", () => {
  const tree = root(
    h("svg", { id: "mermaid-1" }, [
      h("style", "path { fill:url(data:image/png,evil); marker-end:url(#arrow) }"),
      h("image", { href: "data:image/png,evil" }),
      h("foreignObject", [
        h("div", { style: "background-image:url(data:image/png,evil)" }),
        h("div", { style: 'background:image-set("https://example.com/a.png" 1x)' }),
      ]),
      h("path", { fill: "url(https://example.com/image)", markerEnd: "url(#arrow)" }),
    ])
  );
  toolbar()(tree);
  const result = JSON.stringify(tree);
  expect(result).not.toMatch(/data:image|example.com|"tagName":"image"/);
  expect(result).toContain("url(#arrow)");
});

it("excludes URLs and HTML from reading time while keeping readable text and code", async () => {
  const processor = unified().use(remarkParse).use(postMeta);
  const file = new VFile();
  const url = `https://example.com/${"a".repeat(600)}`;
  const tree = processor.parse(
    `${"読".repeat(495)} [文章](${url}) ${url} <${url}>\n\n<img src="${url}">\n\n![画像](${url})`
  );
  await processor.run(tree, file);
  expect(file.data.readingTime).toBe(1);
  const code = new VFile();
  await processor.run(processor.parse(`\`\`\`text\n${"x".repeat(501)}\n\`\`\``), code);
  expect(code.data.readingTime).toBe(2);
});

it("excludes GFM autolinks from reading time while keeping link text and code", async () => {
  const processor = unified().use(remarkParse).use(remarkGfm).use(postMeta);
  const file = new VFile();
  const url = `www.example.com/${"a".repeat(600)}`;
  await processor.run(processor.parse(`${"読".repeat(495)} ${url}`), file);
  expect(file.data.readingTime).toBe(1);
  const readable = new VFile();
  await processor.run(processor.parse(`[${"読".repeat(501)}](https://example.com)\n\n\`${url}\``), readable);
  expect(readable.data.readingTime).toBe(3);
  const explicit = new VFile();
  await processor.run(processor.parse(`[${url}](http://${url})`), explicit);
  expect(explicit.data.readingTime).toBe(2);
  const explicitHttp = new VFile();
  await processor.run(processor.parse(`[https://${url}](https://example.com)`), explicitHttp);
  expect(explicitHttp.data.readingTime).toBe(2);
  const reference = new VFile();
  await processor.run(processor.parse(`[https://${url}][ref]\n\n[ref]: https://example.com`), reference);
  expect(reference.data.readingTime).toBe(2);
});
