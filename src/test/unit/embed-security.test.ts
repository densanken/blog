import { visit } from "unist-util-visit";
import { describe, expect, it, vi } from "vitest";

import embedCode from "../../../plugins/rehype-embed-code.ts";
import embed from "../../../plugins/rehype-embed.ts";
import sanitize from "../../../plugins/rehype-sanitize.ts";

import type { Element, Root } from "hast";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn().mockRejectedValue(new Error("offline")) }));

const render = async (markdown: string) => {
  const { parseMarkdown } = await import("@nuxtjs/mdc/runtime/parser/index");
  let result: Root | undefined;
  const capture = () => (tree: Root) => {
    result = tree;
  };
  await parseMarkdown(
    markdown,
    {
      rehype: {
        plugins: {
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
  if (!result) throw new Error("No output");
  return result;
};

const elements = (tree: Root) => {
  const result: Element[] = [];
  visit(tree, "element", (node) => {
    result.push(node);
  });
  return result;
};

const assertSafe = (tree: Root) => {
  for (const node of elements(tree)) {
    expect(["script", "style", "form", "object", "embed", "svg", "meta", "base", "link"]).not.toContain(node.tagName);
    expect(Object.keys(node.properties).some((key) => /^on/i.test(key))).toBe(false);
    if (node.tagName === "a") expect(node.properties.href ?? "").not.toMatch(/^\s*(?:javascript|data):/i);
    if (node.tagName === "iframe") {
      expect(Object.keys(node.properties).sort()).toEqual(
        ["allow", "loading", "referrerPolicy", "sandbox", "src", "title"].sort()
      );
      expect(node.properties.sandbox).toEqual([
        "allow-scripts",
        "allow-same-origin",
        "allow-popups",
        "allow-presentation",
      ]);
      expect(node.properties.referrerPolicy).toBe("strict-origin-when-cross-origin");
      expect(node.children).toEqual([]);
    }
  }
};

const youtube = "https://www.youtube.com/embed/abc";
const hazards =
  '<script>evil()</script><style>body{display:none}</style><form><object><embed src="https://evil.test"></object></form><svg onload="evil()"></svg><a href="javascript:evil()">bad</a><meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"><link href="https://evil.test">';

describe("hostile embed code", () => {
  it("removes author-supplied GitHub embed markers", async () => {
    const tree = await render(
      '<pre github-embed="true" githubEmbed="true" filename="file.ts"><code>test</code></pre>\n\n```js githubEmbed=true\ntest\n```'
    );
    for (const node of elements(tree).filter((element) => element.tagName === "pre")) {
      expect(node.properties.githubEmbed).toBeUndefined();
      expect(node.properties["github-embed"]).toBeUndefined();
    }
  });
  it("rebuilds Speaker Deck scripts without dangerous attributes", async () => {
    const tree = await render(
      '<script class="speakerdeck-embed" data-id="50021f75cf1db900020005e7" src="//speakerdeck.com/assets/embed.js" onload="evil()" style="position:fixed" data-ratio="1.5"></script>'
    );
    assertSafe(tree);
    const frames = elements(tree).filter((node) => node.tagName === "iframe");
    expect(frames).toHaveLength(1);
    expect(frames[0]?.properties.src).toBe("https://speakerdeck.com/player/50021f75cf1db900020005e7");
    expect(JSON.stringify(tree)).not.toMatch(/evil|position:fixed/);
  });
  it.each([
    '<script class="speakerdeck-embed" data-id="50021f75cf1db900020005e7" src="https://evil.test/assets/embed.js"></script>',
    '<script class="speakerdeck-embed" data-id="50021f75cf1db900020005e7" src="https://speakerdeck.com/assets/embed.js?evil"></script>',
    '<script class="speakerdeck-embed" data-id="50021f75cf1db900020005e7/evil" src="//speakerdeck.com/assets/embed.js"></script>',
    '<script class="other" data-id="50021f75cf1db900020005e7" src="//speakerdeck.com/assets/embed.js"></script>',
  ])("rejects forged Speaker Deck scripts", async (input) => {
    const tree = await render(input);
    assertSafe(tree);
    expect(elements(tree).filter((node) => node.tagName === "iframe")).toHaveLength(0);
  });
  it("rebuilds iframes without author attributes or children for every iframe provider", async () => {
    const urls = [
      youtube,
      "https://docs.google.com/presentation/d/e/2PACX-ABC/pubembed",
      "https://www.canva.com/design/ABC/view?embed",
      "https://codepen.io/user/embed/ABC",
      "https://codepen.io/editor/anon/embed/0199bfac-1c24-78b0-8124-973bee74df24",
      "https://codesandbox.io/embed/abc",
      "https://www.docswell.com/slide/LK7J5V/embed",
      "https://open.spotify.com/embed/track/04TshWXkhV1qkqHzf31Hn6",
      "https://embed.music.apple.com/jp/album/abc/123",
      `https://speakerdeck.com/player/${"a".repeat(32)}`,
    ];
    for (const src of urls) {
      const tree = await render(
        `<iframe class="speakerdeck-iframe" id="evil" name="evil" src="${src}" onload="evil()" srcdoc="<script>evil()</script>" style="position:fixed" sandbox="allow-top-navigation" allow="camera">${hazards}</iframe>`
      );
      assertSafe(tree);
      const frames = elements(tree).filter((node) => node.tagName === "iframe");
      expect(frames).toHaveLength(1);
      const expected =
        src === youtube
          ? "https://www.youtube-nocookie.com/embed/abc"
          : src.includes("docs.google.com/")
            ? src.replace("/embed", "/pubembed")
            : src.includes("codepen.io/")
              ? `${src}?default-tab=result`
              : src;
      expect(frames[0]?.properties.src).toBe(expected);
      expect(frames[0]?.properties.loading).toBe("lazy");
      expect(frames[0]?.properties.allow).toBe(
        src.includes("spotify.com") || src.includes("music.apple.com") ? "encrypted-media; fullscreen" : "fullscreen"
      );
      expect(frames[0]?.properties.title).toBeTruthy();
    }
  });
  it.each([
    `<div>${hazards}<iframe src="${youtube}"></iframe>${hazards}</div>`,
    `<p class="codepen" data-user="user" data-slug-hash="ABC">${hazards}</p><script src="https://cpwebassets.codepen.io/assets/embed/ei.js"></script>${hazards}`,
    `<blockquote class="twitter-tweet"><p>${hazards}<a href="https://evil.test/status/2">other</a></p>— Name (@user) <a href="https://x.com/user/status/123">${hazards}</a></blockquote><script src="https://platform.x.com/widgets.js"></script>`,
    `<script class="docswell-embed" src="https://www.docswell.com/assets/libs/docswell-embed/docswell-embed.min.js" data-src="https://www.docswell.com/slide/ABC/embed"></script><div class="docswell-link"><a href="https://www.docswell.com/s/user/ABC">${hazards}</a></div>`,
    `<div><iframe src="https://www.canva.com/design/ABC/view?embed"></iframe></div><a href="https://www.canva.com/design/ABC/view">${hazards}</a> by <a href="https://www.canva.com/p/user">author</a>`,
  ])("sanitizes hostile elements around and inside wrappers", async (input) => {
    assertSafe(await render(input));
  });
  it.each([
    "https://www.youtube.com@evil.test/embed/abc",
    "https://www.youtube.com.evil.test/embed/abc",
    "javascript:alert(1)",
    "data:text/html,evil",
    "https://www.youtube.com/embed/a%2Fb",
    "https://www.youtube.com/embed/a%00b",
    "https://www.youtube.com/embed/../abc",
    "https://www.youtube.com/embed/abc%0Aevil",
    "https://www.youtube.com/embed/abc/extra",
    "https://www.youtube.com/embed/a&#10;b",
    "https://www.youtube.com/embed/a&#9;b",
    "HTTPS://WWW.YOUTUBE.COM/embed/abc",
    "//www.youtube.com/embed/abc",
    "https://embed.music.apple.com/jp/album/a%2Fb/123",
    "https://embed.music.apple.com/jp/album/a%00b/123",
    "https://embed.music.apple.com/jp/album/a%ZZb/123",
    "https://evil.test/slide/LK7J5V/embed",
    "https://www.docswell.com.evil.test/slide/LK7J5V/embed",
    "https://www.docswell.com/slide/LK7J5V-evil/embed",
    "https://www.docswell.com/slide/LK7J5V%2Fevil/embed",
    "https://www.docswell.com/slide/LK7J5V/embed?evil",
  ])("rejects forged iframe src %s", async (src) => {
    const tree = await render(`<iframe src="${src}"></iframe>`);
    assertSafe(tree);
    expect(elements(tree).filter((node) => node.tagName === "iframe")).toHaveLength(0);
  });
  it("accepts the documented protocol-relative CodePen iframe and normalizes it", async () => {
    const tree = await render(
      '<iframe src="//codepen.io/editor/anon/embed/0199bfac-1c24-78b0-8124-973bee74df24"></iframe>'
    );
    assertSafe(tree);
    expect(elements(tree).find((node) => node.tagName === "iframe")?.properties.src).toBe(
      "https://codepen.io/editor/anon/embed/0199bfac-1c24-78b0-8124-973bee74df24?default-tab=result"
    );
  });
  it("discards injected query and hash and invalid ratios", async () => {
    const tree = await render(
      `<iframe src="${youtube}?x=evil#ratio=999"></iframe>\n\nhttps://speakerdeck.com/player/${"a".repeat(32)}#ratio=999`
    );
    assertSafe(tree);
    const frames = elements(tree).filter((node) => node.tagName === "iframe");
    expect(frames.map((node) => node.properties.src)).toEqual([
      "https://www.youtube-nocookie.com/embed/abc",
      `https://speakerdeck.com/player/${"a".repeat(32)}`,
    ]);
    expect(JSON.stringify(tree)).not.toContain("ratio=999");
  });
  it("handles nested and large input", async () => {
    const nested = `${"<div>".repeat(100)}<iframe src="${youtube}"></iframe>${"</div>".repeat(100)}`;
    const tree = await render(`${nested}\n\n${"ordinary text ".repeat(12000)}`);
    assertSafe(tree);
  });
});
