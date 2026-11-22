import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import ts from "typescript";
import { expect, it, vi } from "vitest";

it("rejects scripts in main before adding CSP hashes", async () => {
  const original = readFileSync("src/server/plugins/csp.ts", "utf8");
  const source = original.replace("import.meta.prerender", "true");
  expect(source).not.toBe(original);
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
  interface Response {
    body: string;
  }
  type Hook = (response: Response) => void;
  vi.stubGlobal("defineNitroPlugin", (callback: unknown) => callback);
  try {
    const module: unknown = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    const isPlugin = (
      value: unknown
    ): value is { default: (app: { hooks: { hook: (name: string, callback: Hook) => void } }) => void } =>
      typeof value === "object" && value !== null && "default" in value && typeof value.default === "function";
    assert.ok(isPlugin(module));
    const plugin = module.default;
    let hook: Hook | undefined;
    plugin({
      hooks: {
        hook: (_name: string, callback: Hook) => {
          hook = callback;
        },
      },
    });
    const handler = hook;
    assert.ok(handler);
    expect(() => {
      handler({ body: "<!DOCTYPE html><head></head><main><script>alert(1)</script></main>" });
    }).toThrow(/本文に script/);
    expect(() => {
      handler({
        body: '<!DOCTYPE html><head></head><main><script src="https://platform.twitter.com/widgets.js"></script></main>',
      });
    }).toThrow(/本文に script/);
    const response = { body: "<!DOCTYPE html><head></head><main>safe</main><script>safe()</script>" };
    handler(response);
    expect(response.body).toContain("Content-Security-Policy");
  } finally {
    vi.unstubAllGlobals();
  }
});
