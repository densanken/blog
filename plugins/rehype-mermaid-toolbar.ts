import { Maximize2, RotateCcw, ZoomIn, ZoomOut } from "lucide";
import { visit } from "unist-util-visit";

import type { Element, Root } from "hast";

const buttons: [string, string, typeof ZoomIn][] = [
  ["zoom-in", "拡大", ZoomIn],
  ["zoom-out", "縮小", ZoomOut],
  ["reset", "元の大きさに戻す", RotateCcw],
  ["fullscreen", "全画面で表示", Maximize2],
];

// Lucide のアイコンデータを、Lucide の既定の属性を持つ SVG 要素に変換する
const icon = (nodes: typeof ZoomIn): Element => ({
  type: "element",
  tagName: "svg",
  properties: {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": 2,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  },
  children: nodes.map(([tagName, properties]) => ({ type: "element", tagName, properties, children: [] })),
});

// Mermaid の図を、拡大縮小のボタンと、拡大縮小の対象になる要素（.mermaid-canvas）で包む
export default () => (tree: Root) => {
  visit(tree, "element", (node, index, parent) => {
    if (
      node.tagName === "svg" &&
      typeof node.properties.id === "string" &&
      node.properties.id.startsWith("mermaid") &&
      parent &&
      index !== undefined
    ) {
      visit(node, "element", (child, childIndex, childParent) => {
        if (child.tagName === "a" && childParent && childIndex !== undefined) {
          childParent.children.splice(childIndex, 1, ...child.children);
          return childIndex;
        }
        if (child.tagName === "style") {
          for (const text of child.children) {
            if (text.type !== "text") continue;
            const css = text.value.replace(/\/\*[\s\S]*?\*\//g, "");
            text.value =
              css.includes("\\") || /image-set\(|@import/i.test(css)
                ? ""
                : css.replace(/url\(([^)]*)\)/gi, (url, target: string) => (/^\s*["']?#/.test(target) ? url : "none"));
          }
        }
        for (const [key, value] of Object.entries(child.properties)) {
          if (/^on/i.test(key) || /^(?:href|xlinkHref|xlink:href)$/i.test(key)) {
            delete child.properties[key];
            continue;
          }
          if (typeof value !== "string") continue;
          const urls = [...value.matchAll(/url\(([^)]*)\)/gi)];
          if (
            value.includes("\\") ||
            value.includes("/*") ||
            /image-set\(/i.test(value) ||
            urls.some((match) => !/^\s*["']?#/.test(match[1]!))
          ) {
            delete child.properties[key];
          }
        }
        if ((child.tagName === "img" || child.tagName === "image") && childParent && childIndex !== undefined) {
          childParent.children.splice(childIndex, 1);
          return childIndex;
        }
      });
      const toolbar: Element = {
        type: "element",
        tagName: "div",
        properties: { className: ["mermaid-toolbar"] },
        children: buttons.map(([action, label, nodes]) => ({
          type: "element",
          tagName: "button",
          properties: { type: "button", "data-action": action, "aria-label": label },
          children: [icon(nodes)],
        })),
      };
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["mermaid"] },
        children: [
          toolbar,
          { type: "element", tagName: "div", properties: { className: ["mermaid-canvas"] }, children: [node] },
        ],
      };
    }
  });
};
