import { h } from "hastscript";
import { describe, expect, it, vi } from "vitest";

import { beforeParse } from "../../../plugins/content-hook.ts";
import unicodeGuard from "../../../plugins/rehype-unicode-code.ts";
import { cleanTextUnicode, cleanUnicode, cleanUrlUnicode, skeleton } from "../../../plugins/unicode.ts";

describe("invisible characters", () => {
  it("removes controls and makes them visible in code", () => {
    for (const cp of [
      0x034f, 0x2063, 0x202e, 0x2066, 0x200e, 0x61c, 0xe0001, 0x200b, 0x2060, 0xfeff, 0x180e, 0x01, 0x7f, 0xad, 0x115f,
      0x1160, 0x3164, 0xffa0, 0x2800,
    ]) {
      const character = String.fromCodePoint(cp);
      expect(cleanUnicode(`a${character}b`).value).toBe("ab");
      expect(cleanUnicode(`a${character}b`, true).value).toContain(
        `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`
      );
    }
  });
  it("preserves emoji sequences and rejects stray joiners and selectors", () => {
    const flag = `🏴${String.fromCodePoint(0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f)}`;
    for (const value of ["👩‍💻", "👩🏽‍💻", "👨🏿‍⚕️", "1️⃣", "क्‍ष", "بَ‍ب", "ക്‍", "漢\u{E0100}", "❤️", flag])
      expect(cleanUnicode(value).value).toBe(value);
    expect(cleanUnicode("a\u200db").value).toBe("ab");
    expect(cleanUnicode("😀\u200c😀").value).toBe("😀😀");
    expect(cleanUnicode("ب\u200dक").value).toBe("بक");
    expect(cleanUnicode("漢\u{E0100}\u{E0101}").value).toBe("漢\u{E0100}");
    expect(cleanUnicode("👩‍💻", true).value).toContain("U+200D");
  });
  it("removes a joiner whose neighbour is removed, in one pass", () => {
    // U+061C は取り除かれるので、その前の ZWJ・ZWNJ も残らない（fuzzing で見つかった、2 回目で結果が変わる入力）
    for (const input of ["\uFB50\u200D\u061C", "\u0627\u200C\u061C"]) {
      const once = cleanTextUnicode(input).value;
      expect(once, input).not.toMatch(/[\u200c\u200d]/);
      expect(cleanTextUnicode(once).value).toBe(once);
    }
  });
  it("cleans percent-encoded invisible characters without decoding reserved bytes", () => {
    expect(cleanUrlUnicode("https://example.com/%FF%E2%80%8B%2F")).toEqual({
      value: "https://example.com/%FF%2F",
      changed: true,
    });
    const emoji = "https://example.com/%F0%9F%91%A9%E2%80%8D%F0%9F%92%BB";
    expect(cleanUrlUnicode(emoji)).toEqual({ value: emoji, changed: false });
    const mixed = "https://example.com/👩%E2%80%8D💻";
    expect(cleanUrlUnicode(mixed)).toEqual({ value: mixed, changed: false });
    const mixedReverse = "https://example.com/%F0%9F%91%A9‍%F0%9F%92%BB";
    expect(cleanUrlUnicode(mixedReverse)).toEqual({ value: mixedReverse, changed: false });
    expect(cleanTextUnicode(`Link ${mixedReverse} here`).value).toBe(`Link ${mixedReverse} here`);
    const anchor = h("a", { href: mixedReverse }, "link");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const tree = { type: "root" as const, children: [anchor] };
    unicodeGuard()(tree, { path: "contents/a/post.md" } as never);
    expect(anchor.properties.href).toBe(mixedReverse);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    const two = "https://example.com/a%E2%80%8D👩%E2%80%8D💻";
    expect(cleanUrlUnicode(two)).toEqual({ value: "https://example.com/a👩%E2%80%8D💻", changed: true });
  });
  it("makes invisible characters visible in the copied code of a pre, like the displayed code", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const pre = h("pre", { code: "a\u202eb" }, [h("code", "a\u202eb")]);
    unicodeGuard()({ type: "root" as const, children: [pre] }, { path: "contents/a/post.md" } as never);
    const shown = pre.children[0]?.type === "element" ? pre.children[0].children[0] : undefined;
    expect(shown).toMatchObject({ value: "a⟨U+202E⟩b" });
    expect(pre.properties.code).toBe("a⟨U+202E⟩b");
    // 変化のないコードは、そのまま
    const plain = h("pre", { code: "a b" }, [h("code", "a b")]);
    unicodeGuard()({ type: "root" as const, children: [plain] }, { path: "contents/a/post.md" } as never);
    expect(plain.properties.code).toBe("a b");
    warn.mockRestore();
  });
  it("updates encoded references and ARIA references after an ID collision", () => {
    const plain = h("span", { id: "ab" });
    const invisible = h("span", { id: "a\u200bb" });
    const link = h("a", { href: "#a%E2%80%8Bb", ariaDescribedBy: ["a\u200bb"] });
    const tree = { type: "root" as const, children: [plain, invisible, link] };
    unicodeGuard()(tree, { path: "post.md" } as never);
    expect(invisible.properties.id).toBe("ab-safe-2");
    expect(link.properties.href).toBe("#ab-safe-2");
    expect(link.properties.ariaDescribedBy).toEqual(["ab-safe-2"]);
  });
  it("matches common Cyrillic lookalikes", () => {
    expect(skeleton("pаypal")).toBe(skeleton("paypal"));
    expect(skeleton("m")).toBe(skeleton("rn"));
    expect(skeleton("A")).not.toBe(skeleton("a"));
    expect(skeleton("é")).toBe(skeleton("e\u0301"));
  });
});

it("cleans prose before parsing while preserving code", () => {
  const file = { path: "contents/test/post.md", body: "# a&#x202e;b\n\n`x\u202ey`\n" };
  beforeParse({ file });
  expect(file.body).toBe("# ab\n\n`x\u202ey`\n");
  const profile = { path: "contents/test/profile.yaml", body: '"na\\u200bme": "A\\u202eB"\n' };
  beforeParse({ file: profile });
  expect(profile.body).toContain('"name": "AB"');
  const frontmatter = { path: "contents/test/post.md", body: '---\n"ti\\u200btle": "A\\u202eB"\n---\nBody\n' };
  beforeParse({ file: frontmatter });
  expect(frontmatter.body).toContain('"title": "AB"');
  const htmlCode = { path: "contents/test/post.md", body: "<code>a&#x202e;b</code>\n<pre>x\u200by</pre>" };
  beforeParse({ file: htmlCode });
  expect(htmlCode.body).toBe("<code>a&#x202e;b</code>\n<pre>x\u200by</pre>");
  const htmlComment = { path: "contents/test/post.md", body: "<pre>one <!-- </pre> --> two\u200b</pre>after\u200b" };
  beforeParse({ file: htmlComment });
  expect(htmlComment.body).toBe("<pre>one <!-- </pre> --> two\u200b</pre>after");
});
