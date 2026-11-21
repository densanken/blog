import { load } from "cheerio";
import { h } from "hastscript";
import { visit } from "unist-util-visit";

import { twitter, widgetsSource } from "./embeds/twitter.ts";
import { defect } from "./warn.ts";

import type { Element } from "hast";
import type { Root, RootContent } from "mdast";
import type { VFile } from "vfile";

const limit = 10_000;
export const restoredQuoteStarts = new WeakMap<VFile, Set<number>>();
export const invalidTwitterRanges = new WeakMap<VFile, [number, number][]>();

// script の終了タグ（HTML のパーサーと同じく、属性を書ける。引用符で囲んだ属性値の中の `>` では、終わらない）
const scriptEnd = String.raw`<\/script(?:[\s/](?:[^>"']|"[^"]*"|'[^']*')*)?>`;
// 引用の直後にある widgets.js の script を取り除く（埋め込みに含まれるため）
const widgetsScript = new RegExp(String.raw`^\s*<script\b([^>]*)>\s*${scriptEnd}`, "i");
// 引用の直後に、コメント、script、閉じタグだけが続くか
const onlyIgnorableHtml = new RegExp(
  String.raw`^\s*(?:(?:<!--(?:[^-]|-(?!->))*-->|<script\b[^>]*>\s*${scriptEnd}|<\/\w+\s*>)\s*)*$`,
  "i"
);
export const withoutWidgets = (html: string) => {
  const match = widgetsScript.exec(html);
  const src = match && /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[1] ?? "");
  return match && widgetsSource.test(src?.[1] ?? src?.[2] ?? "") ? html.slice(match[0].length) : html;
};

