import Slugger from "github-slugger";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";

import { skeleton } from "./unicode.ts";
import { defect } from "./warn.ts";

import type { Element, Root } from "hast";
import type { VFile } from "vfile";

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};
export const anchorShape = (value: string) => skeleton(decode(value).replace(/\p{Variation_Selector}/gu, ""));

export const findFootnoteElements = (tree: Root, file: VFile) => {
  const footnoteAnchors = new Set<Element>();
  const footnoteLinks = new Set<Element>();
  visit(tree, "element", (node) => {
    const offset = node.position?.start.offset;
    if (
      node.tagName === "a" &&
      node.properties.dataFootnoteRef !== undefined &&
      offset !== undefined &&
      String(file.value).slice(offset).startsWith("[^")
    ) {
      footnoteAnchors.add(node);
      footnoteLinks.add(node);
    }
    if (node.tagName !== "section" || node.properties.dataFootnotes === undefined || node.position) return;
    visit(node, "element", (child) => {
      if (child.tagName === "a" && child.properties.dataFootnoteBackref !== undefined && !child.position)
        footnoteLinks.add(child);
    });
    for (const child of node.children) {
      if (child.type !== "element") continue;
      if (/^h[1-6]$/.test(child.tagName)) footnoteAnchors.add(child);
      if (child.tagName === "ol") {
        for (const item of child.children) {
          if (item.type === "element" && item.tagName === "li") footnoteAnchors.add(item);
        }
      }
    }
  });
  return { footnoteAnchors, footnoteLinks };
};

export default () => (tree: Root, file: VFile) => {
  const slugger = new Slugger();
  const { footnoteAnchors, footnoteLinks } = findFootnoteElements(tree, file);
  const anchors: { node: Element; key: "id" | "name"; original: string; id: string }[] = [];
  visit(tree, "element", (node) => {
    const heading = /^h[1-6]$/.test(node.tagName);
    const existing = node.properties.id;
    if (heading || typeof existing === "string") {
      const original = typeof existing === "string" && existing ? existing : slugger.slug(toString(node));
      const id = heading ? original.replace(/-+/g, "-").replace(/^-|-$/g, "").replace(/^(\d)/, "_$1") : original;
      anchors.push({ node, key: "id", original, id });
    }
    if (node.tagName === "a" && typeof node.properties.name === "string" && node.properties.name !== existing) {
      anchors.push({ node, key: "name", original: node.properties.name, id: node.properties.name });
    }
  });
  anchors.sort(
    (a, b) =>
      Number(footnoteAnchors.has(b.node) && b.key === "id") - Number(footnoteAnchors.has(a.node) && a.key === "id") ||
      Number(a.key === "name") - Number(b.key === "name")
  );
  const reserved = new Set(anchors.map(({ id }) => anchorShape(id)));
  const used = new Map<string, Element>();
  const originalCounts = new Map<string, number>();
  const footnoteCounts = new Map<string, number>();
  for (const { original, node, key } of anchors) {
    originalCounts.set(original, (originalCounts.get(original) ?? 0) + 1);
    if (key === "id" && footnoteAnchors.has(node))
      footnoteCounts.set(original, (footnoteCounts.get(original) ?? 0) + 1);
  }
  const renamed = new Map<string, string>();
  const footnoteRenamed = new Map<string, string>();
  for (const anchor of anchors) {
    const originalShape = anchorShape(anchor.id);
    if (used.has(originalShape) && used.get(originalShape) !== anchor.node) {
      let number = 2;
      let candidate = `${anchor.id}-safe-${String(number)}`;
      while (used.has(anchorShape(candidate)) || reserved.has(anchorShape(candidate)))
        candidate = `${anchor.id}-safe-${String(++number)}`;
      anchor.id = candidate;
      defect(`アンカーが別のアンカーと紛らわしいため変更しました: ${anchor.original} → ${anchor.id}`, file.path);
    }
    if (anchor.original !== anchor.id && originalCounts.get(anchor.original) === 1) {
      renamed.set(anchor.original, anchor.id);
      const decoded = decode(anchor.original);
      if (decoded === anchor.original || !originalCounts.has(decoded)) renamed.set(decoded, anchor.id);
    }
    if (
      anchor.original !== anchor.id &&
      anchor.key === "id" &&
      footnoteAnchors.has(anchor.node) &&
      footnoteCounts.get(anchor.original) === 1
    ) {
      footnoteRenamed.set(anchor.original, anchor.id);
      const decoded = decode(anchor.original);
      if (decoded === anchor.original || !footnoteCounts.has(decoded)) footnoteRenamed.set(decoded, anchor.id);
    }
    used.set(anchorShape(anchor.id), anchor.node);
    if (anchor.key === "id" && anchor.node.tagName === "a" && anchor.node.properties.name === anchor.original)
      anchor.node.properties.name = anchor.id;
    anchor.node.properties[anchor.key] = anchor.id;
  }
  visit(tree, "element", (node) => {
    const { properties } = node;
    const footnoteLink = footnoteLinks.has(node);
    if (typeof properties.href === "string" && properties.href.startsWith("#")) {
      const id = properties.href.slice(1);
      const target =
        (footnoteLink
          ? (footnoteRenamed.get(id) ?? (footnoteCounts.has(id) ? undefined : footnoteRenamed.get(decode(id))))
          : undefined) ??
        renamed.get(id) ??
        (originalCounts.has(id) ? undefined : renamed.get(decode(id)));
      if (target) properties.href = `#${target}`;
    }
    for (const key of ["ariaDescribedBy", "ariaLabelledBy"]) {
      const value = properties[key];
      if (Array.isArray(value))
        properties[key] = value.map((item) =>
          typeof item === "string"
            ? ((footnoteLink ? footnoteRenamed.get(item) : undefined) ?? renamed.get(item) ?? item)
            : item
        );
    }
  });
};
