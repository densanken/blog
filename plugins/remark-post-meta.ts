import { toString } from "mdast-util-to-string";

import type { ArticleFile } from "./article-state.ts";
import type { Root, RootContent } from "mdast";
import type { VFile } from "vfile";

const excerptLength = 120;

// description がない記事の概要になる、本文の先頭の抜粋（見出し、コード、リンクだけの段落を除く）
const excerpt = (tree: Root) => {
  const text = tree.children
    .filter((node) => node.type === "paragraph" && !(node.children.length === 1 && node.children[0]?.type === "link"))
    .map((paragraph) => toString(paragraph))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= excerptLength) return text;
  const head = text.slice(0, excerptLength);
  // 文の区切りがあれば、そこまでにする
  const end = head.lastIndexOf("。");
  return end > excerptLength / 2 ? head.slice(0, end + 1) : `${head}…`;
};

const readable = (node: Root | RootContent, inLink = false): string => {
  if (node.type === "html" || node.type === "definition") return "";
  if (node.type === "image" || node.type === "imageReference") return node.alt ?? "";
  if (node.type === "code" || node.type === "inlineCode") return node.value;
  if (node.type === "link" && node.children.length === 1 && node.children[0]?.type === "text") {
    const text = node.children[0].value;
    const length = (node.position?.end.offset ?? 0) - (node.position?.start.offset ?? 0);
    if (
      (`http://${text}` === node.url && length === text.length) ||
      (text === node.url && (length === text.length || length === text.length + 2))
    )
      return "";
  }
  if ("children" in node)
    return node.children
      .map((child) => readable(child, inLink || node.type === "link" || node.type === "linkReference"))
      .join("");
  if (node.type === "text")
    return inLink ? node.value : node.value.replace(/https?:\/\/[^\s<>]+/gi, "").replace(/<[^>]*>/g, "");
  return "";
};

// 記事のメタデータを求める
// readingTime: 日本語を1分あたり約 500 文字で読むものとして、読了までの時間（分）
// excerpt: 本文の先頭の抜粋
export default () => (tree: Root, file: VFile) => {
  file.data.readingTime = Math.max(1, Math.ceil(readable(tree).replace(/\s/g, "").length / 500));
  const context = (file as VFile & ArticleFile).articleContext;
  if (context) context.excerpt = excerpt(tree);
};
