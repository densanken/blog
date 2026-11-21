import { createRequire } from "node:module";

const rehypeRequire = createRequire(import.meta.resolve("rehype-katex"));
export const katexCss = rehypeRequire.resolve("katex/dist/katex.min.css");
