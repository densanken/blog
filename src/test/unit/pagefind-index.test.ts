import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { buildPagefindFiles, contentsFingerprint } from "../../server/utils/pagefind-index.ts";

const fakeIndex = (overrides: { add?: (url: string) => string[]; files?: string[] } = {}) => ({
  addHTMLFile: vi.fn(({ url }: { url: string }) => Promise.resolve({ errors: overrides.add?.(url) ?? [] })),
  getFiles: vi.fn(() =>
    Promise.resolve({ errors: overrides.files ?? [], files: [{ path: "pagefind.js", content: new Uint8Array([1]) }] })
  ),
  deleteIndex: vi.fn(() => Promise.resolve()),
});
const page = (status = 200) => Promise.resolve(new Response("<html></html>", { status }));

describe("buildPagefindFiles", () => {
  it("adds every page and returns the files, then releases the index", async () => {
    const index = fakeIndex();
    const files = await buildPagefindFiles({ index, urls: ["/a/", "/b/"], fetchPage: () => page() });
    expect([...files.keys()]).toEqual(["pagefind.js"]);
    expect(index.addHTMLFile).toHaveBeenCalledTimes(2);
    expect(index.deleteIndex).toHaveBeenCalledTimes(1);
  });
  it("does not publish an index that lacks a page whose fetch failed, and releases the index", async () => {
    const index = fakeIndex();
    await expect(
      buildPagefindFiles({ index, urls: ["/a/", "/b/"], fetchPage: (url) => page(url === "/b/" ? 500 : 200) })
    ).rejects.toThrow("/b/ を取得できません（HTTP 500）");
    expect(index.deleteIndex).toHaveBeenCalledTimes(1);
  });
  it("releases the index when a later fetch throws after pages were added", async () => {
    const index = fakeIndex();
    await expect(
      buildPagefindFiles({
        index,
        urls: ["/a/", "/b/"],
        fetchPage: (url) => (url === "/b/" ? Promise.reject(new Error("offline")) : page()),
      })
    ).rejects.toThrow("offline");
    expect(index.addHTMLFile).toHaveBeenCalledTimes(1);
    expect(index.deleteIndex).toHaveBeenCalledTimes(1);
  });
  it("fails when Pagefind reports an error for a page or for the files", async () => {
    const adding = fakeIndex({ add: () => ["bad html"] });
    await expect(buildPagefindFiles({ index: adding, urls: ["/a/"], fetchPage: () => page() })).rejects.toThrow(
      "bad html"
    );
    expect(adding.deleteIndex).toHaveBeenCalledTimes(1);
    const files = fakeIndex({ files: ["cannot write"] });
    await expect(buildPagefindFiles({ index: files, urls: ["/a/"], fetchPage: () => page() })).rejects.toThrow(
      "cannot write"
    );
    expect(files.deleteIndex).toHaveBeenCalledTimes(1);
  });
});

describe("contentsFingerprint", () => {
  it("changes when a file other than the newest one is deleted or added", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fingerprint-"));
    try {
      mkdirSync(join(dir, "writer"));
      writeFileSync(join(dir, "writer/profile.yaml"), "name: Writer\n");
      writeFileSync(join(dir, "writer/a.md"), "a");
      writeFileSync(join(dir, "writer/b.md"), "b");
      utimesSync(join(dir, "writer/a.md"), 100, 100);
      utimesSync(join(dir, "writer/b.md"), 200, 200);
      const before = await contentsFingerprint(dir);
      expect(await contentsFingerprint(dir)).toBe(before);
      // 最新（b.md）ではない a.md の削除は、最大の更新時刻を変えない
      rmSync(join(dir, "writer/a.md"));
      const deleted = await contentsFingerprint(dir);
      expect(deleted).not.toBe(before);
      writeFileSync(join(dir, "writer/c.md"), "c");
      utimesSync(join(dir, "writer/c.md"), 50, 50);
      expect(await contentsFingerprint(dir)).not.toBe(deleted);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
