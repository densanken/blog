import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import { chromium } from "playwright";

import type { IncomingMessage, ServerResponse } from "node:http";

const root = resolve(".output/public");
const serve = async (request: IncomingMessage, response: ServerResponse) => {
  try {
    const path = resolve(root, `.${decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("invalid path");
    const file = (await stat(path)).isDirectory() ? join(path, "index.html") : path;
    const types: Record<string, string> = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".json": "application/json",
      ".css": "text/css",
    };
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
};
const server = createServer((request, response) => {
  void serve(request, response);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${String(address.port)}`;
let browser;
try {
  browser = await chromium.launch({ chromiumSandbox: true });
  const page = await browser.newPage();
  await page.route("**/*", (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
  const responses: Promise<number>[] = [];
  const failures: string[] = [];
  page.on("requestfailed", (request) => {
    if (request.url().startsWith(origin)) failures.push(request.url());
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.url().startsWith(origin) && (path.endsWith(".js") || path.endsWith("/_payload.json"))) {
      if (!response.ok()) failures.push(response.url());
      responses.push(response.body().then((body) => body.byteLength));
    }
  });
  const response = await page.goto(`${origin}/@writer/hello/`, { waitUntil: "networkidle" });
  assert.equal(response?.status(), 200);
  const inline = await page.evaluate(() =>
    [...document.scripts]
      .filter((script) => !script.src)
      .reduce((sum, script) => sum + new TextEncoder().encode(script.textContent).length, 0)
  );
  const bytes = (await Promise.all(responses)).reduce((sum, size) => sum + size, inline);
  assert.deepEqual(failures, []);
  assert.ok(bytes <= 400_000, `Article JavaScript and payload: ${String(bytes)} bytes (limit: 400000)`);
  process.stdout.write(`Article JavaScript and payload: ${String(bytes)} bytes\n`);
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    })
  );
}
