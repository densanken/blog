import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { allowedExtensions, extensionOf } from "../../../plugins/allowed-files.ts";
import { excludedFiles } from "../../../plugins/content-filter.ts";
import { checkImage, readLocalImage } from "../../../plugins/image-check.ts";
import { jstDate } from "../../../plugins/jst.ts";
import { validateAuthor, validatePost } from "../../../plugins/validate-content.ts";
import { warn } from "../../../plugins/warn.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "blog-test-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("content validation", () => {
  it("restricts extensions to the last case-insensitive suffix", () => {
    expect(allowedExtensions.has(extensionOf("image.PNG"))).toBe(true);
    expect(allowedExtensions.has(extensionOf("image.png.html"))).toBe(false);
  });
  it("validates optional profile fields without coercing objects", () => {
    expect(validateAuthor({ name: "A", github: {}, website: [], icon: {}, x: 1, bio: [], admissionYear: {} })).toEqual({
      name: "A",
      github: undefined,
      website: undefined,
      icon: undefined,
      x: undefined,
      twitter: undefined,
      bio: undefined,
      admissionYear: undefined,
    });
    expect(
      validateAuthor({
        name: "A",
        github: "valid-name",
        x: "valid_1",
        website: "https://example.com",
        icon: "assets/a.png",
        admissionYear: "2024年度",
      })
    ).toMatchObject({
      github: "valid-name",
      x: "valid_1",
      website: "https://example.com",
      icon: "assets/a.png",
      admissionYear: "2024年度",
    });
    for (const icon of [
      "/author-icons/a.webp",
      "assets/../a.png",
      "http://example.com/a.png",
      "https://u:p@example.com/a.png",
    ])
      expect(validateAuthor({ name: "A", icon }).icon).toBeUndefined();
    expect(validateAuthor({ name: "A", website: "https://u:p@example.com", admissionYear: 2024 })).toMatchObject({
      website: undefined,
      admissionYear: "2024",
    });
    expect(() => validateAuthor({ name: [] })).toThrow();
    expect(() => validatePost({ title: "A", date: {} })).toThrow();
    expect(() => validatePost({ title: "A", date: "2026-02-30" })).toThrow();
    expect(() => validatePost({ title: "A", date: "2026-01-01T00:00:00Z" })).toThrow();
    expect(validatePost({ title: "A", date: "2024-02-29" }).date).toBe("2024-02-29");
  });
  it("filters scheduled posts, invalid YAML, paths, authors and symlinks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T14:59:59Z"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    mkdirSync(join(dir, "ok", "page"), { recursive: true });
    mkdirSync(join(dir, "bad id"));
    mkdirSync(join(dir, "invalid"));
    mkdirSync(join(dir, "unreadable/profile.yaml"), { recursive: true });
    writeFileSync(join(dir, "unreadable/profile.yml"), "name: Alternate\n");
    writeFileSync(join(dir, "ok/profile.yaml"), "\ufeffname: Test\n");
    writeFileSync(join(dir, "ok/profile.yml"), "name: Alternate\n");
    writeFileSync(join(dir, "ok/today.md"), "---\ndate: 2026-01-01\n---\n");
    writeFileSync(join(dir, "ok/crafted.md"), "---\ndate: {toString: bad}\n---\n");
    writeFileSync(join(dir, "ok/datetime.md"), "---\ndate: 2026-01-01T00:00:00Z\n---\n");
    writeFileSync(join(dir, "ok/prefix.md"), "---\ntitle: one\n----\ntitle: two\n---\n");
    writeFileSync(join(dir, "ok/impossible.md"), "---\ndate: 2026-02-30\n---\n");
    writeFileSync(join(dir, "ok/future.md"), "---\ndate: 2026-01-02\n---\n");
    writeFileSync(join(dir, "ok/duplicate.md"), "---\ntitle: one\ntitle: two\n---\n");
    writeFileSync(join(dir, "ok/a.b.md"), "text");
    writeFileSync(join(dir, "invalid/profile.yaml"), "name: one\nname: two\n");
    symlinkSync(join(dir, "ok/today.md"), join(dir, "ok/link.md"));
    symlinkSync(join(dir, "ok"), join(dir, "linked"));
    const result = excludedFiles(dir);
    expect(result.posts).toEqual(
      expect.arrayContaining([
        "*/page/**",
        "ok/future.md",
        "ok/crafted.md",
        "ok/impossible.md",
        "ok/datetime.md",
        "ok/duplicate.md",
        "ok/a.b.md",
        "ok/link.md",
        "linked/**",
        "invalid/**",
        "unreadable/**",
        "bad id/**",
      ])
    );
    expect(result.profiles).toContain("ok/profile.yml");
    expect(result.posts).not.toContain("ok/today.md");
    expect(result.posts).not.toContain("ok/prefix.md");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("ok/crafted.md"));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("ok/impossible.md"));
    expect(excludedFiles(dir, { scheduled: false }).posts).not.toContain("ok/future.md");
    vi.setSystemTime(new Date("2026-01-01T15:00:00Z"));
    expect(excludedFiles(dir).posts).not.toContain("ok/future.md");
  });
  it("ignores meta.yaml", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    mkdirSync(join(dir, "writer"));
    writeFileSync(join(dir, "writer/profile.yaml"), "name: Writer\n");
    writeFileSync(join(dir, "writer/post.md"), "---\ndate: 2020-01-01\n---\nBody");
    writeFileSync(join(dir, "writer/meta.yaml"), "editors: [team:blog-ccs, invalid_name]\n");
    const result = excludedFiles(dir);
    expect(result.posts).not.toContain("writer/**");
    expect(result.profiles).not.toContain("writer/profile.yaml");
    expect(warning).not.toHaveBeenCalled();
  });
  it("prunes cards even when the index page was not generated", () => {
    const dir = temp();
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "plugins"));
    mkdirSync(join(dir, ".output/public/_cards"), { recursive: true });
    cpSync("scripts/prune-cards.ts", join(dir, "scripts/prune-cards.ts"));
    for (const file of ["site", "warn"]) cpSync(`plugins/${file}.ts`, join(dir, `plugins/${file}.ts`));
    symlinkSync(join(process.cwd(), "node_modules"), join(dir, "node_modules"), "dir");
    writeFileSync(join(dir, ".output/public/_cards/aaaaaaaaaaaaaaaa.webp"), "unused");
    const result = spawnSync(process.execPath, [join(dir, "scripts/prune-cards.ts")], { cwd: dir, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(() => readFileSync(join(dir, ".output/public/_cards/aaaaaaaaaaaaaaaa.webp"))).toThrow();
  });
  it("excludes posts and profiles with excessive YAML aliases", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    mkdirSync(join(dir, "writer"));
    mkdirSync(join(dir, "bomb"));
    const bomb = `a: &a [x, x, x, x, x, x, x, x, x, x]\nb: &b [${Array(10).fill("*a").join(", ")}]\nc: [${Array(10).fill("*b").join(", ")}]\n`;
    writeFileSync(join(dir, "writer/profile.yaml"), "name: Writer\n");
    writeFileSync(join(dir, "writer/bomb.md"), `--- # comment\n${bomb}---\n`);
    writeFileSync(join(dir, "writer/profile.yml"), `name: Writer\n${bomb}`);
    writeFileSync(join(dir, "bomb/profile.yaml"), `name: Writer\n${bomb}`);
    writeFileSync(join(dir, "bomb/post.md"), "post");
    const result = excludedFiles(dir);
    expect(result.posts).toEqual(expect.arrayContaining(["writer/bomb.md", "bomb/**"]));
    expect(result.profiles).toEqual(expect.arrayContaining(["bomb/profile.yaml", "writer/profile.yml"]));
    expect(warning).toHaveBeenCalledTimes(3);
  });
  it("excludes asset names containing invisible characters", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    mkdirSync(join(dir, "writer/assets"), { recursive: true });
    writeFileSync(join(dir, "writer/profile.yaml"), "name: Writer\n");
    writeFileSync(join(dir, "writer/assets/a\u200bb.png"), "image");
    expect(excludedFiles(dir).posts).toContain("writer/assets/a\u200bb.png");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("名前に不可視文字"));
  });
  it("filters future dates even when the date key contains escaped invisible characters", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    mkdirSync(join(dir, "writer"));
    writeFileSync(join(dir, "writer/profile.yaml"), "name: Writer\n");
    writeFileSync(join(dir, "writer/post.md"), '---\ntitle: Post\n"\\u200bdate": "9999-01-01"\n---\n');
    expect(excludedFiles(dir).posts).toContain("writer/post.md");
    expect(excludedFiles(dir, { scheduled: false }).posts).not.toContain("writer/post.md");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("frontmatter の不可視文字"));
    writeFileSync(join(dir, "writer/post.md"), '---\ntitle: Post\nda&#x200b;te: "9999-01-01"\n---\n');
    expect(excludedFiles(dir).posts).toContain("writer/post.md");
    expect(excludedFiles(dir, { scheduled: false }).posts).not.toContain("writer/post.md");
  });
  it("cleans escaped invisible characters in profile keys before validation", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    mkdirSync(join(dir, "writer"));
    writeFileSync(join(dir, "writer/profile.yaml"), '"na\\u200bme": Writer\n');
    writeFileSync(join(dir, "writer/post.md"), '---\ntitle: Post\ndate: "2020-01-01"\n---\n');
    expect(excludedFiles(dir).posts).not.toContain("writer/**");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("プロフィールの不可視文字"));
  });
  it("warns when author names share a Unicode skeleton", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dir = temp();
    for (const [id, name] of [
      ["alpha", "paypal"],
      ["beta", "pаypal"],
    ] as const) {
      mkdirSync(join(dir, id));
      writeFileSync(join(dir, id, "profile.yaml"), `name: ${name}\n`);
    }
    const excluded = excludedFiles(dir);
    expect(excluded.profiles).not.toContain("beta/profile.yaml");
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("alpha と紛らわしい"));
  });
  it("continues fetching icons after invalid profile YAML", () => {
    const dir = temp();
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "plugins"));
    mkdirSync(join(dir, "src/shared/utils"), { recursive: true });
    cpSync("src/shared/utils/posts.ts", join(dir, "src/shared/utils/posts.ts"));
    cpSync("scripts/fetch-icons.ts", join(dir, "scripts/fetch-icons.ts"));
    for (const file of [
      "content-filter",
      "identifiers",
      "unicode",
      "url-guard",
      "site",
      "jst",
      "allowed-files",
      "warn",
      "validate-content",
      "unicode-data",
      "unicode-tables",
    ]) {
      cpSync(`plugins/${file}.ts`, join(dir, `plugins/${file}.ts`));
    }
    cpSync("plugins/paths.ts", join(dir, "plugins/paths.ts"));
    cpSync("plugins/content-paths.ts", join(dir, "plugins/content-paths.ts"));
    symlinkSync(join(process.cwd(), "node_modules"), join(dir, "node_modules"), "dir");
    writeFileSync(
      join(dir, "plugins/safe-fetch.ts"),
      'export const safeFetch = async (url) => { if (url !== "https://valid.example/icon") throw new Error("unexpected fetch"); return Buffer.from("valid"); };'
    );
    for (const name of ["bomb", "duplicate", "valid", "日本語", "missing-name", "bad id"])
      mkdirSync(join(dir, "contents/authors", name), { recursive: true });
    const bomb = `a: &a [x, x, x, x, x, x, x, x, x, x]\nb: &b [${Array(10).fill("*a").join(", ")}]\nc: [${Array(10).fill("*b").join(", ")}]\n`;
    writeFileSync(join(dir, "contents/authors/bomb/profile.yaml"), `icon: https://invalid.example/bomb\n${bomb}`);
    writeFileSync(
      join(dir, "contents/authors/duplicate/profile.yaml"),
      "icon: https://invalid.example/one\nicon: https://invalid.example/two\n"
    );
    writeFileSync(join(dir, "contents/authors/valid/profile.yaml"), "name: Valid\nicon: https://valid.example/icon\n");
    writeFileSync(
      join(dir, "contents/authors/日本語/profile.yaml"),
      "name: 日本語\nicon: https://valid.example/icon\n"
    );
    writeFileSync(
      join(dir, "contents/authors/valid/profile.yml"),
      "name: Other\nicon: https://invalid.example/other\n"
    );
    writeFileSync(join(dir, "contents/authors/missing-name/profile.yaml"), "icon: https://invalid.example/no-name\n");
    writeFileSync(
      join(dir, "contents/authors/bad id/profile.yaml"),
      "name: Invalid ID\nicon: https://invalid.example/id\n"
    );
    const result = spawnSync(process.execPath, [join(dir, "scripts/fetch-icons.ts")], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("invalid.example");
    expect(readFileSync(join(dir, ".cache/icons/valid.img"), "utf8")).toBe("valid");
    expect(() => readFileSync(join(dir, ".cache/icons/日本語.img"), "utf8")).toThrow();
  });
  it("escapes workflow annotation properties and data", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    warn("a%\n::error::x", "a,b:c\r.md");
    expect(log).toHaveBeenCalledWith("::warning file=a%2Cb%3Ac%0D.md::a%25%0A::error::x");
    expect(warning).toHaveBeenCalledWith("[content] a,b:c .md: a% ::error::x");
  });
});

