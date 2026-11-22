import { parseMarkdown } from "@nuxtjs/mdc/runtime/parser/index";
import { icons } from "lucide";
import { describe, expect, it, vi } from "vitest";

import lucide from "../../../plugins/rehype-lucide.ts";
import { renderMarkdownPreview } from "../../../plugins/rehype-markdown-preview.ts";
import sanitize from "../../../plugins/rehype-sanitize.ts";
import postMeta from "../../../plugins/remark-post-meta.ts";
import { tocWithIcons } from "../../server/utils/toc.ts";
import { lucideElements } from "../../shared/utils/lucide.ts";

const parse = (source: string) =>
  parseMarkdown(
    source,
    {
      remark: { plugins: { postMeta: { instance: postMeta } } },
      rehype: {
        plugins: {
          "rehype-raw": {},
          sanitize: { instance: sanitize, options: { contents: "/contents" } },
          lucide: { instance: lucide, options: { contents: "/contents" } },
        },
      },
      toc: { depth: 3, searchDepth: 3 },
    },
    { fileOptions: { path: "/contents/writer/post.md" } }
  );

describe("Lucide icons", () => {
  it.each([
    ["xs", "0.75em"],
    ["sm", "0.875em"],
    ["base", "1em"],
    ["lg", "1.125em"],
    ["xl", "1.25em"],
    ["2xl", "1.5em"],
  ])("accepts size %s", async (size, expected) => {
    expect(JSON.stringify((await parse(`:icon{name="rocket" size="${size}"}`)).body)).toContain(
      `"width":"${expected}"`
    );
  });
  it.each(["0", "24px", "1.5em", "2", "1em;color:red"])("warns for invalid size %s", async (size) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(JSON.stringify((await parse(`:icon{name="rocket" size="${size}"}`)).body)).toContain('"width":"1em"');
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  });
  it("ignores sizes in headings", async () => {
    for (const heading of ["#", "##", "###", "####", "#####", "######"]) {
      const result = await parse(`${heading} Before **:icon{name="rocket" size="2xl"}** After`);
      expect(JSON.stringify(result.body)).toContain('"width":"1em"');
    }
  });
  it("renders heading icons in their original position in the table of contents", async () => {
    const result = await parse('## Before :icon{name="rocket" size="2xl" label="Launch"}after');
    if (!result.toc) throw new Error("TOC not found");
    const links = tocWithIcons(result.toc.links, [
      [
        "h2",
        { id: result.toc.links[0]!.id },
        "Before ",
        ["svg", { className: ["lucide-inline"] }, ["path", { d: "M1 2" }]],
        "after",
      ],
    ]);
    const parts = links[0]?.parts;
    expect(parts?.[0]).toEqual({ text: "Before " });
    expect(parts?.[1]).toHaveProperty("svg", expect.stringContaining('aria-hidden="true"'));
    expect(parts?.[1]).toHaveProperty("svg", expect.stringContaining('width="1em"'));
    expect(parts?.[2]).toEqual({ text: "after" });
    expect(JSON.stringify(parts)).not.toContain("Launch");
  });
  it("preserves every element of the database icon in the table of contents", () => {
    const icon = icons.Database.map(([tag, attrs]) => [tag, attrs]);
    const links = tocWithIcons(
      [{ id: "database", depth: 2, text: "Database" }],
      [["h2", { id: "database" }, ["svg", { className: ["lucide-inline"] }, ...icon]]]
    );
    const svg = (links[0]?.parts?.[0] as { svg: string }).svg;
    for (const [tag] of icons.Database) expect(svg).toContain(`<${tag}`);
    expect(svg).toContain("<ellipse");
    const filled = icons.BrainCircuit.map(([tag, attrs]) => [tag, attrs]);
    const filledLinks = tocWithIcons(
      [{ id: "brain", depth: 2, text: "Brain" }],
      [["h2", { id: "brain" }, ["svg", { className: ["lucide-inline"] }, ...filled]]]
    );
    expect((filledLinks[0]?.parts?.[0] as { svg: string }).svg).toContain('fill="currentColor"');
  });
  it("allows every element used by Lucide icons", () => {
    for (const icon of Object.values(icons)) {
      for (const [tag] of icon) expect(lucideElements.has(tag)).toBe(true);
    }
  });
  it("retains image alt text next to an icon in the table of contents", () => {
    const links = tocWithIcons(
      [{ id: "heading", depth: 2, text: "Description" }],
      [
        [
          "h2",
          { id: "heading" },
          ["svg", { className: ["lucide-inline"] }, ["path", { d: "M1 2" }]],
          ["img", { alt: "Description" }],
        ],
      ]
    );
    expect(links[0]?.parts?.at(-1)).toEqual({ text: "Description" });
  });
  it("uses the icon label for a table of contents item without text", () => {
    const links = tocWithIcons(
      [{ id: "icon", depth: 2, text: "" }],
      [
        [
          "h2",
          { id: "icon" },
          ["svg", { className: ["lucide-inline"], "aria-label": "Launch" }, ["path", { d: "M1 2" }]],
        ],
      ]
    );
    expect(links[0]?.iconLabel).toBe("Launch");
  });
  it("renders inline icons in Markdown and keeps heading and excerpt text clean", async () => {
    const result = await parse(
      '## Heading :icon{name="rocket"}\n\nText :icon{name="rocket"} and :icon{name="circle-check" label="Complete"}.'
    );
    const body = JSON.stringify(result.body);
    expect(body).toContain('"tag":"svg"');
    expect(body).toContain('"width":"1em"');
    expect(body).toContain('"stroke":"currentColor"');
    expect(body).toContain('"ariaHidden":"true"');
    expect(body).toContain('"ariaLabel":"Complete"');
    expect(body).toContain('"role":"img"');
    expect(JSON.stringify(result.toc)).not.toMatch(/rocket|circle-check|Complete/);
    expect(result.data.description).not.toMatch(/rocket|circle-check|Complete/);
  });

  it("warns and drops unknown icons and ignores arbitrary attributes", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await parse(
        ':icon{name="missing-icon"} :icon{name="rocket" style="color:red" onclick="alert(1)" width="999"}'
      );
      const body = JSON.stringify(result.body);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("contents/authors/writer/post.md"));
      expect(body.match(/"tag":"svg"/g)).toHaveLength(1);
      expect(body).not.toMatch(/onclick|color:red|999|missing-icon/);
    } finally {
      warning.mockRestore();
    }
  });

  it("leaves the syntax literal in Markdown previews", async () => {
    expect(await renderMarkdownPreview(':icon{name="rocket"}')).toContain(':icon{name="rocket"}');
    expect(await renderMarkdownPreview(':icon{name="rocket"}')).not.toContain("<svg");
  });

  it("does not count icon names or labels toward reading time", async () => {
    const result = await parse(`${"読".repeat(495)} :icon{name="rocket" label="${"x".repeat(100)}"}`);
    expect(result.data.readingTime).toBe(1);
  });
});
