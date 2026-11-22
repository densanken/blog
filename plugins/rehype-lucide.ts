import { relative } from "node:path";

import { icons } from "lucide";
import { visit } from "unist-util-visit";

import { lucideElements } from "../src/shared/utils/lucide.ts";
import { authorsPath } from "./content-paths.ts";
import { defect } from "./warn.ts";

import type { Element, Root } from "hast";
import type { VFile } from "vfile";

const sizes: Record<string, string> = {
  xs: "0.75em",
  sm: "0.875em",
  base: "1em",
  lg: "1.125em",
  xl: "1.25em",
  "2xl": "1.5em",
};

export default ({ contents }: { contents: string }) =>
  (tree: Root, file: VFile) => {
    const headingIcons = new WeakSet<Element>();
    visit(tree, "element", (node) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;
      visit(node, "element", (child) => {
        if (child.tagName === "icon") headingIcons.add(child);
      });
    });
    visit(tree, "element", (node, index, parent) => {
      if (node.tagName !== "icon" || !parent || index === undefined) return;
      const name = node.properties.dataLucideName;
      const key =
        typeof name === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
          ? name.replace(/(^|-)([a-z0-9])/g, (_, _separator: string, letter: string) => letter.toUpperCase())
          : "";
      const icon = Object.hasOwn(icons, key) ? icons[key as keyof typeof icons] : undefined;
      if (!icon) {
        const path = `${authorsPath}/${relative(contents, file.path)}`;
        defect(`${path} の Lucide アイコンが見つかりません: ${String(name ?? "")}`, path);
        parent.children.splice(index, 1);
        return index;
      }
      const label = node.properties.dataLucideLabel;
      const size = node.properties.dataLucideSize;
      const valid = typeof size === "string" && Object.hasOwn(sizes, size);
      if (size !== undefined && !valid) {
        const path = `${authorsPath}/${relative(contents, file.path)}`;
        defect(`${path} の Lucide アイコンの大きさが不正です: ${String(size)}`, path);
      }
      const dimension = !headingIcons.has(node) && valid ? sizes[size]! : sizes.base!;
      const properties = {
        className: ["lucide-inline"],
        width: dimension,
        height: dimension,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        ...(typeof label === "string" && label.trim() ? { role: "img", ariaLabel: label } : { ariaHidden: "true" }),
      };
      const svg: Element = {
        type: "element",
        tagName: "svg",
        properties,
        children: icon
          .filter(([tagName]) => lucideElements.has(tagName))
          .map(([tagName, attributes]) => ({
            type: "element",
            tagName,
            properties: attributes,
            children: [],
          })),
      };
      parent.children[index] = svg;
    });
  };
