import { toString } from "hast-util-to-string";
import rehypeKatex from "rehype-katex";
import { SKIP, visit } from "unist-util-visit";

import { cleanTextUnicode, cleanUnicode } from "./unicode.ts";
import { defect } from "./warn.ts";

import type { Element, Root } from "hast";
import type { VFile } from "vfile";

const mathClasses = ["language-math", "math-display", "math-inline"];
// \char と \@char は任意の文字を出力でき、不可視文字の検査（KaTeX より前に実行する）をすり抜ける
// \neq などの標準の命令も内部で \char を使うので、macros で無効にせず、作者が直接書いた数式だけを描画しない
// 直接書いた \char は、分かりやすい警告を出すためにここで止め、標準の命令から取り出した \char は描画結果の検査で止める
const charCommand = /\\@?char(?![A-Za-z@])/;
// KaTeX が自分で出力する不可視文字（vlist のゼロ幅スペースと、MathML の見えない演算子）
const katexInvisible = /[\u200b\u2061-\u2064]/g;

const hasClass = (node: Element, name: string) =>
  Array.isArray(node.properties.className) && node.properties.className.includes(name);

export default () => (tree: Root, file: VFile) => {
  visit(tree, "element", (node) => {
    const classes = node.properties.className;
    if (!Array.isArray(classes) || !classes.some((name) => typeof name === "string" && mathClasses.includes(name)))
      return;
    if (!charCommand.test(toString(node))) return;
    // 数式のクラスを外し、KaTeX に描画させずにソースのまま残す
    node.properties.className = classes.filter((name) => typeof name !== "string" || !mathClasses.includes(name));
    defect("数式の \\char は使えないため、描画せずにソースのまま残しました", file.path);
  });
  // KaTeX は \gdef などで macros を書き換えるので、ファイルごとに新しい macros を渡し、別の記事やプレビューへ定義を持ち越さない
  rehypeKatex({ macros: {} })(tree, file);
  // \def で標準の命令の展開を組み替えると、内部の \char を取り出して任意の文字を出力できるため、描画結果も検査する
  visit(tree, "element", (node, index, parent) => {
    if (!parent || index === undefined) return;
    if (!hasClass(node, "katex-display") && !(hasClass(node, "katex") && !hasClass(parent as Element, "katex-display")))
      return;
    if (!cleanUnicode(toString(node).replace(katexInvisible, "")).changed) return SKIP;
    let source = "";
    visit(node, "element", (child) => {
      if (child.tagName === "annotation" && child.properties.encoding === "application/x-tex") source = toString(child);
    });
    parent.children[index] = {
      type: "element",
      tagName: "code",
      properties: {},
      children: [{ type: "text", value: source }],
    };
    defect("数式の描画結果に不可視文字が含まれるため、描画せずにソースのまま残しました", file.path);
    return SKIP;
  });
  // エラーの title は、位置を示す結合文字で絵文字のタグ列が分断され、不可視文字が残ることがある
  visit(tree, "element", (node) => {
    const { className, title } = node.properties;
    if (Array.isArray(className) && className.includes("katex-error") && typeof title === "string")
      node.properties.title = cleanTextUnicode(title).value;
  });
};
