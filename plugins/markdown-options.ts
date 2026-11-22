import { createRequire } from "node:module";

const rehypeRequire = createRequire(import.meta.resolve("rehype-katex"));
export const katexCss = rehypeRequire.resolve("katex/dist/katex.min.css");

// \char と \@char は任意の文字を出力でき、不可視文字の検査（KaTeX より前に実行する）をすり抜けるため、未定義の命令にする
export const katexOptions = { macros: { "\\char": "\\charIsDisabled", "\\@char": "\\charIsDisabled" } };
