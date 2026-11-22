import { find, svg } from "property-information";
import { visit } from "unist-util-visit";

import type { Root } from "hast";

// MDC が camelCase のまま出力してしまう SVG の属性名（markerEnd など）を、ハイフン付きの属性名に直す
export default () => (tree: Root) => {
  visit(tree, "element", (node) => {
    if (node.tagName !== "svg") return;
    visit(node, "element", ({ properties }) => {
      for (const [key, value] of Object.entries(properties)) {
        const { attribute } = find(svg, key);
        if (attribute.includes("-")) {
          delete properties[key];
          properties[attribute] = value;
        }
      }
    });
  });
};
