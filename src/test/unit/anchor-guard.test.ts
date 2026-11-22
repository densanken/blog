import { h } from "hastscript";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { VFile } from "vfile";
import { describe, expect, it, vi } from "vitest";

import anchorGuard from "../../../plugins/rehype-anchor-guard.ts";
import { skeleton } from "../../../plugins/unicode.ts";

import type { Root } from "hast";

describe("heading and footnote anchors", () => {
  it.each(["\uFE0F", "\u{E01EF}"])(
    "separates headings with variation selector %s and updates references",
    (selector) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const original = `漢${selector}`;
      const parser = unified().use(remarkParse).use(remarkRehype).use(anchorGuard);
      const file = new VFile({
        path: "contents/a/post.md",
        value: `## 漢\n\n## ${original}\n\n[a](#${original}) [b](#${encodeURIComponent(original)})`,
      });
      const tree = parser.runSync(parser.parse(file), file);
      const [first, second, paragraph] = tree.children.filter((node) => node.type === "element") as [
        ReturnType<typeof h>,
        ReturnType<typeof h>,
        ReturnType<typeof h>,
      ];
      expect(first.properties.id).toBe("漢");
      expect(second.properties.id).toBe(`${original}-safe-2`);
      expect(second.children).toMatchObject([{ type: "text", value: original }]);
      expect(paragraph.children.filter((node) => node.type === "element").map((node) => node.properties.href)).toEqual([
        `#${original}-safe-2`,
        `#${original}-safe-2`,
      ]);
      expect(warning).toHaveBeenCalledTimes(1);
      warning.mockRestore();
    }
  );
  it("gives a heading with an empty slug a non-empty ID, and keeps a link to the top", () => {
    const tree: Root = {
      type: "root",
      children: [
        h("h2", [h("svg", { className: ["lucide-inline"] })]),
        h("h2", "😀"),
        h("h2", "!!!"),
        h("h2", "Section"),
        h("p", [h("a", { href: "#" }, "top")]),
      ],
    };
    anchorGuard()(tree, { path: "contents/a/post.md" } as never);
    const ids = tree.children.slice(0, 4).map((node) => (node.type === "element" ? node.properties.id : undefined));
    expect(ids.every((id) => typeof id === "string" && id !== "")).toBe(true);
    expect(new Set(ids).size).toBe(4);
    const link = tree.children[4];
    expect(
      link?.type === "element" && link.children[0]?.type === "element" ? link.children[0].properties.href : ""
    ).toBe("#");
  });
  it("does not take an ID that is written in the article for the replacement of an empty slug", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tree: Root = {
      type: "root",
      children: [
        h("h2", "😀"),
        h("h2", { id: "section" }, "Written"),
        h("h2", { id: "section-1" }, "Written 2"),
        h("p", [h("a", { href: "#section" }, "link")]),
      ],
    };
    anchorGuard()(tree, { path: "contents/a/post.md" } as never);
    const [emoji, written, writtenSecond, paragraph] = tree.children as ReturnType<typeof h>[];
    expect(written?.properties.id).toBe("section");
    expect(writtenSecond?.properties.id).toBe("section-1");
    expect(emoji?.properties.id).toBeTruthy();
    expect(["section", "section-1"]).not.toContain(emoji?.properties.id);
    const link = paragraph?.children[0];
    expect(link?.type === "element" ? link.properties.href : "").toBe("#section");
    expect(warning).not.toHaveBeenCalled();
    warning.mockRestore();
  });
  it("separates confusable identifiers and updates their references", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = h("h2", "paypal");
    const second = h("h2", "pаypal");
    const footnote = h("a", { id: "user-content-fn-paypal" }, "footnote");
    const spoof = h("a", { id: "user-content-fn-pаypal" }, "footnote");
    const link = h("a", { href: "#user-content-fn-pаypal" }, "ref");
    const tree: Root = { type: "root", children: [first, second, footnote, spoof, link] };
    anchorGuard()(tree, new VFile({ path: "contents/a/post.md" }));
    expect(skeleton(String(first.properties.id))).not.toBe(skeleton(String(second.properties.id)));
    expect(skeleton(String(footnote.properties.id))).not.toBe(skeleton(String(spoof.properties.id)));
    expect(link.properties.href).toBe(`#${String(spoof.properties.id)}`);
    expect(warning).toHaveBeenCalledTimes(2);
    warning.mockRestore();
  });
  it("reserves later anchors and handles encoded footnote IDs and links", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = h("h2", "paypal");
    const second = h("h2", "pаypal");
    const third = h("h2", "pаypal-safe-2");
    const link = h("a", { href: "#p%D0%B0ypal" }, "ref");
    const footnote = h("a", { id: "user-content-fn-paypal" }, "a");
    const spoof = h("a", { id: "user-content-fn-paypa%E2%85%BC" }, "b");
    const ref = h("a", { href: "#user-content-fn-paypa%E2%85%BC" }, "ref");
    const tree: Root = { type: "root", children: [first, second, third, link, footnote, spoof, ref] };
    anchorGuard()(tree, new VFile({ path: "contents/a/post.md" }));
    expect(second.properties.id).toBe("pаypal-safe-3");
    expect(third.properties.id).toBe("pаypal-safe-2");
    expect(link.properties.href).toBe("#pаypal-safe-3");
    expect(ref.properties.href).toBe(`#${String(spoof.properties.id)}`);
    expect(spoof.properties.id).not.toBe("user-content-fn-paypa%E2%85%BC");
    warning.mockRestore();
  });
  it("keeps references to distinct IDs after normalization", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = h("h2", { id: "foo--bar" }, "First");
    const second = h("h2", { id: "foo-bar" }, "Second");
    const a = h("a", { href: "#foo--bar" }, "First");
    const b = h("a", { href: "#foo-bar" }, "Second");
    const tree: Root = { type: "root", children: [first, second, a, b] };
    anchorGuard()(tree, new VFile({ path: "contents/a/post.md" }));
    expect(a.properties.href).toBe(`#${String(first.properties.id)}`);
    expect(b.properties.href).toBe(`#${String(second.properties.id)}`);
    warning.mockRestore();
  });
  it("checks named anchors against IDs", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const heading = h("h2", { id: "paypal" }, "Heading");
    const anchor = h("a", { name: "pаypal" }, "Name");
    const ref = h("a", { href: "#p%D0%B0ypal" }, "ref");
    const tree: Root = { type: "root", children: [heading, anchor, ref] };
    anchorGuard()(tree, new VFile({ path: "contents/a/post.md" }));
    expect(skeleton(String(heading.properties.id))).not.toBe(skeleton(String(anchor.properties.name)));
    expect(ref.properties.href).toBe(`#${String(anchor.properties.name)}`);
    warning.mockRestore();
  });
  it("preserves literal fragment matches and gives IDs priority over names", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const encoded = h("a", { id: "%41" });
    const decoded = h("a", { id: "A" });
    const literal = h("a", { href: "#%41" }, "literal");
    const name = h("a", { name: "same" });
    const heading = h("h2", { id: "same" }, "heading");
    const ref = h("a", { href: "#same" }, "heading link");
    const tree: Root = { type: "root", children: [encoded, decoded, literal, name, heading, ref] };
    anchorGuard()(tree, new VFile({ path: "contents/a/post.md" }));
    expect(literal.properties.href).toBe("#%41");
    expect(heading.properties.id).toBe("same");
    expect(ref.properties.href).toBe("#same");
    warning.mockRestore();
  });
  it("keeps matching id and name on the same target", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = h("a", { id: "paypal" });
    const second = h("a", { id: "pаypal", name: "pаypal" });
    const link = h("a", { href: "#pаypal" });
    const tree: Root = { type: "root", children: [first, second, link] };
    anchorGuard()(tree, new VFile({ path: "contents/a/post.md" }));
    expect(second.properties.name).toBe(second.properties.id);
    expect(link.properties.href).toBe(`#${String(second.properties.id)}`);
    warning.mockRestore();
  });
});
