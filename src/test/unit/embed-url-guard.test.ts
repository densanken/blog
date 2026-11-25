import { h } from "hastscript";
import { VFile } from "vfile";
import { expect, it, vi } from "vitest";

import embed from "../../../plugins/rehype-embed.ts";
import guard from "../../../plugins/rehype-url-guard.ts";

import type { Root } from "hast";

vi.mock("../../../plugins/embeds/link-card.ts", () => ({
  linkCard: (url: URL) => h("a", { href: url.href }, "card"),
}));

it.each([
  ["//例えª.test", "example", "xn--"],
  ["https://例えⒶ.test", "example", "xn--"],
  ["https://ｙｏｕｔｕｂｅ.com/watch?v=abc", "video", "youtube.com"],
  ["https://example.com", "google.test", "example.com"],
  ["https://ｘ.com/user/status/123", "post", "x.com"],
])("preserves the original URL verdict through embed conversion: %s", async (href, label, host) => {
  const tree: Root = { type: "root", children: [h("p", [h("a", { href }, label)])] };
  const file = new VFile({ path: "post.md" });
  await embed()(tree, file);
  guard()(tree, file);
  expect(JSON.stringify(tree)).toContain("url-warning");
  expect(tree.children[0]).toMatchObject({
    tagName: "div",
    children: [
      { type: "element" },
      { properties: { className: ["url-host"] } },
      { properties: { className: ["url-warning"] } },
    ],
  });
  expect(JSON.stringify(tree)).toContain(host);
});

it("preserves warnings for equivalent URLs in the same paragraph", async () => {
  const tree: Root = {
    type: "root",
    children: [
      h("p", [
        h("a", { href: "https://ｇoogle.test" }, "first"),
        " ",
        h("a", { href: "https://google.test" }, "second"),
      ]),
    ],
  };
  const file = new VFile({ path: "post.md" });
  await embed()(tree, file);
  guard()(tree, file);
  expect(JSON.stringify(tree.children[1])).toContain("url-warning");
});
