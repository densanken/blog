import { toHtml } from "hast-util-to-html";

import { lucideElements } from "../../shared/utils/lucide";

import type { IconTocLink, TocPart } from "../../shared/utils/toc";
import type { TocLink } from "@nuxt/content";
import type { Element } from "hast";

// 本文中のビルド時生成アイコンだけを目次用に取り出し、装飾として読み上げから除く
export const tocWithIcons = (links: TocLink[], body: unknown): IconTocLink[] => {
  const headings = new Map<string, { parts: TocPart[]; iconLabel?: string }>();
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    const [tag, properties, ...children] = node as unknown[];
    if (
      typeof tag === "string" &&
      /^h[2-4]$/.test(tag) &&
      properties &&
      typeof properties === "object" &&
      "id" in properties &&
      typeof properties.id === "string"
    ) {
      const parts: TocPart[] = [];
      const labels: string[] = [];
      const collect = (child: unknown) => {
        if (typeof child === "string") {
          parts.push({ text: child });
        } else if (Array.isArray(child)) {
          const [name, attrs, ...nested] = child as unknown[];
          if (name === "img" && attrs && typeof attrs === "object" && "alt" in attrs && typeof attrs.alt === "string") {
            parts.push({ text: attrs.alt });
            return;
          }
          if (
            name === "svg" &&
            attrs &&
            typeof attrs === "object" &&
            "className" in attrs &&
            Array.isArray(attrs.className) &&
            attrs.className.includes("lucide-inline")
          ) {
            const label =
              "aria-label" in attrs ? attrs["aria-label"] : "ariaLabel" in attrs ? attrs.ariaLabel : undefined;
            if (typeof label === "string" && label.trim()) labels.push(label.trim());
            const paths: Element[] = nested.flatMap((part): Element[] => {
              if (!Array.isArray(part)) return [];
              const [pathTag, pathAttrs] = part as unknown[];
              if (
                typeof pathTag !== "string" ||
                !lucideElements.has(pathTag) ||
                !pathAttrs ||
                typeof pathAttrs !== "object"
              )
                return [];
              const safe = Object.fromEntries(
                Object.entries(pathAttrs).filter(
                  ([key, value]) =>
                    ([
                      "d",
                      "cx",
                      "cy",
                      "r",
                      "x",
                      "y",
                      "x1",
                      "y1",
                      "x2",
                      "y2",
                      "width",
                      "height",
                      "rx",
                      "ry",
                      "points",
                    ].includes(key) &&
                      typeof value === "string") ||
                    (key === "fill" && value === "currentColor")
                )
              );
              return [{ type: "element", tagName: pathTag, properties: safe, children: [] }];
            });
            const svg: Element = {
              type: "element",
              tagName: "svg",
              properties: {
                className: ["lucide-inline"],
                viewBox: "0 0 24 24",
                width: "1em",
                height: "1em",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: "2",
                strokeLinecap: "round",
                strokeLinejoin: "round",
                ariaHidden: "true",
              },
              children: paths,
            };
            parts.push({ svg: toHtml(svg) });
          } else {
            nested.forEach(collect);
          }
        }
      };
      children.forEach(collect);
      if (parts.some((part) => "svg" in part))
        headings.set(properties.id, { parts, iconLabel: labels.join(" ") || undefined });
    }
    children.forEach(visit);
  };
  if (Array.isArray(body)) body.forEach(visit);
  const convert = (items: TocLink[]): IconTocLink[] =>
    items.map((link) => ({
      ...link,
      parts: headings.get(link.id)?.parts,
      iconLabel: link.text.trim() ? undefined : headings.get(link.id)?.iconLabel,
      children: link.children ? convert(link.children) : undefined,
    }));
  return convert(links);
};