describe("image verification", () => {
  it("checks magic bytes, extension, decode and size", async () => {
    const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    await expect(checkImage(png, "PNG")).resolves.toEqual({ type: "png", width: 2, height: 3 });
    await expect(checkImage(png, "jpg")).rejects.toThrow();
    await expect(checkImage(Buffer.from("<svg><script/></svg>"), "png")).rejects.toThrow();
    await expect(checkImage(Buffer.concat([Buffer.from("<html>"), png]), "png")).rejects.toThrow();
    await expect(checkImage(png.subarray(0, 30), "png")).rejects.toThrow();
    const oversized = Buffer.concat([png, Buffer.alloc(10_000_001 - png.length)]);
    await expect(sharp(oversized).toBuffer()).resolves.toBeInstanceOf(Buffer);
    await expect(checkImage(oversized, "png")).rejects.toThrow(/ファイルが大きすぎます/);
    const huge = await sharp({ create: { width: 7100, height: 7100, channels: 3, background: "red" } })
      .png()
      .toBuffer();
    await expect(sharp(huge, { limitInputPixels: false }).toBuffer()).resolves.toBeInstanceOf(Buffer);
    await expect(checkImage(huge, "png")).rejects.toThrow(/画素数が多すぎます/);
  });
  it("rejects animations with too many frames or pixels", async () => {
    const gif = async (width: number, height: number, pages: number) =>
      await sharp(Buffer.alloc(width * height * pages * 3), {
        raw: { width, height: height * pages, channels: 3, pageHeight: height },
      })
        .gif({ delay: Array.from({ length: pages }, () => 100), keepDuplicateFrames: true })
        .toBuffer();
    await expect(checkImage(await gif(2, 2, 201))).rejects.toThrow(/フレーム数/);
    await expect(checkImage(await gif(600, 600, 140))).rejects.toThrow(/画素数/);
  }, 20_000);
  it("refuses files outside assets and symlinks", () => {
    const dir = temp();
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "other"), "x");
    symlinkSync(join(dir, "other"), join(dir, "assets/link"));
    mkdirSync(join(dir, "external"));
    writeFileSync(join(dir, "external/image.png"), "x");
    symlinkSync(join(dir, "external"), join(dir, "assets/linked-dir"));
    mkdirSync(join(dir, "writer"));
    symlinkSync(join(dir, "external"), join(dir, "writer/assets"));
    expect(() => readLocalImage(join(dir, "assets"), join(dir, "other"))).toThrow();
    expect(() => readLocalImage(join(dir, "assets"), join(dir, "assets/link"))).toThrow();
    expect(() => readLocalImage(join(dir, "assets"), join(dir, "assets/linked-dir/image.png"))).toThrow();
    expect(() => readLocalImage(join(dir, "writer/assets"), join(dir, "writer/assets/image.png"))).toThrow();
  });
});

