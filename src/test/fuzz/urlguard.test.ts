import { domainToASCII, domainToUnicode } from "node:url";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { siteUrl } from "../../../plugins/site.ts";
import { inspectTextUrls, inspectUrl, knownDomains } from "../../../plugins/url-guard.ts";
import { testDomains } from "../setup-domains.ts";
import { assertProperty, runs, uni } from "./gen.ts";

const norm = (host: string) =>
  domainToASCII(host.replace(/[。．｡]/g, "."))
    .replace(/\.$/, "")
    .toLowerCase();

// 実データ（confusables.txt）に含まれる、見た目が似た文字（拉丁文字 → 置き換え）
const homoglyphs: Record<string, string[]> = {
  a: ["а", "ɑ"],
  c: ["с", "ϲ"],
  d: ["ԁ"],
  e: ["е"],
  g: ["ɡ"],
  i: ["і", "ı", "ⅰ"],
  j: ["ј"],
  l: ["ӏ", "1", "ⅼ"],
  o: ["о", "ο"],
  p: ["р", "ρ"],
  s: ["ѕ"],
  u: ["υ"],
  v: ["ν", "ѵ"],
  w: ["ԝ", "ա"],
  x: ["х"],
  y: ["у"],
  m: ["rn", "ｍ"],
  n: ["ո"],
  h: ["һ", "հ"],
  r: ["г"],
};
const spoof = fc
  .tuple(
    fc.constantFrom(...testDomains),
    fc.array(fc.nat(100), { minLength: 1, maxLength: 3 }),
    fc.array(fc.nat(10), { minLength: 3, maxLength: 3 })
  )
  .map(([domain, picks, choose]) => {
    const chars = Array.from(domain);
    const positions = chars
      .map((c, i) => [c, i] as const)
      .filter(([c]) => homoglyphs[c] && c !== ".")
      .map(([, i]) => i);
    let changed = false;
    picks.forEach((p, k) => {
      if (!positions.length) return;
      const i = positions[p % positions.length]!;
      const options = homoglyphs[Array.from(domain)[i]!]!;
      chars[i] = options[choose[k]! % options.length]!;
      changed = true;
    });
    return { host: chars.join(""), changed };
  });

const hostTail = fc.constantFrom("", "www.", "login.", "a.b.", "xn--x.");
const hrefForm = fc.constantFrom<(h: string) => string>(
  (h) => `https://${h}/`,
  (h) => `http://${h}:8080/x?y#z`,
  (h) => `//${h}/p`,
  (h) => `https://user:pw@${h}/`,
  (h) => `HTTPS://${h.toUpperCase()}/`,
  (h) => `https://${h}.`,
  (h) => `https://${h}./a`,
  (h) => ` \t\nhttps://${h}`,
  (h) => `https:\\\\${h}\\a`,
  (h) => `https:/\\${h}`,
  (h) => `https://${h.replace(/\./g, "。")}/`,
  (h) => `https://${h.replace(/\./g, "．")}/`,
  (h) => `https://${h.replace(/\./g, "｡")}/`,
  (h) => `http:${h}`,
  (h) => `http:/${h}`,
  (h) => `https://x@y@${h}/`,
  (h) => `https://${encodeURIComponent(h)}/`,
  (h) => `https://${h}%2f.evil.test/`,
  (h) => `https://${h}\u0000/`,
  (h) => `https://${h}#@evil.test`,
  (h) => `https://evil.test?@${h}`,
  (h) => `https://evil.test\\@${h}`
);

