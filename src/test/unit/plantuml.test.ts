import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { h } from "hastscript";
import { VFile } from "vfile";
import { afterEach, describe, expect, it, vi } from "vitest";

import toolbar from "../../../plugins/rehype-mermaid-toolbar.ts";
import plantuml from "../../../plugins/rehype-plantuml.ts";
import { safeFetch } from "../../../plugins/safe-fetch.ts";

import type { Root } from "hast";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn() }));
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const code = (source: string) => h("pre.language-plantuml", [h("code", source)]);
const file = new VFile({ path: "/contents/writer/post.md" });
const setup = async () => {
  const cacheDir = await mkdtemp(join(tmpdir(), "plantuml-test-"));
  dirs.push(cacheDir);
  return plantuml({ contents: "/contents", cacheDir });
};

describe("PlantUML", () => {
  it("fetches once, caches diagrams, sanitizes SVG and shares the Mermaid toolbar", async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      Buffer.from(
        '<svg viewBox="0 0 100 50" onload="evil()"><script>alert(1)</script><foreignObject><p>bad</p></foreignObject><defs><marker id="arrow"/></defs><path marker-end="url(#arrow)"/><rect width="100" height="50" style="fill:#fff;stroke:#000"/><a href="https://evil.test"><text>link</text></a><image href="https://evil.test/a"/></svg>'
      )
    );
    const transform = await setup();
    const input = "@startuml\nAlice -> Bob: Hi\n@enduml";
    const tree: Root = { type: "root", children: [code(input), code(input)] };
    await transform(tree, file);
    toolbar()(tree);
    const output = JSON.stringify(tree);
    expect(safeFetch).toHaveBeenCalledOnce();
    expect(vi.mocked(safeFetch).mock.calls[0]?.[0]).toMatch(/^https:\/\/www\.plantuml\.com\/plantuml\/svg\//);
    expect(output.match(/mermaid-toolbar/g)).toHaveLength(2);
    expect(output).toContain('"fill":"#fff"');
    expect(output).toContain("url(#mermaid-plantuml-0-arrow)");
    expect(output).toContain("url(#mermaid-plantuml-1-arrow)");
    expect(output).not.toMatch(/script|foreignObject|onload|evil\.test|"tagName":"image"/i);
    const cached: Root = { type: "root", children: [code(input)] };
    const transformAgain = plantuml({ contents: "/contents", cacheDir: dirs[0]! });
    await transformAgain(cached, file);
    expect(safeFetch).toHaveBeenCalledOnce();
  });
  it.each(["uml", "salt", "json", "yaml", "wbs"])("accepts matching %s tags and caches them", async (type) => {
    vi.mocked(safeFetch).mockResolvedValue(Buffer.from("<svg/>"));
    const source = `@start${type}\nexample\n@end${type}`;
    const transform = await setup();
    const tree: Root = { type: "root", children: [code(source), code(source)] };
    await transform(tree, file);
    expect(tree.children.every((node) => node.type === "element" && node.tagName === "svg")).toBe(true);
    expect(safeFetch).toHaveBeenCalledOnce();
  });
  it("renders diagrams of different types with Japanese labels", async () => {
    const sources = [
      "@startuml\nアリス -> ボブ: こんにちは\nボブ --> アリス: 返信\n@enduml",
      '@startuml\nclass 注文 {\n  +合計: 数値\n}\n注文 "1" -- "*" 商品\n@enduml',
      "@startuml\nactor 利用者\n利用者 --> (ログインする)\n@enduml",
      "@startuml\nstart\n:受付;\nif (在庫あり?) then (はい)\n  :出荷;\nelse (いいえ)\n  :取り寄せ;endif\nstop\n@enduml",
    ];
    vi.mocked(safeFetch).mockResolvedValue(Buffer.from("<svg/>"));
    const tree: Root = { type: "root", children: sources.map(code) };
    await (
      await setup()
    )(tree, file);
    expect(tree.children.every((node) => node.type === "element" && node.tagName === "svg")).toBe(true);
    expect(safeFetch).toHaveBeenCalledTimes(sources.length);
  });
  it("encodes UTF-8 source and uses distinct cache keys for Japanese labels", async () => {
    const source = "@startuml\nアリス -> ボブ: こんにちは\n@enduml";
    const other = "@startuml\nアリス -> ボブ: さようなら\n@enduml";
    vi.mocked(safeFetch).mockResolvedValue(Buffer.from("<svg/>"));
    const transform = await setup();
    await transform({ type: "root", children: [code(source), code(source), code(other)] }, file);
    expect(safeFetch).toHaveBeenCalledTimes(2);
    expect(safeFetch).toHaveBeenCalledWith(
      "https://www.plantuml.com/plantuml/svg/0JO0oVz0StHXSdHrRMmAuuAYuuEguuAv82q-8EE3dEE3bZeWuu6JuuAJuu6huu6Xuu6l2a1bRcHrRMm0",
      { maxBytes: 1_000_000 }
    );
    for (const input of [source, other]) {
      const hash = createHash("sha256").update(input, "utf8").digest("hex");
      expect(await readFile(join(dirs[0]!, `${hash}.svg`), "utf8")).toBe("<svg/>");
    }
    await plantuml({ contents: "/contents", cacheDir: dirs[0]! })(
      { type: "root", children: [code(source), code(other)] },
      file
    );
    expect(safeFetch).toHaveBeenCalledTimes(2);
  });
  it("preserves Japanese SVG text and attributes while removing invisible characters", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(safeFetch).mockResolvedValue(
      Buffer.from(
        '<svg><text font-family="日本語&#x200b;フォント">こんにちは&#x202e;世界<tspan>記事を読む</tspan></text></svg>'
      )
    );
    const tree: Root = { type: "root", children: [code("@startuml\nアリス -> ボブ\n@enduml")] };
    await (
      await setup()
    )(tree, file);
    const output = JSON.stringify(tree);
    expect(output).toContain("日本語フォント");
    expect(output).toContain("こんにちは世界");
    expect(output).toContain("記事を読む");
    expect(output).not.toMatch(/[\u200b\u202e]/);
    expect(warning).toHaveBeenCalled();
  });
  it("cleans decoded invisible characters from SVG text and attributes", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(safeFetch).mockResolvedValue(
      Buffer.from(
        '<svg><text font-family="safe&#x202e;txt" fill="u&#x200b;rl(https://evil.example/a)">safe&#x202e;txt</text></svg>'
      )
    );
    const tree: Root = { type: "root", children: [code("@startuml\nA -> B\n@enduml")] };
    await (
      await setup()
    )(tree, file);
    expect(JSON.stringify(tree)).not.toContain("\u202e");
    expect(JSON.stringify(tree)).toContain("safetxt");
    expect(JSON.stringify(tree)).not.toContain("evil.example");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("不可視文字"));
  });
  it("re-fetches a corrupt cache entry and permits ordinary exclamation marks", async () => {
    const source = "@startuml\nAlice -> Bob: Hello!\n@enduml";
    const transform = await setup();
    const hash = createHash("sha256").update(source).digest("hex");
    await writeFile(join(dirs[0]!, `${hash}.svg`), "not an SVG");
    vi.mocked(safeFetch).mockResolvedValue(Buffer.from('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>'));
    const tree: Root = { type: "root", children: [code(source)] };
    await transform(tree, file);
    expect(safeFetch).toHaveBeenCalledOnce();
    expect(tree.children[0]).toMatchObject({ tagName: "svg" });
  });
  it.each([
    "@startuml\n!include https://example.com/a\n@enduml",
    '@startuml\nAlice -> Bob: %load_json("/tmp/data.json")\n@enduml',
    '@startuml\nAlice -> Bob: %load_json("https" + "://example.com/data")\n@enduml',
    '@startuml\nAlice -> Bob: %load_json("ht" + "tps://example.com/data")\n@enduml',
    "@startuml\n$x = 1\n@enduml",
    "@startuml\n!includesub /tmp/data!part\n@enduml",
    "@startuml\n!theme plain\n@enduml",
    "@startuml /tmp/output\nA -> B\n@enduml",
    "@startuml\nA [[https://example.com]]\n@enduml",
    `@startuml\nA\n@enduml${"x".repeat(10_001)}`,
    "@startjson\n{}\n@enduml",
    "@startunknown\nA\n@endunknown",
    "invalid",
  ])("leaves unsafe or invalid source as code", async (source) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tree: Root = { type: "root", children: [code(source)] };
    await (
      await setup()
    )(tree, file);
    expect(tree.children[0]).toMatchObject({ tagName: "pre" });
    expect(safeFetch).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
  });
  it("leaves a failed fetch as code and warns", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(safeFetch).mockRejectedValue(new Error("offline"));
    const tree: Root = { type: "root", children: [code("@startuml\nA -> B\n@enduml")] };
    await (
      await setup()
    )(tree, file);
    expect(tree.children[0]).toMatchObject({ tagName: "pre" });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });
  it("converts at most 50 diagrams per article", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(safeFetch).mockResolvedValue(Buffer.from('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>'));
    const tree: Root = { type: "root", children: Array.from({ length: 51 }, () => code("@startuml\nA -> B\n@enduml")) };
    await (
      await setup()
    )(tree, file);
    expect(tree.children.filter((node) => node.type === "element" && node.tagName === "svg")).toHaveLength(50);
    expect(tree.children.at(-1)).toMatchObject({ tagName: "pre" });
    expect(warning).toHaveBeenCalled();
  });
});