it("reads NUL-separated git history and converts to JST", async () => {
  vi.resetModules();
  const exec = vi.fn(
    () =>
      "\x002025-01-01T00:00:00Z\0\nodd\n name.md\0\x012030-01-01T00:00:00Z\0\nother.md\0\x002026-01-01T15:00:00Z\0\nmidnight.md\0\x002026-01-01T14:59:59Z\0\nbefore-midnight.md\0"
  );
  vi.doMock("node:child_process", () => ({ execFileSync: exec }));
  try {
    const { lastCommitDate } = await import("../../../plugins/git-updated.ts");
    expect(lastCommitDate("/fixture", "/fixture/odd\n name.md")).toBe("2025-01-01");
    expect(lastCommitDate("/fixture", "/fixture/\x012030-01-01T00:00:00Z")).toBe("2025-01-01");
    expect(lastCommitDate("/fixture", "/fixture/\nother.md")).toBe("2025-01-01");
    expect(lastCommitDate("/fixture", "/fixture/midnight.md")).toBe("2026-01-02");
    expect(lastCommitDate("/fixture", "/fixture/before-midnight.md")).toBe("2026-01-01");
    expect(lastCommitDate("/fixture", "/fixture/untracked.md")).toBeUndefined();
    expect(lastCommitDate("/another", "/another/odd\n name.md")).toBe("2025-01-01");
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenNthCalledWith(
      1,
      "git",
      [
        "-C",
        "/fixture",
        "-c",
        "core.quotepath=off",
        "log",
        "--no-renames",
        "--relative",
        "--name-only",
        "-z",
        "--format=%x00%cI",
      ],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
    expect(jstDate("2026-01-01T14:59:59Z")).toBe("2026-01-01");
  } finally {
    vi.doUnmock("node:child_process");
  }
});

it("applies Git dates, profile validation and symlink checks in the content hook", async () => {
  const dates = vi.fn();
  vi.doMock("../../../plugins/git-updated.ts", () => ({ lastCommitDate: dates }));
  vi.resetModules();
  const { afterParse } = await import("../../../plugins/content-hook.ts");
  const dir = temp();
  mkdirSync(join(dir, "writer/assets"), { recursive: true });
  const post = join(dir, "writer/post.md");
  const profile = join(dir, "writer/profile.yaml");
  writeFileSync(post, "post");
  writeFileSync(profile, "profile");
  writeFileSync(join(dir, "writer/assets/bad.png"), "<svg/>");
  const options = { contents: dir, iconCache: join(dir, "cache"), icons: join(dir, "icons") };
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T14:59:59Z"));
  const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  for (const [commit, expected] of [
    [undefined, undefined],
    ["2019-12-31", undefined],
    ["2020-01-01", undefined],
    ["2020-01-02", "2020-01-02"],
    ["2099-01-01", "2026-01-01"],
  ]) {
    dates.mockReturnValue(commit);
    const content = { title: "Post", date: "2020-01-01", updated: "2099-01-01" };
    await afterParse({ collection: { name: "posts" }, file: { path: post }, content }, options);
    expect(content.updated).toBe(expected);
  }
  vi.setSystemTime(new Date("2026-01-01T15:00:00Z"));
  dates.mockReturnValue("2099-01-01");
  const content: { title: string; date: string; updated?: string } = { title: "Post", date: "2020-01-01" };
  await afterParse({ collection: { name: "posts" }, file: { path: post }, content }, options);
  expect(content.updated).toBe("2026-01-02");
  const author = { name: "A", icon: "assets/bad.png", github: {}, stem: "victim/profile" };
  await afterParse({ collection: { name: "authors" }, file: { path: profile }, content: author }, options);
  expect(author).toMatchObject({ icon: undefined, github: undefined, stem: "writer/profile" });
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const pinnedAuthor = { name: "A", pinned: ["he\u200bllo", circular] };
  warnings.mockClear();
  await afterParse({ collection: { name: "authors" }, file: { path: profile }, content: pinnedAuthor }, options);
  expect(pinnedAuthor).toMatchObject({ name: "A", pinned: ["hello"] });
  expect(warnings).toHaveBeenCalledWith(expect.stringMatching(/pinned.*文字列以外/));
  const japaneseWebsite = { name: "A", website: "https://例え.テスト" };
  await afterParse({ collection: { name: "authors" }, file: { path: profile }, content: japaneseWebsite }, options);
  expect(japaneseWebsite).toMatchObject({
    websiteHost: "例え.テスト",
    websiteAscii: "xn--r8jz45g.xn--zckzah",
    websiteWarning: false,
  });
  const suspiciousWebsite = { name: "B", website: "https://goog1e.com" };
  await afterParse({ collection: { name: "authors" }, file: { path: profile }, content: suspiciousWebsite }, options);
  expect(suspiciousWebsite).toMatchObject({ websiteHost: "goog1e.com", websiteWarning: true });
  const unsafe = { title: "A\u202eB", date: "2020-01-01", meta: { tags: ["x\u200by"], nested: { name: "a\u061cb" } } };
  await afterParse({ collection: { name: "posts" }, file: { path: post }, content: unsafe }, options);
  expect(unsafe).toMatchObject({ title: "AB", meta: { tags: ["xy"], nested: { name: "ab" } } });
  const duplicateKey = { title: "Post", date: "2020-01-01", "ti\u200btle": "Spoof" };
  await expect(
    afterParse({ collection: { name: "posts" }, file: { path: post }, content: duplicateKey }, options)
  ).rejects.toThrow("キーが重複");
  const spoof = { title: "Post", date: "2020-01-01", stem: "victim/post", meta: { computedExcerpt: "spoof" } };
  await afterParse(
    { collection: { name: "posts" }, file: { path: post, articleContext: { excerpt: "body" } }, content: spoof },
    options
  );
  expect(spoof).toMatchObject({ stem: "writer/post", excerpt: "body" });
  symlinkSync(join(dir, "writer"), join(dir, "linked"));
  await expect(
    afterParse({ collection: { name: "posts" }, file: { path: join(dir, "linked/post.md") }, content }, options)
  ).rejects.toThrow(/シンボリックリンク/);
  vi.doUnmock("../../../plugins/git-updated.ts");
});

it("reads OGP icons from the configured directories", async () => {
  const { ogIcon } = await import("../../../plugins/og-icon.ts");
  const { cards } = await import("../../../plugins/paths.ts");
  const { saveAuthorIcon } = await import("../../../plugins/hosted-images.ts");
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  const icon = await saveAuthorIcon(png);
  expect(await ogIcon("writer", icon, { cards })).toMatch(/^data:image\/png;base64,/);
});

it("wraps OGP text at word boundaries and keeps whole emoji initials", async () => {
  const { ogInitial, ogLines } = await import("../../../plugins/og-text.ts");
  const lines = ogLines("CCS（千葉大学電子計算機研究会）のメンバーなどが自由気ままに書くブログです。", 17);
  expect(lines.join("")).toBe("CCS（千葉大学電子計算機研究会）のメンバーなどが自由気ままに書くブログです。");
  expect(lines.every((line) => !/^[、。）]/.test(line) && !/[（]$/.test(line))).toBe(true);
  expect(ogInitial("👨‍👩‍👧 家族")).toBe("👨‍👩‍👧");
  expect(ogInitial("")).toBe("");
});

it("validates and converts cached remote profile icons through the content hook", async () => {
  const { afterParse } = await import("../../../plugins/content-hook.ts");
  const dir = temp();
  mkdirSync(join(dir, "writer"));
  mkdirSync(join(dir, "cache"));
  const profile = join(dir, "writer/profile.yaml");
  writeFileSync(profile, "profile");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const options = { contents: dir, iconCache: join(dir, "cache"), icons: join(dir, "icons") };
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  for (const [source, valid] of [
    [png, true],
    [Buffer.from("<svg/>"), false],
    [Buffer.from("<html/>"), false],
  ] as const) {
    writeFileSync(join(dir, "cache/writer.img"), source);
    const content = { name: "Writer", icon: "https://example.com/icon.png" };
    await afterParse({ collection: { name: "authors" }, file: { path: profile }, content }, options);
    if (valid) expect(content.icon).toMatch(/^\/_cards\/[a-f\d]{16}\.webp,\/_cards\/[a-f\d]{16}\.webp$/);
    else expect(content.icon).toBeUndefined();
  }
});

it("reads profiles when the checkout path contains spaces and non-ASCII characters", () => {
  const dir = mkdtempSync(join(tmpdir(), "blog test 日本語-"));
  dirs.push(dir);
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "contents/authors/writer"), { recursive: true });
  mkdirSync(join(dir, "src/shared/utils"), { recursive: true });
  cpSync("src/shared/utils/posts.ts", join(dir, "src/shared/utils/posts.ts"));
  cpSync("scripts/fetch-icons.ts", join(dir, "scripts/fetch-icons.ts"));
  cpSync("plugins", join(dir, "plugins"), { recursive: true });
  symlinkSync(join(process.cwd(), "node_modules"), join(dir, "node_modules"), "dir");
  writeFileSync(join(dir, "plugins/safe-fetch.ts"), 'export const safeFetch = async () => Buffer.from("valid");');
  writeFileSync(
    join(dir, "contents/authors/writer/profile.yaml"),
    "name: Writer\nicon: https://example.com/icon.png\n"
  );
  const result = spawnSync(process.execPath, [join(dir, "scripts/fetch-icons.ts")], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(readFileSync(join(dir, ".cache/icons/writer.img"), "utf8")).toBe("valid");
});
