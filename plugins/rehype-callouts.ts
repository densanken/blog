import rehypeCallouts from "rehype-callouts";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import type { Element, Root } from "hast";
import type { VFile } from "vfile";

const types = new Set(["note", "tip", "important", "warning", "caution"]);
export const isCalloutType = (type: string) => types.has(type.toLowerCase());

export default () => {
  const processor = unified().use(rehypeCallouts, { theme: "github" });
  return (tree: Root, file: VFile) => {
    const skipped: Element[] = [];
    visit(tree, "element", (node) => {
      if (node.tagName !== "blockquote") return;
      const paragraph = node.children.find((child) => child.type !== "text" || child.value !== "\n");
      const first = paragraph?.type === "element" && paragraph.tagName === "p" ? paragraph.children[0] : undefined;
      const type = first?.type === "text" ? /^\[!([\w-]+)]/.exec(first.value)?.[1] : undefined;
      if (!type || !isCalloutType(type)) {
        skipped.push(node);
        node.tagName = "div";
      } else if (paragraph?.type === "element") {
        const index = paragraph.children.findIndex((child) => child.type === "text" && child.value.includes("\n"));
        const boundary = paragraph.children[index];
        if (boundary?.type !== "text") return;

        const newline = boundary.value.indexOf("\n");
        const title = paragraph.children.slice(0, index);
        const before = boundary.value.slice(0, newline);
        if (before) title.push({ type: "text", value: before });
        const last = title.at(-1);
        if (last?.type === "element" && last.tagName === "br") title.pop();
        const body = boundary.value.slice(newline + 1);
        const children = paragraph.children.slice(index + 1);
        if (body) children.unshift({ type: "text", value: body });
        paragraph.children = title;
        node.children.splice(node.children.indexOf(paragraph) + 1, 0, {
          type: "element",
          tagName: "p",
          properties: {},
          children,
        });
      }
    });
    try {
      processor.runSync(tree, file);
    } finally {
      for (const node of skipped) node.tagName = "blockquote";
    }
  };
};
