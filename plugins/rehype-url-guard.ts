import { toString } from "hast-util-to-string";
import { h } from "hastscript";
import { visit } from "unist-util-visit";

import { inspectUrl } from "./url-guard.ts";
import { defect } from "./warn.ts";

import type { Element, Root } from "hast";
import type { VFile } from "vfile";

export const guardedEmbeds = new WeakSet<Element>();
export const embeddedUrls = new WeakMap<Element, NonNullable<ReturnType<typeof inspectUrl>>>();

export default () => (tree: Root, file: VFile) => {
  visit(tree, "element", (node) => {
    if (node.tagName === "pre" && typeof node.properties.meta === "string") {
      const href = /\bhref=(https:\/\/\S+)/.exec(node.properties.meta)?.[1];
      const filename = node.properties.filename;
      const label = typeof filename === "string" && /^https?:\/\//i.test(filename) ? filename : "";
      const result = href && inspectUrl(href, label);
      if (result && (result.idn || result.mismatch || result.confusable)) {
        const suspicious = result.mixed || result.mismatch || result.confusable;
        if (suspicious) defect(`リンクの接続先を確認してください: ${result.ascii}`, file.path);
        node.properties.filenameUrlHost = result.display;
        node.properties.filenameUrlAscii = result.ascii;
        node.properties.filenameUrlWarning = suspicious;
      }
    }
    if (guardedEmbeds.has(node)) return;
    const result =
      embeddedUrls.get(node) ??
      (node.tagName === "a" && typeof node.properties.href === "string"
        ? inspectUrl(node.properties.href, toString(node))
        : undefined);
    if (!result || (!result.idn && !result.mismatch && !result.confusable)) return;
    const suspicious = result.mixed || result.mismatch || result.confusable;
    if (suspicious) defect(`リンクの接続先を確認してください: ${result.ascii}`, file.path);
    node.children.push(h("span", { className: ["url-host"], title: result.ascii }, ` (${result.display})`));
    if (suspicious) node.children.push(h("strong", { className: ["url-warning"] }, " ⚠ 接続先に注意"));
  });
};
