import { toString } from "hast-util-to-string";
import rehypeKatex from "rehype-katex";
import { visit } from "unist-util-visit";

import { cleanTextUnicode } from "./unicode.ts";
import { defect } from "./warn.ts";

import type { Root } from "hast";
import type { VFile } from "vfile";

const mathClasses = ["language-math", "math-display", "math-inline"];
// \char と \@char は任意の文字を出力でき、不可視文字の検査（KaTeX より前に実行する）をすり抜ける
// \neq などの標準の命令も内部で \char を使うので、macros で無効にせず、作者が直接書いた数式だけを描画しない
// KaTeX には命令の名前を組み立てる \csname がないため、ソースに書かれていなければ呼び出せない
const charCommand = /\\@?char(?![A-Za-z@])/;

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
  // エラーの title は、位置を示す結合文字で絵文字のタグ列が分断され、不可視文字が残ることがある
  visit(tree, "element", (node) => {
    const { className, title } = node.properties;
    if (Array.isArray(className) && className.includes("katex-error") && typeof title === "string")
      node.properties.title = cleanTextUnicode(title).value;
  });
};
