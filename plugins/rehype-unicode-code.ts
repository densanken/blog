import { visit } from "unist-util-visit";

import { anchorShape, findFootnoteElements } from "./rehype-anchor-guard.ts";
import { cleanTextUnicode, cleanUnicode, cleanUrlUnicode } from "./unicode.ts";
import { defect, warn } from "./warn.ts";

import type { Element, Root } from "hast";
import type { VFile } from "vfile";

export default () => (tree: Root, file: VFile) => {
  const { footnoteAnchors } = findFootnoteElements(tree, file);
  const anchors: { node: Element; key: "id" | "name"; original: string; cleaned: string }[] = [];
  visit(tree, "element", (node) => {
    for (const key of ["id", "name"] as const) {
      const value = node.properties[key];
      if (typeof value === "string")
        anchors.push({ node, key, original: value, cleaned: cleanUrlUnicode(value).value });
    }
  });
  anchors.sort(
    (a, b) =>
      Number(footnoteAnchors.has(b.node) && b.key === "id") - Number(footnoteAnchors.has(a.node) && a.key === "id") ||
      Number(a.original !== a.cleaned) - Number(b.original !== b.cleaned)
  );
  const reserved = new Set(anchors.map(({ cleaned }) => anchorShape(cleaned)));
  const used = new Map<string, Element>();
  const changed = new Set<string>();
  const renamed = new Map<string, string>();
  for (const anchor of anchors) {
    let id = anchor.cleaned;
    if (
      used.has(anchorShape(id)) &&
      used.get(anchorShape(id)) !== anchor.node &&
      (anchor.original !== id || changed.has(anchorShape(id)))
    ) {
      let suffix = 2;
      while (used.has(anchorShape(id)) || reserved.has(anchorShape(id)))
        id = `${anchor.cleaned}-safe-${String(suffix++)}`;
    }
    used.set(anchorShape(id), anchor.node);
    if (anchor.original !== anchor.cleaned) changed.add(anchorShape(anchor.cleaned));
    if (!renamed.has(anchor.original)) renamed.set(anchor.original, id);
    anchor.node.properties[anchor.key] = id;
    if (anchor.original !== id) defect("属性の不可視文字を取り除きました", file.path);
  }
  const decoded = new Map<string, string | null>();
  for (const [original, id] of renamed) {
    try {
      const key = decodeURIComponent(original);
      decoded.set(key, decoded.has(key) ? null : id);
    } catch {
      // 不正なエスケープは元の表記で照合する
    }
  }
  const targetFor = (value: string) => {
    const exact = renamed.get(value);
    if (exact !== undefined) return exact;
    try {
      return decoded.get(decodeURIComponent(value)) ?? undefined;
    } catch {
      return undefined;
    }
  };
  // 外部から取得した GitHub のファイルと Gist の中身は、書き手が直せないため、不備にしない
  const render = (node: Root | Element, inCode: boolean, external = false) => {
    const report = external ? warn : defect;
    for (const child of node.children) {
      if (child.type === "text") {
        const result = inCode ? cleanUnicode(child.value, true) : cleanTextUnicode(child.value);
        if (result.changed) {
          child.value = result.value;
          report(inCode ? "コード中の不可視文字を可視化しました" : "不可視文字を取り除きました", file.path);
        }
      } else if (child.type === "element") {
        for (const [key, value] of Object.entries(child.properties)) {
          if ((key === "ariaDescribedBy" || key === "ariaLabelledBy") && Array.isArray(value)) {
            child.properties[key] = value.map((item) => targetFor(String(item)) ?? String(item));
          }
          // pre の code は、コピーボタンがコピーする値であり、表示するコードと同じ規則で不可視文字を可視化する
          // 表示と違う文字列（不可視の制御文字を含むコード）をコピーさせないため（Trojan Source）
          // 本文の text で警告しているため、ここでは警告しない
          if (key === "code" && typeof value === "string") {
            const result = cleanUnicode(value, true);
            if (result.changed) child.properties[key] = result.value;
            continue;
          }
          if (typeof value !== "string") continue;
          const target = key === "href" && value.startsWith("#") ? targetFor(value.slice(1)) : undefined;
          const result =
            target !== undefined
              ? { value: `#${target}`, changed: `#${target}` !== value }
              : key === "href" || key === "src"
                ? cleanUrlUnicode(value)
                : cleanTextUnicode(value);
          if (result.changed) {
            child.properties[key] = result.value;
            report("属性の不可視文字を取り除きました", file.path);
          }
        }
        render(
          child,
          inCode || child.tagName === "code" || child.tagName === "pre",
          external || child.properties.githubEmbed === true
        );
      }
    }
  };
  render(tree, false);
};
