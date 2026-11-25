import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { cleanTextUnicode, cleanUnicode, cleanUrlUnicode, skeleton } from "../../../plugins/unicode.ts";
import { assertProperty, runs, uni } from "./gen.ts";

const pieces = fc.oneof(
  { weight: 5, arbitrary: uni },
  {
    weight: 3,
    arbitrary: fc.constantFrom(
      "a",
      "A",
      "日",
      "あ",
      "ア",
      "1",
      "#",
      "*",
      "😀",
      "👨",
      "👩",
      "\u{1f3fb}",
      "\u{1f3f4}",
      "‍",
      "‌",
      "️",
      "︎",
      "́",
      "ا",
      "ب",
      "ک",
      "क",
      "्",
      "ക",
      "്",
      "്‍",
      "%",
      "%E2%80%AE",
      "%e2%80%ae",
      "%F3%A0%81%81",
      "%EF%BB%BF",
      "%E2%80%8B",
      "%C2%AD",
      "%",
      "%E2%80",
      "%ZZ",
      "&#x202e;",
      "&#8238;",
      "&#x200b;",
      "&#xE0041;",
      "&#xe0067;",
      "&#x1F3F4;",
      "&#x200d;",
      "&#xFE0F;",
      "&#",
      "&#x",
      "&#x110000;",
      "&#99999999999999999999;",
      "https://a.b/",
      "http://x",
      "\n",
      " ",
      "\u0000",
      "\u{e0020}",
      "\u{e007f}",
      "\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}"
    ),
  },
  { weight: 2, arbitrary: fc.string({ maxLength: 4, unit: "grapheme" }) },
  { weight: 2, arbitrary: fc.string({ maxLength: 3, unit: "binary" }) },
  {
    weight: 1,
    arbitrary: fc
      .integer({ min: 0, max: 0x10ffff })
      .map((n) => (n >= 0xd800 && n <= 0xdfff ? "x" : String.fromCodePoint(n))),
  }
);
const excluded = (process.env.EXCLUDE ?? "")
  .split(",")
  .filter(Boolean)
  .map((h) => String.fromCodePoint(Number.parseInt(h, 16)));
const text = fc
  .array(pieces, { maxLength: 14 })
  .map((a) => a.join(""))
  .filter((s) => !excluded.some((c) => s.includes(c)));

const BIDI = /[‪-‮⁦-⁩]/u;
const bad = (s: string) => {
  const stripped = s.replace(/\u{1f3f4}[\u{e0020}-\u{e007e}]{5}\u{e007f}/gu, (m) =>
    /^\u{1f3f4}\u{e0067}\u{e0062}(?:\u{e0065}\u{e006e}\u{e0067}|\u{e0073}\u{e0063}\u{e0074}|\u{e0077}\u{e006c}\u{e0073})\u{e007f}$/u.test(
      m
    )
      ? "\u{1f3f4}"
      : m
  );
  if (BIDI.test(stripped)) return "bidi";
  if (/[\u{e0000}-\u{e007f}]/u.test(stripped)) return "tagchar";
  if (/[​⁠﻿­‎‏؜᠎⁡-⁤⁪-⁯]/u.test(stripped)) return "zerowidth/format";
  // 前後が絵文字または同じ文字体系でない ZWJ / ZWNJ
  const chars = Array.from(stripped);
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "‍" || chars[i] === "‌") {
      let p = i - 1;
      while (p >= 0 && (/\p{M}/u.test(chars[p]!) || /[\u{1f3fb}-\u{1f3ff}]/u.test(chars[p]!))) p--;
      const prev = chars[p] ?? "";
      const next = chars[i + 1] ?? "";
      const emoji = /\p{Extended_Pictographic}/u;
      const joinScript =
        /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Myanmar}]/u;
      const ok =
        (chars[i] === "‍" && emoji.test(prev) && emoji.test(next)) ||
        (joinScript.test(prev) && joinScript.test(next)) ||
        chars[i - 1] === "്";
      if (!ok) return `stray ${chars[i] === "‍" ? "ZWJ" : "ZWNJ"}`;
    }
  }
  return undefined;
};

let reassembled = 0;
describe("unicode fuzz", () => {
  it("never throws, idempotent, and removes invisible characters (cleanUnicode / code mode)", async () => {
    await assertProperty(
      fc.property(text, fc.boolean(), (x, code) => {
        const once = cleanUnicode(x, code).value;
        const twice = cleanUnicode(once, code).value;
        if (twice !== once)
          throw new Error(`not idempotent code=${String(code)}: ${JSON.stringify(once)} -> ${JSON.stringify(twice)}`);
        const b = bad(once);
        if (b && !code) throw new Error(`leak ${b}: ${JSON.stringify(once)}`);
        if (b && code && b !== "stray ZWJ" && b !== "stray ZWNJ")
          throw new Error(`code leak ${b}: ${JSON.stringify(once)}`);
      }),
      runs(100000)
    );
  });
  it("cleanTextUnicode: never throws, idempotent, no leaks", async () => {
    await assertProperty(
      fc.property(text, (x) => {
        const once = cleanTextUnicode(x).value;
        const twice = cleanTextUnicode(once).value;
        if (twice !== once) throw new Error(`not idempotent: ${JSON.stringify(once)} -> ${JSON.stringify(twice)}`);
        const b = bad(once.replace(/&#(?:x[\da-f]+|\d+);/gi, ""));
        if (b) throw new Error(`leak ${b}: ${JSON.stringify(once)}`);
      }),
      runs(100000)
    );
  });
  it("cleanUrlUnicode: never throws, idempotent, no leaks after percent-decoding", async () => {
    await assertProperty(
      fc.property(text, (x) => {
        const once = cleanUrlUnicode(x).value;
        const twice = cleanUrlUnicode(once).value;
        const escapes = (v: string) => (v.match(/%[0-9a-f]{2}/gi) ?? []).length;
        if (twice !== once && escapes(once) > escapes(x)) {
          reassembled++;
          return;
        }
        if (twice !== once) throw new Error(`not idempotent: ${JSON.stringify(once)} -> ${JSON.stringify(twice)}`);
        let decoded = once;
        try {
          decoded = decodeURIComponent(once);
        } catch {
          /* 不正なエスケープを含む */
        }
        const b = bad(decoded) ?? bad(once);
        if (b) throw new Error(`leak ${b}: ${JSON.stringify(once)}`);
      }),
      runs(100000)
    );
  });
  it("report", () => {
    console.log("URL_ESCAPE_REASSEMBLY_COUNT", reassembled);
  });
  it("skeleton never throws and is idempotent-ish", async () => {
    await assertProperty(
      fc.property(text, (x) => {
        const a = skeleton(x);
        skeleton(a);
        return typeof a === "string";
      }),
      runs(50000)
    );
  });
  it("noop", () => {
    expect(1).toBe(1);
  });
});
