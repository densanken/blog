import fc from "fast-check";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";
import { describe, expect, it } from "vitest";

import callouts from "../../../plugins/rehype-callouts.ts";
import { assertProperty, runs } from "./gen.ts";

import type { Element, Root, ElementContent } from "hast";

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true });
const types = [
  "note",
  "NOTE",
  "Note",
  "tip",
  "important",
  "warning",
  "caution",
  "constructor",
  "__proto__",
  "toString",
  "hasOwnProperty",
  "valueOf",
  "prototype",
  "x",
  "",
  "note-",
  "-",
  "a-b",
  "NOTE​",
  "ｎｏｔｅ",
  "noté",
  "10",
  "__defineGetter__",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "length",
  "name",
];
const marks = ["", "-", "+", " -", " +", "- ", "+ "];
const titles = [
  "",
  " title",
  " **bold** title",
  " `code`",
  " <b>x</b>",
  " [l](https://example.com)",
  " ![i](x)",
  "\\",
  "  ",
  " ‮",
];
const bodies = [
  "",
  "\nbody",
  "\n\nbody",
  "\n> nested",
  "\n> [!NOTE]\n> inner",
  "\n- a\n- b",
  "\n```js\nx\n```",
  "\n[!NOTE] again",
  "\nline1  \nline2",
  "\\\nbody",
  "\n<div>x</div>",
  "\n\n\n",
  "\n> > [!TIP]\n> > deep",
  "\n| a |\n|---|\n| b |",
];
const md = fc
  .array(
    fc.tuple(
      fc.constantFrom(...types),
      fc.constantFrom(...marks),
      fc.constantFrom(...titles),
      fc.constantFrom(...bodies),
      fc.constantFrom("> ", ">", "> > ", "  > ", "- > ", "1. > ", ">\t")
    ),
    { minLength: 1, maxLength: 4 }
  )
  .map((a) =>
    a.map(([t, m, ti, b, q]) => `${q}[!${t}]${m}${ti}${b.replace(/\n/g, `\n${q.trim() ? q : "> "}`)}`).join("\n\n")
  );

const rnd: fc.Arbitrary<ElementContent> = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: "small" },
    {
      weight: 3,
      arbitrary: fc
        .constantFrom(
          "",
          "\n",
          "[!NOTE]",
          "[!NOTE]\nx",
          "[!constructor]",
          "[!__proto__]\ny",
          "[!tip]-",
          "x",
          "[!note] t\nb",
          "[!"
        )
        .map((value): ElementContent => ({ type: "text", value })),
    },
    {
      weight: 3,
      arbitrary: fc
        .tuple(
          fc.constantFrom("blockquote", "p", "br", "div", "span", "strong", "code", "pre", "ul", "li"),
          fc.array(tie("node") as fc.Arbitrary<ElementContent>, { maxLength: 4 })
        )
        .map(([tagName, children]): ElementContent => ({ type: "element", tagName, properties: {}, children })),
    }
  ),
})).node;

describe("callouts fuzz", () => {
  it("markdown blockquotes never throw; non-callout blockquotes stay blockquotes", async () => {
    await assertProperty(
      fc.property(md, (src) => {
        const tree = processor.runSync(processor.parse(src));
        const before = [] as Element[];
        visit(tree, "element", (n) => {
          if (n.tagName === "blockquote") before.push(n);
        });
        callouts()(tree, new VFile({ value: src, path: "/contents/a/post.md" }));
        // どの blockquote も、div のまま残らない（コールアウトは別の要素になり、それ以外は blockquote に戻る）
        const stuck = before.filter(
          (n) =>
            n.tagName === "div" &&
            !(
              Array.isArray(n.properties.className) &&
              n.properties.className.some((c) => typeof c === "string" && c.includes("callout"))
            )
        );
        if (stuck.length) throw new Error(`blockquote left as <div>: ${JSON.stringify(stuck[0])}`.slice(0, 300));
      }),
      runs(30000)
    );
  }, 900_000);
  it("arbitrary hast trees never throw", async () => {
    await assertProperty(
      fc.property(fc.array(rnd, { maxLength: 4 }), (children) => {
        const tree: Root = {
          type: "root",
          children: [{ type: "element", tagName: "blockquote", properties: {}, children }],
        };
        callouts()(tree, new VFile({ path: "/contents/a/post.md" }));
      }),
      runs(50000)
    );
  }, 900_000);
  it("noop", () => {
    expect(1).toBe(1);
  });
});
