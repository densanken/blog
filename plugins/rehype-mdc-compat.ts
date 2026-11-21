import { relative } from "node:path";

import { toString } from "hast-util-to-string";
import { visit } from "unist-util-visit";

import { authorsPath } from "./content-paths.ts";
import { isCalloutType } from "./rehype-callouts.ts";
import { defect } from "./warn.ts";

import type { Root, Text } from "hast";
import type { VFile } from "vfile";

// style 属性に入る値なので、`;` や `:` を含められない形に限る
const color = /^(#[\da-f]{3,8}|(rgb|hsl)a?\([\w\s.,%/-]*\))$/i;
// Mermaid の変換に時間がかかりすぎないよう、図のソースの上限を決める
const maxMermaidLength = 10_000;
const maxMermaidCount = 50;

// MDC が生成する HTML を、後続のプラグインが扱える形に揃え、GitHub 相当の表示を補う
export default ({ contents }: { contents?: string } = {}) =>
  (tree: Root, file?: VFile) => {
    const path = file && contents ? `${authorsPath}/${relative(contents, file.path)}` : file?.path;
    let mermaidCount = 0;
    visit(tree, "element", (node, _index, parent) => {
      if (
        node.tagName === "pre" &&
        Array.isArray(node.properties.className) &&
        node.properties.className.includes("language-mermaid") &&
        node.children[0]?.type === "element" &&
        node.children[0].tagName === "code"
      ) {
        // `pre.language-mermaid > code` を rehype-mermaid が検出できる `code.language-mermaid` にする
        node.children[0].properties.className = ["language-mermaid"];
      }
      if (
        node.tagName === "code" &&
        Array.isArray(node.properties.className) &&
        node.properties.className.includes("language-mermaid")
      ) {
        const text = toString(node);
        // 設定を含む図はコードとして表示し、作者が図の見た目や動作を変更できないようにする
        if (text.length > maxMermaidLength || text.includes("%%{") || /^\s*---/.test(text)) {
          node.properties.className = [];
        } else if (++mermaidCount > maxMermaidCount) {
          node.properties.className = [];
          if (mermaidCount === maxMermaidCount + 1) {
            defect(`${path ?? "記事"} の Mermaid 図は ${String(maxMermaidCount)} 件まで変換します`, path);
          }
        }
        node.children = [{ type: "text", value: text }];
      }
      // 脚注の見出し（読み上げ専用）と、脚注から戻るリンク（↩）は、検索のインデックスに入れない
      if (node.properties.dataFootnoteBackref !== undefined || node.properties.id === "user-content-footnote-label") {
        node.properties.dataPagefindIgnore = "";
      }
      if (node.tagName === "blockquote") {
        // MDC が `[!NOTE]` を span として解釈するため、rehype-callouts が検出できるよう元のテキストに戻す
        const paragraph = node.children.find((child) => child.type === "element" && child.tagName === "p");
        const [span, br] = paragraph?.type === "element" ? paragraph.children : [];
        const start = span?.position?.start.offset;
        const end = span?.position?.end.offset;
        const source = start !== undefined && end !== undefined ? String(file?.value ?? "").slice(start, end) : "";
        if (
          paragraph?.type === "element" &&
          span?.type === "element" &&
          span.tagName === "span" &&
          /^\[![\w-]+]$/.test(source)
        ) {
          const marker: Text = { type: "text", value: source };
          if (isCalloutType(source.slice(2, -1))) {
            paragraph.children.splice(0, br?.type === "element" && br.tagName === "br" ? 2 : 1, marker);
          } else {
            paragraph.children.splice(0, 1, { type: "text", value: "[" }, ...span.children, {
              type: "text",
              value: "]",
            });
          }
        }
      }
      const image = node.children[0];
      if (
        node.tagName === "p" &&
        node.children.length === 1 &&
        image?.type === "element" &&
        image.tagName === "img" &&
        image.properties.title
      ) {
        // タイトル付きの画像（`![代替テキスト](URL "キャプション")`）だけの段落を、キャプション付きの figure にする
        const caption = image.properties.title;
        delete image.properties.title;
        node.tagName = "figure";
        node.children = [
          image,
          { type: "element", tagName: "figcaption", properties: {}, children: [{ type: "text", value: caption }] },
        ];
      }
      if (
        node.tagName === "code" &&
        (parent?.type !== "element" || parent.tagName !== "pre") &&
        node.children[0]?.type === "text" &&
        color.test(node.children[0].value)
      ) {
        // 色を表すインラインコードに色見本を付ける
        node.children.unshift({
          type: "element",
          tagName: "span",
          properties: { className: ["color-swatch"], style: `background-color: ${node.children[0].value}` },
          children: [],
        });
      }
    });
  };
