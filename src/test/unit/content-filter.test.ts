import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { excludedFiles } from "../../../plugins/content-filter.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "blog-test-"));
  dirs.push(dir);
  return dir;
};
const author = (dir: string, name = "writer") => {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(join(dir, name, "profile.yaml"), "name: Writer\n");
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("excludedFiles", () => {
  it("excludes hidden files and directories, which @nuxt/content collects", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    author(dir);
    mkdirSync(join(dir, "writer/.draft"));
    writeFileSync(join(dir, "writer/.draft/post.md"), "---\ntitle: Draft\ndate: 2099-01-01\n---\n");
    writeFileSync(join(dir, "writer/post.md"), "---\ntitle: Post\ndate: 2020-01-01\n---\n");
    const result = excludedFiles(dir);
    for (const list of [result.posts, result.profiles])
      expect(list).toEqual(expect.arrayContaining(["**/.*", "**/.*/**"]));
    // 通常の記事は、除外しない
    expect(result.posts).not.toContain("writer/post.md");
    expect(result.posts).not.toContain("writer/**");
  });

  it("does not drop a profile that has invisible characters, like the author check", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    mkdirSync(join(dir, "writer"));
    writeFileSync(join(dir, "writer/profile.yaml"), "\u200b# note\nname: Writer\n");
    writeFileSync(join(dir, "writer/post.md"), "---\ntitle: Post\ndate: 2020-01-01\n---\n");
    const result = excludedFiles(dir);
    expect(result.posts).not.toContain("writer/**");
    expect(result.profiles).not.toContain("writer/profile.yaml");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("不可視文字"));
  });

  // 大文字小文字を区別しないファイルシステム（macOS の既定など）では、`post.MD` と `post.md` を同時に作れない
  const caseSensitive = (() => {
    const dir = temp();
    writeFileSync(join(dir, "a"), "");
    return !existsSync(join(dir, "A"));
  })();
  it.skipIf(!caseSensitive)("does not let an unpublished extension hide a lowercase .md of the same name", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    author(dir);
    writeFileSync(join(dir, "writer/post.MD"), "---\ntitle: Upper\ndate: 2020-01-01\n---\n");
    writeFileSync(join(dir, "writer/post.md"), "---\ntitle: Lower\ndate: 2020-01-01\n---\n");
    const result = excludedFiles(dir);
    expect(result.posts).toContain("writer/post.MD");
    expect(result.posts).not.toContain("writer/post.md");
  });

  it.skipIf(!caseSensitive)("still detects a duplicate between .md files whose names differ only in case", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    author(dir);
    writeFileSync(join(dir, "writer/Post.md"), "---\ntitle: A\ndate: 2020-01-01\n---\n");
    writeFileSync(join(dir, "writer/post.md"), "---\ntitle: B\ndate: 2020-01-01\n---\n");
    // 並べ替えで後ろになる `post.md` が、重複として除外される
    const result = excludedFiles(dir);
    expect(result.posts).toContain("writer/post.md");
    expect(result.posts).not.toContain("writer/Post.md");
  });
});
