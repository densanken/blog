import assert from "node:assert/strict";
import { createServer } from "node:http";

import { h } from "hastscript";
import rehypeMermaid from "rehype-mermaid";
import { unified } from "unified";

import { mermaidOptions } from "../../plugins/mermaid-options.ts";
import toolbar from "../../plugins/rehype-mermaid-toolbar.ts";

import type { Root } from "hast";

assert.equal(mermaidOptions.launchOptions.chromiumSandbox, true);
assert.equal(mermaidOptions.mermaidConfig.securityLevel, "strict");

const requests = { count: 0 };
const server = createServer((_req, res) => {
  requests.count++;
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  const tree: Root = {
    type: "root",
    children: [
      h("pre", [
        h(
          "code.language-mermaid",
          `flowchart TD\n A@{ img: "http://127.0.0.1:${String(port)}/audit", label: "test", w: 60, h: 60 }`
        ),
      ]),
      h("pre", [h("code.language-mermaid", "graph TD; A-->B")]),
      h("pre", [h("code.language-mermaid", `flowchart TD\n A["<img src='/contents/other/assets/secret.png'>"]`)]),
      h("pre", [
        h("code.language-mermaid", 'flowchart TD\n A --> B\n click A "https://example.com"\n click B call callback()'),
      ]),
    ],
  };
  const control = structuredClone(tree);
  const result = await unified()
    .use(rehypeMermaid, { ...mermaidOptions, errorFallback: () => h("span", "blocked") })
    .use(toolbar)
    .run(tree);
  assert.equal(requests.count, 0);
  assert.equal(result.children[1]?.type === "element" && result.children[1].tagName, "div");
  assert.doesNotMatch(JSON.stringify(result.children[2]), /"tagName":"(?:img|image)"/);
  assert.doesNotMatch(
    JSON.stringify(result.children[3]),
    /"tagName":"a"|"on[a-z]+"|https:\/\/example\.com|callback\(\)/i
  );
  await unified()
    .use(rehypeMermaid, {
      mermaidConfig: mermaidOptions.mermaidConfig,
      launchOptions: { chromiumSandbox: true },
      errorFallback: () => h("span", "blocked"),
    })
    .run(control);
  assert.notEqual(requests.count, 0);
} finally {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    })
  );
}
