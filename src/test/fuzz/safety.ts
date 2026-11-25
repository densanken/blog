import { fromHtml } from "hast-util-from-html";
import { toString } from "hast-util-to-string";

import type { Element, Root } from "hast";

const forbiddenTags = new Set([
  "script",
  "iframe",
  "object",
  "embed",
  "img",
  "style",
  "form",
  "base",
  "meta",
  "link",
  "foreignobject",
  "use",
  "animate",
  "set",
  "animatetransform",
  "input",
  "button",
  "textarea",
  "select",
  "frame",
  "frameset",
  "applet",
  "audio",
  "video",
  "source",
  "track",
  "canvas",
  "template",
  "noscript",
  "image",
  "feimage",
]);
const stripUrl = (v: string) =>
  Array.from(v)
    .filter((c) => {
      const n = c.codePointAt(0)!;
      return !(
        n <= 0x20 ||
        (n >= 0x7f && n <= 0x9f) ||
        (n >= 0x200b && n <= 0x200f) ||
        (n >= 0x2028 && n <= 0x202e) ||
        (n >= 0x2060 && n <= 0x2069) ||
        n === 0xfeff
      );
    })
    .join("")
    .toLowerCase();

export interface Options {
  allowIframe?: (src: string) => boolean;
  allowImg?: (src: string) => boolean;
  allowedIds?: RegExp;
  allowStyle?: RegExp;
  allowRelative?: boolean;
}