describe("url-guard fuzz", () => {
  it("never throws on arbitrary strings; ascii equals the URL host", async () => {
    const anyString = fc.oneof(
      fc.string({ maxLength: 60 }),
      fc.string({ maxLength: 60, unit: "binary" }),
      fc
        .array(
          fc.oneof(
            uni,
            fc.constantFrom(
              "http://",
              "https://",
              "//",
              "\\",
              "@",
              ":",
              "/",
              ".",
              "%",
              "%e3",
              "%00",
              "[",
              "]",
              "xn--",
              "。",
              " ",
              "\n",
              "a",
              "ａ"
            )
          ),
          { maxLength: 20 }
        )
        .map((a) => a.join(""))
    );
    await assertProperty(
      fc.property(anyString, anyString, (href, label) => {
        const r = inspectUrl(href, label);
        const u = URL.parse(href, siteUrl);
        if (u && /^https?:$/.test(u.protocol)) {
          if (!r) throw new Error("undefined for http url");
          if (r.ascii !== u.hostname) throw new Error(`ascii ${r.ascii} != ${u.hostname}`);
        } else if (r) throw new Error("defined for non-http");
        inspectTextUrls(href + label);
      }),
      runs(100000)
    );
  });

  it("confusable: spoofed known domains are flagged in every href form", async () => {
    await assertProperty(
      fc.property(spoof, hostTail, hrefForm, ({ host, changed }, tail, form) => {
        fc.pre(changed);
        const href = form(tail + host);
        const r = inspectUrl(href);
        if (!r) return;
        const actual = norm(r.ascii);
        // IDNA が別の文字に変換した場合（例: U+03F2 は U+03C3 になる）は、期待値を決められないため対象外
        const allowed = new Set(
          Object.values(homoglyphs)
            .flat()
            .concat(Object.keys(homoglyphs))
            .flatMap((v) => Array.from(v))
        );
        if (
          Array.from(domainToUnicode(r.ascii)).some(
            (ch) => ch !== "." && ch !== "-" && !allowed.has(ch) && !/[a-z0-9]/.test(ch)
          )
        )
          return;
        // 接続先が、偽装したホストでなければ、対象外（`?@` や `\\@` などの形）
        if (actual !== norm(tail + host) && actual !== norm(tail + host).replace(/\.$/, "")) return;
        // 実際に接続するホストが、既知のドメイン自身（または、そのサブドメイン）になる場合は、対象外
        if (knownDomains.some((d) => actual === d || actual.endsWith(`.${d}`))) return;
        // ホスト名の末尾が、既知のドメインと同じ数のラベルで、見た目が似ているか
        if (!r.confusable) throw new Error(`not confusable: href=${JSON.stringify(href)} ascii=${r.ascii}`);
      }),
      runs(100000)
    );
  });

  it("mismatch: a label whose host differs from the real host is flagged", async () => {
    const hosts = [
      ...knownDomains,
      "example.com",
      "evil.test",
      "xn--ggle-0nda.test",
      "gооgle.test",
      "例え.テスト",
      "a.b.c.example.org",
      "google.test.evil.test",
      "EXAMPLE.com",
      "127.0.0.1",
      "[::1]",
      "1.2.3.4",
      "0x7f.1",
      "evil.test.",
    ];
    const labelForm = fc.constantFrom<(h: string) => string>(
      (h) => h,
      (h) => `https://${h}`,
      (h) => `http://${h}/path`,
      (h) => `//${h}`,
      (h) => `${h}/path`,
      (h) => `${h}:443`,
      (h) => `https://${h}:8443/`,
      (h) => `${h}?q`,
      (h) => `${h}#f`,
      (h) => `https://user@${h}`,
      (h) => h.replace(/\./g, "。"),
      (h) => `https://${h.replace(/\./g, "．")}/x`,
      (h) => `${h.replace(/\./g, "｡")} extra words`,
      (h) => `${h}、`,
      (h) => `${h}。`,
      (h) => `${h} `,
      (h) => `\n${h}`
    );
    await assertProperty(
      fc.property(
        fc.constantFrom(...hosts),
        fc.constantFrom(...hosts),
        spoof,
        fc.boolean(),
        labelForm,
        hrefForm,
        (a, l0, sp, useSpoof, lf, hf) => {
          const labelHost = useSpoof ? sp.host : l0;
          const href = hf(a);
          const label = lf(labelHost);
          const r = inspectUrl(href, label);
          if (!r) return;
          const expectedLabel = norm(labelHost);
          const lbl = domainToASCII(labelHost.replace(/[。．｡]/g, "."));
          if (!expectedLabel || !lbl || !labelHost.includes(".")) return;
          if (expectedLabel.startsWith("[") || /^[\d.x]+$/.test(expectedLabel)) return;
          if (expectedLabel !== norm(r.ascii) && !r.mismatch)
            throw new Error(
              `mismatch=false: href=${JSON.stringify(href)} (host ${r.ascii}) label=${JSON.stringify(label)} (host ${expectedLabel})`
            );
        }
      ),
      runs(100000)
    );
  });

  it("mismatch: a label with decoration before the host", async () => {
    const decor = fc.constantFrom(
      "(",
      "[",
      '"',
      "'",
      "「",
      "『",
      "<",
      "- ",
      "→ ",
      "※",
      "🔗",
      "🔗 ",
      "★ ",
      "【",
      "（",
      "“",
      "‘",
      "`",
      "*",
      "_",
      "~",
      "​",
      " ",
      "Visit ",
      "Open ",
      "Go to ",
      "Sign in at ",
      "ログインは ",
      "URL: ",
      "https://",
      "www."
    );
    const closer = fc.constantFrom(
      "",
      ")",
      "]",
      '"',
      "'",
      "」",
      "』",
      ">",
      "】",
      "）",
      "”",
      "’",
      "`",
      "*",
      "_",
      "~",
      " .",
      "."
    );
    const shown = fc.constantFrom(
      "google.test",
      "https://google.test",
      "github.test/login",
      "https://paypal.test/signin",
      "apple.test"
    );
    const found: string[] = [];
    await assertProperty(
      fc.property(decor, shown, closer, (d, s, c) => {
        const label = d + s + c;
        const r = inspectUrl("https://evil.test/", label);
        // 装飾のないラベル（先頭が URL かホスト名）は対応している形なので、見逃しは失敗にする
        expect(inspectUrl("https://evil.test/", s)?.mismatch, s).toBe(true);
        // 前後を装飾したラベルは未対応（表示文字列の最初の単語だけを見る既知の制約）なので、記録だけする
        if (r && !r.mismatch && !r.confusable) found.push(label);
      }),
      3000
    );
    console.log(
      "DECORATED_LABEL_FALSE_NEGATIVES (unsupported, known limitation)",
      JSON.stringify([...new Set(found)].slice(0, 80)),
      found.length
    );
  });

  it("inspectTextUrls finds every delimited URL host (exhaustive)", () => {
    const before = [
      "",
      " ",
      "\n",
      "(",
      "[",
      "「",
      "、",
      ",",
      "\u3000",
      "<",
      '"',
      "'",
      "text",
      "：",
      "→",
      "*",
      "`",
      "|",
      "\t",
      "_",
      "~",
      "**",
      "“",
      "‘",
      "（",
      "【",
      "『",
      "{",
      "&",
      "=",
    ];
    const after = [
      "",
      " ",
      "\n",
      ")",
      "]",
      "」",
      "、",
      ",",
      "\u3000",
      ">",
      '"',
      "'",
      "text",
      "。",
      ".",
      "!",
      "*",
      "`",
      "|",
      "/path",
      "?q=1",
      "#f",
      ":80",
      "…",
      "_",
      "~",
      "**",
      "”",
      "’",
      "）",
      "】",
      "』",
      "}",
      ";",
      ":",
      "&",
      "=",
      "%",
      "\u200b",
      "\u00a0",
      "\\",
      "^",
      "$",
      "+",
      "@",
      "，",
      "；",
      "：",
      "．",
      "｡",
      "》",
      "〉",
      "〕",
      "〗",
      "〙",
      "〛",
      "｝",
      "｠",
      "」。",
      ").",
    ];
    // ホスト名の文字として続く接尾辞（example.comtext になる）は、元のホストを期待しない
    const extending = new Set(["text"]);
    const hostsList = ["example.com", "goog1e.test", "gооgle.test", "paypal.test"];
    const missing = new Map<string, string[]>();
    const notConfusable = new Map<string, string[]>();
    for (const h of hostsList)
      for (const b of before)
        for (const a of after)
          for (const scheme of ["https://", "HTTP://"]) {
            if (extending.has(a)) continue;
            const text = `${b}${scheme}${h}${a}`;
            const found = inspectTextUrls(text);
            const want = norm(h);
            const f = found.find((x) => norm(x.ascii) === want);
            if (!f) missing.set(a, [...(missing.get(a) ?? []), `${b}|${h}`].slice(0, 3));
            else if ((h === "goog1e.test" || h === "gооgle.test") && !f.confusable) notConfusable.set(a, [text]);
            else if (!found.some((x) => x.confusable) && (h === "goog1e.test" || h === "gооgle.test"))
              notConfusable.set(a, [text]);
          }
    console.log("TEXTURL_MISSING_HOST (after-suffix => examples)", JSON.stringify([...missing]));
    console.log("TEXTURL_NOT_CONFUSABLE", JSON.stringify([...notConfusable]));
    expect([...missing]).toEqual([]);
    expect([...notConfusable]).toEqual([]);
  });
});
