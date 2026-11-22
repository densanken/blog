import { h } from "hastscript";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { VFile } from "vfile";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import rehypePlantuml from "../../../plugins/rehype-plantuml.ts";
import sanitize from "../../../plugins/rehype-sanitize.ts";
import unicodeGuard from "../../../plugins/rehype-unicode-code.ts";
import assetImages from "../../../plugins/remark-asset-images.ts";
import { safeFetch } from "../../../plugins/safe-fetch.ts";
import { defect, stats, warn } from "../../../plugins/warn.ts";

import type { Root } from "hast";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn().mockRejectedValue(new Error("offline")) }));

let messages: string[];
beforeEach(() => {
  messages = [];
  vi.spyOn(console, "warn").mockImplementation((message: string) => void messages.push(message));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = undefined;
});

const run = async (markdown: string) => {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true });
  const tree = processor.runSync(processor.parse(markdown));
  await sanitize({ contents: "/contents" })(tree, new VFile({ value: markdown, path: "/contents/writer/post.md" }));
};

describe("strict mode", () => {
  it("sets a nonzero exit code only for defects in strict mode", () => {
    vi.stubEnv("CONTENT_STRICT", "1");
    warn("not a defect");
    expect(process.exitCode).toBeUndefined();
    const count = stats.defects;
    defect("a defect", "contents/authors/writer/post.md");
    expect(process.exitCode).toBe(1);
    expect(stats.defects).toBe(count + 1);
    expect(messages).toEqual(["[content] not a defect", "[content] contents/authors/writer/post.md: a defect"]);
  });
  it("only warns without strict mode", () => {
    defect("a defect");
    expect(process.exitCode).toBeUndefined();
    expect(messages).toEqual(["[content] a defect"]);
  });
});

describe("sanitize warning", () => {
  it("lists the removed elements and attributes once per article", async () => {
    vi.stubEnv("CONTENT_STRICT", "1");
    const tree: Root = {
      type: "root",
      children: [
        h("script", "alert(1)"),
        h("iframe", { src: "https://example.com" }),
        h("p", { onClick: "x()" }, "text"),
        h("p", [h("a", { href: "javascript:evil()" }, "link")]),
      ],
    };
    await sanitize({ contents: "/contents" })(tree, new VFile({ value: "", path: "/contents/writer/post.md" }));
    expect(process.exitCode).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("contents/authors/writer/post.md");
    for (const name of ["<script>", "<iframe>", "onclick", "href"]) expect(messages[0]).toContain(name);
  });
  it("does not warn for ordinary Markdown", async () => {
    vi.stubEnv("CONTENT_STRICT", "1");
    await run(
      [
        "# Title",
        "text **bold** [link](https://example.com) ~~del~~ footnote[^1]",
        "- [x] task\n- item",
        "| a | b |\n| - | - |\n| 1 | 2 |",
        "```ts\nconst a = 1;\n```",
        "`inline` and $x$\n\n<details><summary>s</summary>body</details>\n\n[^1]: note",
      ].join("\n\n")
    );
    expect(messages).toEqual([]);
    expect(process.exitCode).toBeUndefined();
  });
});

describe("classification", () => {
  it("treats PlantUML syntax errors as defects and server failures as other warnings", async () => {
    vi.stubEnv("CONTENT_STRICT", "1");
    const code = (source: string): Root => ({
      type: "root",
      children: [h("pre.language-plantuml", [h("code", source)])],
    });
    const transform = rehypePlantuml({ contents: "/contents", cacheDir: "/nonexistent/plantuml" });
    const file = new VFile({ path: "/contents/writer/post.md" });
    await transform(code("@startuml\n!include x\n@enduml"), file);
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    vi.mocked(safeFetch).mockRejectedValue(new Error("offline"));
    await transform(code("@startuml\nA -> B\n@enduml"), file);
    expect(messages).toHaveLength(2);
    expect(process.exitCode).toBeUndefined();
    // PlantUML Server が構文の誤りに返す HTTP 400 は、作者が直せる不備なので、defect にする
    vi.mocked(safeFetch).mockRejectedValue(Object.assign(new Error("HTTP 400"), { status: 400 }));
    await transform(code("@startuml\nA -> -> B\n@enduml"), file);
    expect(messages).toHaveLength(3);
    expect(messages[2]).toContain("図の構文に誤りがあります");
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    // 400 以外（サーバーの障害）は、defect にしない
    vi.mocked(safeFetch).mockRejectedValue(Object.assign(new Error("HTTP 503"), { status: 503 }));
    await transform(code("@startuml\nA -> C\n@enduml"), file);
    expect(messages).toHaveLength(4);
    expect(process.exitCode).toBeUndefined();
  });
  it("treats an invisible character in code as a defect, except in an embedded external file", () => {
    vi.stubEnv("CONTENT_STRICT", "1");
    const file = new VFile({ path: "/contents/writer/post.md" });
    const external = h("pre", { githubEmbed: true }, [h("code", "a‮b")]);
    unicodeGuard()({ type: "root", children: [external] }, file);
    expect(messages).toHaveLength(1);
    expect(process.exitCode).toBeUndefined();
    unicodeGuard()({ type: "root", children: [h("pre", [h("code", "a‮b")])] }, file);
    expect(process.exitCode).toBe(1);
  });
  it("treats a failed fetch of an external image as another warning and a missing local image as a defect", async () => {
    vi.stubEnv("CONTENT_STRICT", "1");
    const transform = assetImages({ contents: "/contents" });
    const file = new VFile({ path: "/contents/writer/post.md" });
    const image = (url: string): Root =>
      ({ type: "root", children: [{ type: "paragraph", children: [{ type: "image", url }] }] }) as never;
    await transform(image("https://images.example/a.png") as never, file);
    expect(messages).toHaveLength(1);
    expect(process.exitCode).toBeUndefined();
    await transform(image("./assets/missing.png") as never, file);
    expect(process.exitCode).toBe(1);
  });
});
