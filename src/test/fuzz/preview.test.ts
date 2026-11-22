import fc from "fast-check";
import { fromHtml } from "hast-util-from-html";
import { describe, expect, it, vi } from "vitest";

import { renderMarkdownPreview } from "../../../plugins/rehype-markdown-preview.ts";
import { markdown, mutated, runs } from "./gen.ts";
import { htmlViolations, invisibleViolations } from "./safety.ts";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn().mockRejectedValue(new Error("offline")) }));
vi.spyOn(console, "warn").mockImplementation(() => undefined);

const invisibles: (readonly [string, string])[] = [];
let maxMs = 0;
const slow: { ms: number; len: number }[] = [];

describe("renderMarkdownPreview fuzz", () => {
  it("zz report", () => {
    console.log("MAX_RENDER_MS", Math.round(maxMs));
  });
  it("never throws and output is safe", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(markdown, mutated), async (src) => {
        const html = await renderMarkdownPreview(src);
        const v = htmlViolations(html);
        expect(v).toEqual([]);
        if (!src.includes("\\char"))
          invisibles.push(...invisibleViolations(fromHtml(html, { fragment: true })).map((m) => [src, m] as const));
      }),
      { numRuns: runs(20000) }
    );
    invisibles.sort((a, b) => a[0].length - b[0].length);
    console.log("INVISIBLE_LEAKS", invisibles.length, JSON.stringify(invisibles.slice(0, 5)));
  }, 1_800_000);

  it("frontmatter regex does not backtrack catastrophically", async () => {
    const line = fc.constantFrom(
      "a: b",
      "",
      "-",
      "--",
      "---",
      "--- ",
      "---\t",
      "- - -",
      "x".repeat(50),
      "﻿---",
      "\r",
      " ---"
    );
    const nl = fc.constantFrom("\n", "\r\n", "\r", "\n\r", "\r\r\n", "");
    const prefix = fc.constantFrom("---", "﻿---", "--- ", "---\t", "---\r", "--");
    await fc.assert(
      fc.asyncProperty(
        prefix,
        fc.array(fc.tuple(line, nl), { minLength: 0, maxLength: 4000 }),
        fc.integer({ min: 0, max: 3 }),
        async (p, lines, mode) => {
          await Promise.resolve();
          let src = `${p}\n${lines.map(([l, n]) => l + n).join("")}`;
          if (mode === 1) src = `${p}\n${"a\n".repeat(10000)}`; // unclosed, large
          if (mode === 2) src = `${p}\n${"--- x\n".repeat(3000)}`;
          if (src.length > 20000) src = src.slice(0, 20000);
          const t = performance.now();
          const re = /^﻿?---[ \t]*(?:\r\n|\r(?!\n)|\n)(?:[^\r\n]*(?:\r\n|\r(?!\n)|\n))*?---[ \t]*(?:\r\n|\r(?!\n)|\n|$)/;
          re.exec(src);
          const ms = performance.now() - t;
          if (ms > 50) slow.push({ ms, len: src.length });
          // CI のランナーの混雑で落ちないよう、上限はかなり緩くする（爆発的なバックトラックは秒単位以上になるので検出できる）
          expect(ms).toBeLessThan(1000);
        }
      ),
      { numRuns: runs(20000) }
    );
  }, 900_000);

  it("whole-call timing on <=20KB inputs", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.constantFrom(
            "> ",
            "- ",
            "* ",
            "1. ",
            "[",
            "](",
            ")",
            "<",
            ">",
            "`",
            "``",
            "$",
            "$$",
            "*",
            "**",
            "_",
            "__",
            "~",
            "~~",
            "|",
            "\\",
            "&",
            "![",
            "x",
            " ",
            "\n",
            "  ",
            "\t",
            "<a>",
            "</a>",
            "[^1]",
            "[x]: ",
            "http://a.b",
            "www.a.b",
            "a@b.c",
            "https://",
            "<!--",
            "-->"
          ),
          { minLength: 1, maxLength: 4000 }
        ),
        async (parts) => {
          const src = parts.join("").slice(0, 20000);
          const t = performance.now();
          await renderMarkdownPreview(src);
          const ms = performance.now() - t;
          maxMs = Math.max(maxMs, ms);
          if (ms > 250) slow.push({ ms, len: src.length });
          expect(ms, JSON.stringify(src.slice(0, 200))).toBeLessThan(10_000);
        }
      ),
      { numRuns: runs(5000) }
    );
  }, 900_000);
});
