import assert from "node:assert/strict";

import type { Element, Root, RootContent } from "hast";

export const isElement = (node: RootContent): node is Element => node.type === "element";

export const child = (parent: Root | Element, index: number): Element => {
  const node = parent.children[index];
  assert.ok(node && isElement(node));
  return node;
};
