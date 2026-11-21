import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";

import { load } from "cheerio";
import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";

import { authorsPath } from "./content-paths.ts";
import { safeFetch } from "./safe-fetch.ts";
import { cleanTextUnicode } from "./unicode.ts";
import { defect, warn } from "./warn.ts";

import type { Element, Root, RootContent } from "hast";
import type { VFile } from "vfile";

// PlantUML サーバーへの接続・応答の失敗（書き手が直せないため、不備にしない）
class ServerError extends Error {}

const maxLength = 10_000;
const maxCount = 50;
const diagramTypes = ["uml", "salt", "json", "yaml", "wbs"] as const;
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const encode = (source: string) => {
  const bytes = deflateRawSync(Buffer.from(source));
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    encoded +=
      alphabet[a >> 2]! +
      alphabet[((a & 3) << 4) | (b >> 4)]! +
      alphabet[((b & 15) << 2) | (c >> 6)]! +
      alphabet[c & 63]!;
  }
  return encoded;
};

const tags = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "defs",
  "marker",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "title",
  "desc",
]);
const attributes = new Set([
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "transform",
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "id",
  "offset",
  "stop-color",
  "stop-opacity",
  "markerWidth",
  "markerHeight",
  "refX",
  "refY",
  "orient",
  "markerUnits",
  "clip-path",
  "marker-start",
  "marker-mid",
  "marker-end",
]);
const cssProperties = new Set([
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "clip-path",
  "marker-start",
  "marker-mid",
  "marker-end",
]);
const safeValue = (value: string) =>
  !/[\\<>;]/.test(value) && !/(?:url\s*\(|javascript\s*:|expression\s*\(|@import|\/\*)/i.test(value);

// 応答もキャッシュも信頼せず、図に必要な SVG 要素と属性だけを取り出す
const parseSvg = (source: string, id: string, onClean?: (attribute: boolean) => void): Element => {
  const clean = (value: string, attribute: boolean) => {
    const result = cleanTextUnicode(value);
    if (result.changed) onClean?.(attribute);
    return result.value;
  };
  const $ = load(source, { xmlMode: true });
  const root = $("svg").first();
  if (!root.length) throw new Error("SVG がありません");
  const rootNode = root.get(0)!;
  const valueFor = (key: string, value: string) => {
    if (key === "id") return /^[a-z_][\w.:-]*$/i.test(value) ? `${id}-${value}` : undefined;
    const reference = /^url\(\s*#([a-z_][\w.:-]*)\s*\)$/i.exec(value);
    if (reference && ["fill", "stroke", "clip-path", "marker-start", "marker-mid", "marker-end"].includes(key)) {
      return `url(#${id}-${reference[1]!})`;
    }
    return safeValue(value) ? value : undefined;
  };
  const convert = (node: (typeof rootNode.children)[number] | typeof rootNode): RootContent | undefined => {
    const kind: string = node.type;
    if ("data" in node && kind === "text") return { type: "text", value: clean(node.data, false) };
    if (!("attribs" in node) || kind !== "tag" || !tags.has(node.name)) return;
    const properties: Element["properties"] = {};
    for (const [key, original] of Object.entries(node.attribs)) {
      const value = clean(original, true);
      if (key === "style") {
        for (const declaration of value.split(";")) {
          const colon = declaration.indexOf(":");
          const name = declaration.slice(0, colon).trim();
          const part = declaration.slice(colon + 1).trim();
          const safe = valueFor(name, part);
          if (colon > 0 && cssProperties.has(name) && safe !== undefined) properties[name] = safe;
        }
      } else if (attributes.has(key)) {
        const safe = valueFor(key, value);
        if (safe !== undefined) properties[key] = safe;
      }
    }
    return {
      type: "element",
      tagName: node.name,
      properties,
      children: node.children.flatMap((child) => {
        const converted = convert(child);
        return converted && converted.type !== "doctype" ? [converted] : [];
      }),
    };
  };
  const result = convert(rootNode);
  if (result?.type !== "element") throw new Error("SVG が不正です");
  result.properties.id = id;
  return result;
};

export default ({ contents, cacheDir = resolve(".cache/plantuml") }: { contents: string; cacheDir?: string }) => {
  const pending = new Map<string, Promise<string>>();
  const fetchSvg = (source: string) => {
    const hash = createHash("sha256").update(source).digest("hex");
    let request = pending.get(hash);
    if (!request) {
      request = (async () => {
        const path = resolve(cacheDir, `${hash}.svg`);
        try {
          const cached = await readFile(path, "utf8");
          parseSvg(cached, "mermaid-plantuml");
          return cached;
        } catch {
          const result = (
            await safeFetch(`https://www.plantuml.com/plantuml/svg/${encode(source)}`, { maxBytes: 1_000_000 })
          ).toString();
          parseSvg(result, "mermaid-plantuml");
          await mkdir(cacheDir, { recursive: true });
          await writeFile(path, result);
          return result;
        }
      })().catch((error: unknown) => {
        pending.delete(hash);
        throw error;
      });
      pending.set(hash, request);
    }
    return request;
  };
  return async (tree: Root, file: VFile) => {
    const path = `${authorsPath}/${relative(contents, file.path)}`;
    const blocks: { node: Element; parent: Root | Element; index: number }[] = [];
    visit(tree, "element", (node, index, parent) => {
      if (
        node.tagName === "pre" &&
        Array.isArray(node.properties.className) &&
        node.properties.className.includes("language-plantuml") &&
        parent &&
        index !== undefined
      ) {
        blocks.push({ node, parent, index });
      }
    });
    await Promise.all(
      blocks.map(async ({ node, parent, index }, count) => {
        const source = toString(node);
        try {
          if (count >= maxCount || source.length > maxLength) throw new Error("図の数または長さが上限を超えています");
          const start = /^\s*@start([a-z]+)[ \t]*(?:\r?\n|$)/i.exec(source)?.[1]?.toLowerCase();
          if (
            !start ||
            !diagramTypes.some((type) => type === start) ||
            !new RegExp(`@end${start}\\s*$`, "i").test(source)
          ) {
            throw new Error("対応する開始タグと終了タグが必要です");
          }
          if (/^\s*!|[%$][\w{]|\[\[|(?:https?|file):|<img\b/im.test(source)) {
            throw new Error("プリプロセッサ、外部読み込みやリンクは使えません");
          }
          const response = await fetchSvg(source).catch((error: unknown) => {
            throw new ServerError(error instanceof Error ? error.message : String(error));
          });
          const svg = parseSvg(response, `mermaid-plantuml-${String(count)}`, (attribute) => {
            defect(attribute ? "属性の不可視文字を取り除きました" : "不可視文字を取り除きました", path);
          });
          parent.children[index] = svg;
        } catch (error) {
          (error instanceof ServerError ? warn : defect)(
            `PlantUML の変換に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
            path
          );
        }
      })
    );
  };
};