// 空行で分割された引用の範囲を記録し、正しい X の埋め込みコードを一つのブロックに戻す
export default () => (tree: Root, file: VFile) => {
  const source = String(file.value);
  const codeRanges: [number, number][] = [];
  const htmlRanges: [number, number][] = [];
  visit(tree, (node) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) return;
    if (node.type === "html") htmlRanges.push([start, end]);
    if (node.type === "code" || node.type === "inlineCode") codeRanges.push([start, end]);
  });
  const characters = source.replace(/[^\r\n]/g, " ").split("");
  for (const [start, end] of htmlRanges) {
    for (let offset = start; offset < end; offset++) characters[offset] = source[offset]!;
  }
  const htmlSource = characters.join("");
  const $ = load(htmlSource, { sourceCodeLocationInfo: true }, false);
  const quotes = $("blockquote").toArray();
  const validQuote = (element: (typeof quotes)[number]) => {
    const location = element.sourceCodeLocation;
    if (!location?.startTag || !location.endTag) return;
    const start = location.startTag.startOffset;
    const end = location.endTag.endOffset;
    if (end - start > limit) return;
    let content = "";
    for (let offset = start; offset < end; offset++) {
      const character = source[offset]!;
      content +=
        htmlSource[offset] === " " && character !== " "
          ? character.replace(/</g, "&lt;").replace(/>/g, "&gt;")
          : character;
    }
    const parsed = load(content, {}, false);
    const quote = parsed("blockquote").first();
    const parts = quote
      .contents()
      .toArray()
      .flatMap<string | Element>((child) => {
        if ((child.type as string) === "text" && "data" in child) return [child.data];
        if ((child.type as string) === "tag" && "attribs" in child && "name" in child)
          return [h(child.name, { href: child.attribs.href })];
        return [];
      });
    const result = twitter.fromEmbedCode([h("blockquote", { className: quote.attr("class")?.split(/\s+/) }, parts)], 0);
    const link = $(element).children("a").last().get(0);
    const linkStart = link?.sourceCodeLocation?.startTag?.startOffset;
    if (linkStart === undefined || !htmlRanges.some(([from, to]) => linkStart >= from && linkStart < to)) return;
    const post = /^https:\/\/(?:twitter|x)\.com\/(\w{1,50})\/status\/(\d{1,25})(?:[/?#]|$)/.exec(
      link?.attribs.href ?? ""
    );
    if (!result || !post || result.url !== `https://twitter.com/${post[1] ?? ""}/status/${post[2] ?? ""}`) return;
    return result;
  };
  const restored = new Set<number>();
  restoredQuoteStarts.set(file, restored);
  const ranges: [number, number][] = [];
  invalidTwitterRanges.set(file, ranges);
  const process = (children: RootContent[], parentEnd: number) => {
    for (let i = 0; i < children.length; i++) {
      const node = children[i];
      if (!node) continue;
      if (node.type === "paragraph" && node.position) {
        const index = node.children.findIndex((child) => {
          if (child.type !== "html") return false;
          const start = child.position?.start.offset;
          const element = quotes.find((quote) => quote.sourceCodeLocation?.startTag?.startOffset === start);
          const location = element?.sourceCodeLocation;
          return (
            element &&
            location?.endTag &&
            location.endTag.endOffset > (node.position?.end.offset ?? Infinity) &&
            location.endTag.endOffset - (start ?? 0) <= limit &&
            !$(element).find("blockquote").length &&
            !codeRanges.some(([from, to]) => from < location.endTag!.endOffset && to > (start ?? 0)) &&
            validQuote(element)
          );
        });
        const child = node.children[index];
        if (index >= 0 && child?.position) {
          const start = child.position.start;
          const remaining = node.children.slice(index + 1);
          const end = node.position.end;
          node.children = node.children.slice(0, index);
          node.position.end = start;
          const following: RootContent[] = [child];
          if (remaining.length)
            following.push({ type: "paragraph", children: remaining, position: { start: child.position.end, end } });
          if (index > 0) children.splice(i + 1, 0, ...following);
          else {
            children.splice(i, 1, ...following);
            i--;
            continue;
          }
        }
      }
      if (node.type !== "html") {
        if ("children" in node)
          process(node.children, node.type === "paragraph" ? parentEnd : (node.position?.end.offset ?? parentEnd));
        continue;
      }
      const nodeStart = node.position?.start.offset;
      const nodeEnd = node.position?.end.offset;
      if (nodeStart === undefined || nodeEnd === undefined) continue;
      for (const element of quotes) {
        const location = element.sourceCodeLocation;
        if (!location?.startTag) continue;
        const start = location.startTag.startOffset;
        if (start < nodeStart || start >= nodeEnd || ranges.some(([from, to]) => start >= from && start < to)) continue;
        const parentLocation = $(element).parent().get(0)?.sourceCodeLocation;
        const htmlParentEnd = parentLocation?.endTag?.startOffset ?? parentLocation?.endOffset ?? parentEnd;
        const boundary = Math.min(location.endTag?.endOffset ?? htmlParentEnd, parentEnd);
        if (boundary <= nodeEnd) continue;
        const quote = $(element);
        const validShape = validQuote(element);
        let last = i;
        while (last + 1 < children.length && (children[last]?.position?.end.offset ?? Infinity) < boundary) last++;
        const lastEnd = children[last]?.position?.end.offset;
        const lastNode = children[last];
        const tail =
          lastNode?.type === "paragraph"
            ? lastNode.children.filter((child) => (child.position?.start.offset ?? -1) >= boundary)
            : [];
        const canSplit =
          lastNode?.type === "paragraph" &&
          tail.length > 0 &&
          lastNode.children.every(
            (child) =>
              (child.position?.end.offset ?? Infinity) <= boundary || (child.position?.start.offset ?? -1) >= boundary
          );
        const htmlTail = htmlSource.slice(boundary, lastEnd);
        const sourceTail = source.slice(boundary, lastEnd);
        const tailIsHtml = sourceTail.replace(/\s/g, "") === htmlTail.replace(/\s/g, "");
        if (
          validShape &&
          location.endTag &&
          boundary - start <= limit &&
          !quote.find("blockquote").length &&
          lastEnd !== undefined &&
          lastEnd >= boundary &&
          !codeRanges.some(([codeStart, codeEnd]) => codeStart < (canSplit ? boundary : lastEnd) && codeEnd > start) &&
          (canSplit ||
            children[last]?.type === "html" ||
            (tailIsHtml &&
              (/^\s*<\w+\b[^>]*>[\s\S]*<\/\w+\s*>\s*$/i.test(htmlTail) || onlyIgnorableHtml.test(htmlTail))))
        ) {
          restored.add(start);
          const prefix = node.value.slice(0, start - nodeStart);
          const suffix =
            lastNode?.type === "html"
              ? withoutWidgets(lastNode.value.slice(boundary - (lastNode.position?.start.offset ?? boundary)))
              : "";
          const replacement: RootContent[] = [];
          if (prefix) replacement.push({ ...node, value: prefix });
          replacement.push({
            type: "paragraph",
            children: [{ type: "link", url: validShape.url, children: [{ type: "text", value: validShape.url }] }],
            position: {
              start: { line: location.startTag.startLine, column: location.startTag.startCol, offset: start },
              end: { line: location.endTag.endLine, column: location.endTag.endCol, offset: boundary },
            },
          });
          if (suffix && lastNode?.type === "html" && lastNode.position) {
            const lines = source.slice(0, boundary).split("\n");
            replacement.push({
              ...lastNode,
              value: suffix,
              position: {
                start: { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1, offset: boundary },
                end: lastNode.position.end,
              },
            });
          }
          if (canSplit) {
            lastNode.children = tail;
            if (lastNode.position && tail[0]?.position) lastNode.position.start = tail[0].position.start;
            replacement.push(lastNode);
          }
          // 引用の直後の widgets.js の script は埋め込みに含まれるため、取り除く
          const next = children[last + 1];
          const script = next?.type === "html" && widgetsScript.test(next.value) && !withoutWidgets(next.value).trim();
          children.splice(i, last - i + 1 + (script ? 1 : 0), ...replacement);
          if (prefix) i++;
          break;
        }
        ranges.push([start, boundary]);
        defect("分割された引用内の埋め込みを無視しました", file.path);
      }
    }
  };
  process(tree.children, source.length);
};
