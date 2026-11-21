import { createRequire } from "node:module";

import { expect, it } from "vitest";

import { katexCss } from "../../../plugins/markdown-options.ts";

it("uses the same KaTeX for rendering and CSS", () => {
  const require = createRequire(import.meta.url);
  const rehypeRequire = createRequire(require.resolve("rehype-katex"));
  expect(katexCss).toBe(rehypeRequire.resolve("katex/dist/katex.min.css"));
});
