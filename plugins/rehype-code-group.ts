import { h } from "hastscript";
import { visit } from "unist-util-visit";

import type { Element, Root, RootContent } from "hast";

const isTab = (node: RootContent): node is Element =>
  node.type === "element" &&
  node.tagName === "pre" &&
  typeof node.properties.meta === "string" &&
  // `no-tab` や `tab=false` は、`tab` ではない（空白で区切った 1 語として、完全に一致するものだけをタブにする）
  node.properties.meta.split(/\s+/).includes("tab");
const isBlank = (node: RootContent) => node.type === "text" && !node.value.trim();

// ` ```sh [npm] tab ` のようにメタに `tab` を書いたコードブロックのうち、連続するものを、タブで切り替える code-group にまとめる
// タブの名前は、`[]` で書いたファイル名になる
// 作者の HTML は、このプラグインより前に sanitize 済みなので、作者が code-group を直接書くことはできない
export default () => (tree: Root) => {
  visit(tree, (parent) => {
    if (parent.type !== "root" && parent.type !== "element") return;
    if (parent.type === "element" && parent.tagName === "code-group") return;
    const children: RootContent[] = [];
    for (const child of parent.children) {
      const group = children.at(-1);
      if (isTab(child)) {
        if (group?.type === "element" && group.tagName === "code-group") group.children.push(child);
        else children.push(h("code-group", [child]));
      } else if (!(isBlank(child) && group?.type === "element" && group.tagName === "code-group")) {
        children.push(child);
      }
    }
    if (parent.type === "root") parent.children = children;
    else parent.children = children.filter((child) => child.type !== "doctype");
  });
};