export const violations = (tree: Root, opts: Options = {}) => {
  const out: string[] = [];
  const inClass = (stack: Element[], re: RegExp) =>
    stack.some((e) => (Array.isArray(e.properties.className) ? e.properties.className : []).some((c) => re.test(c)));
  const walk = (node: Root | Element, stack: Element[]) => {
    for (const child of node.children) {
      if (child.type !== "element") continue;
      const tag = child.tagName.toLowerCase();
      const p = child.properties;
      const here = [...stack, child];
      if (forbiddenTags.has(tag)) {
        if (tag === "iframe" && opts.allowIframe?.(String(p.src))) {
          /* ok */
        } else if (tag === "img" && opts.allowImg?.(p.src ?? "")) {
          /* ok */
        } else if (
          tag === "input" &&
          p.type === "checkbox" &&
          p.disabled === true &&
          Object.keys(p).every((k) => ["type", "disabled", "checked"].includes(k))
        ) {
          /* GFM task list */
        } else out.push(`forbidden tag <${tag}>`);
      }
      if (/^h[1-6]$/.test(tag) && !opts.allowedIds) out.push(`heading <${tag}>`);
      for (const [k, v] of Object.entries(p)) {
        const key = k.toLowerCase();
        const val = Array.isArray(v) ? v.join(" ") : String(v);
        if (key.startsWith("on")) out.push(`event attr ${k}=${val}`);
        if (key === "style") {
          const ok =
            (opts.allowStyle?.test(val) ?? false) ||
            inClass(here, /^(?:katex|shiki)/) ||
            stack.some((e) => e.tagName === "pre" && inClass([e], /shiki/)) ||
            (tag === "pre" && inClass([child], /shiki/));
          if (!ok) out.push(`style attr on <${tag}>: ${val}`);
          if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(val)) out.push(`dangerous style: ${val}`);
        }
        if (
          [
            "href",
            "src",
            "xlinkhref",
            "xlink:href",
            "action",
            "formaction",
            "srcdoc",
            "data",
            "poster",
            "background",
            "ping",
            "srcset",
            "codebase",
            "cite",
            "manifest",
          ].includes(key)
        ) {
          const s = stripUrl(val);
          if (/^(?:javascript|data|vbscript|file|blob|about):/.test(s) || key === "srcdoc")
            out.push(`dangerous ${k}=${JSON.stringify(val)} on <${tag}>`);
          else if (
            key === "href" &&
            tag === "a" &&
            !/^(?:https?:|\/\/|#)/.test(s) &&
            !(opts.allowRelative && !/^[a-z][a-z0-9+.-]*:/.test(s))
          )
            out.push(`odd href scheme ${JSON.stringify(val)}`);
          else if (key !== "href" && key !== "src" && tag !== "iframe" && !/^(?:https?:|\/\/|#)/.test(s) && s)
            out.push(`odd ${k}=${JSON.stringify(val)} on <${tag}>`);
        }
        if ((key === "id" || key === "name") && !(opts.allowedIds && /^h[1-6]$/.test(tag))) {
          if (!(opts.allowedIds ?? /^user-content-preview-/).test(val))
            out.push(`unprefixed ${k}=${JSON.stringify(val)} on <${tag}>`);
        }
      }
      walk(child, here);
    }
  };
  walk(tree, []);
  return out;
};

export const htmlViolations = (html: string, opts?: Options) => violations(fromHtml(html, { fragment: true }), opts);

// 本文と属性に残ってはいけない不可視文字（ZWJ と ZWNJ は、絵文字と文字の連結に必要なため、対象外）
const badChar = (cp: number) =>
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069) ||
  cp === 0x200b ||
  cp === 0x2060 ||
  cp === 0xfeff ||
  cp === 0xad ||
  cp === 0x200e ||
  cp === 0x200f ||
  cp === 0x061c ||
  (cp >= 0xe0000 && cp <= 0xe007f) ||
  (cp >= 0x2061 && cp <= 0x2064) ||
  (cp >= 0x206a && cp <= 0x206f) ||
  cp === 0x180e ||
  cp === 0x034f ||
  (cp >= 0 && cp <= 8) ||
  cp === 11 ||
  cp === 12 ||
  (cp >= 14 && cp <= 31) ||
  (cp >= 0x7f && cp <= 0x9f);
const hasBad = (value: string, katex = false) => {
  // 英国旗などの絵文字タグ列は、正当
  let stripped = value.replace(/\u{1f3f4}[\u{e0020}-\u{e007e}]+\u{e007f}/gu, "");
  // KaTeX は \v などのアクセントで、旗の絵文字とタグ列の間に文字を挟むことがある（許可した旗のタグ列そのものは許す）
  if (katex)
    stripped = stripped.replace(
      /\u{e0067}\u{e0062}(?:\u{e0065}\u{e006e}\u{e0067}|\u{e0073}\u{e0063}\u{e0074}|\u{e0077}\u{e006c}\u{e0073})\u{e007f}/gu,
      ""
    );
  // KaTeX が自分で出力する文字（vlist のゼロ幅スペースと、MathML の関数適用などの見えない演算子）は許す
  return Array.from(stripped).some((ch) =>
    katex && /[\u200b\u2061-\u2064]/.test(ch) ? false : badChar(ch.codePointAt(0)!)
  );
};
export const invisibleViolations = (tree: Root | Element) => {
  const out: string[] = [];
  const walk = (node: Root | Element, katex = false) => {
    for (const child of node.children) {
      if (child.type === "text" && !katex && hasBad(child.value))
        out.push(`text ${JSON.stringify(child.value.slice(0, 40))}`);
      if (child.type === "element") {
        const katexRoot =
          !katex && Array.isArray(child.properties.className) && child.properties.className.some((c) => c === "katex");
        // KaTeX は絵文字とそれに続くタグ文字を別の要素に分けるので、数式全体のテキストをつないで検査する
        if (katexRoot && hasBad(toString(child), true))
          out.push(`katex text ${JSON.stringify(toString(child).slice(0, 40))}`);
        for (const [k, v] of Object.entries(child.properties)) {
          const values = Array.isArray(v) ? v.map(String) : [String(v)];
          for (const val of values) {
            let decoded = val;
            if (k === "href" || k === "src")
              try {
                decoded = decodeURIComponent(val);
              } catch {
                /* 元の値で検査する */
              }
            if (hasBad(val) || hasBad(decoded))
              out.push(`attr ${k} on <${child.tagName}> ${JSON.stringify(val.slice(0, 40))}`);
          }
        }
        walk(child, katex || katexRoot);
      }
    }
  };
  walk(tree);
  return out;
};
