import { visit } from "unist-util-visit";

import type { Element, RootContent } from "hast";

// 埋め込みコードの認識に使う、ノードの読み取り（作者の属性は、ここで検査した値だけを使う）

export const isElement = (node: RootContent | undefined, tagName?: string): node is Element =>
  node?.type === "element" && (tagName === undefined || node.tagName === tagName);

const isBlank = (node: RootContent | undefined) => node?.type === "text" && !node.value.trim();

export const attribute = (node: Element, name: string) => {
  const value = node.properties[name];
  return typeof value === "string" ? value : undefined;
};

export const hasClass = (node: Element, name: string) => {
  const value = node.properties.className;
  return Array.isArray(value) && value.includes(name);
};

// 空白だけのテキストを飛ばした、次のノードの位置
export const skipBlank = (nodes: readonly RootContent[], index: number) => {
  let next = index;
  while (isBlank(nodes[next])) next++;
  return next;
};

// 空白だけのテキストを除いた、唯一の子ノード
export const onlyChild = (node: Element) => {
  const children = node.children.filter((child) => !isBlank(child));
  return children.length === 1 ? children[0] : undefined;
};

export const iframeSrc = (node: RootContent | undefined) =>
  isElement(node, "iframe") ? attribute(node, "src") : undefined;

// 子孫のリンクの href
export const hrefs = (node: Element) => {
  const result: string[] = [];
  visit(node, "element", (child) => {
    if (child.tagName === "a") {
      const href = attribute(child, "href");
      if (href) result.push(href);
    }
  });
  return result;
};

// 埋め込みコードの後ろに付く script（src が決まった URL のものだけ）を、直後（空白を除く）にあれば消費した後のノード数にする
export const withScript = (nodes: readonly RootContent[], index: number, length: number, src: RegExp) => {
  const next = skipBlank(nodes, index + length);
  const script = nodes[next];
  return isElement(script, "script") && src.test(attribute(script, "src") ?? "") ? next + 1 - index : length;
};
