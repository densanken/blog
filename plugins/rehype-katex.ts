import rehypeKatex from "rehype-katex";

import type { Root } from "hast";
import type { VFile } from "vfile";

// \char と \@char は任意の文字を出力でき、不可視文字の検査（KaTeX より前に実行する）をすり抜けるため、未定義の命令にする
const disabledMacros = { "\\char": "\\charIsDisabled", "\\@char": "\\charIsDisabled" };

// KaTeX は \gdef などで macros を書き換えるので、ファイルごとに新しい macros を渡し、別の記事やプレビューへ定義を持ち越さない
export default () => (tree: Root, file: VFile) => {
  rehypeKatex({ macros: { ...disabledMacros } })(tree, file);
};
