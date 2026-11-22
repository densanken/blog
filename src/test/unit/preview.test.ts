import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { writePreviewHeaders } from "../../../plugins/preview.ts";

// site.ts は、読み込み時に環境変数から設定を決めるため、環境変数ごとに読み込み直す
const load = async (env: Record<string, string>) => {
  vi.resetModules();
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  return await import("../../../plugins/site.ts");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("site settings", () => {
  it("uses the production URL and excludes scheduled posts by default", async () => {
    const site = await load({ PREVIEW: "", SITE_URL: "", NODE_ENV: "production" });
    expect(site.preview).toBe(false);
    expect(site.siteUrl).toBe("https://blog.densanken.com");
    expect(site.excludeScheduled).toBe(true);
  });
  it("replaces the site URL with SITE_URL", async () => {
    const site = await load({ SITE_URL: "https://pr-1-blog.example.workers.dev/", PREVIEW: "" });
    expect(site.siteUrl).toBe("https://pr-1-blog.example.workers.dev");
    await expect(load({ SITE_URL: "javascript:alert(1)" })).rejects.toThrow(/SITE_URL/);
  });
  it("includes scheduled posts in a preview and requires SITE_URL", async () => {
    const site = await load({ PREVIEW: "1", SITE_URL: "https://example.workers.dev", NODE_ENV: "production" });
    expect(site.preview).toBe(true);
    expect(site.excludeScheduled).toBe(false);
    await expect(load({ PREVIEW: "1", SITE_URL: "" })).rejects.toThrow(/SITE_URL/);
  });
  it("includes scheduled posts in the dev server", async () => {
    expect((await load({ PREVIEW: "", NODE_ENV: "development" })).excludeScheduled).toBe(false);
  });
});

describe("preview output", () => {
  it("moves the common headers of public/.htaccess", () => {
    const dir = mkdtempSync(join(tmpdir(), "preview-test-"));
    try {
      cpSync("public/.htaccess", join(dir, ".htaccess"));
      writePreviewHeaders(dir);
      const headers = readFileSync(join(dir, "_headers"), "utf8");
      for (const name of ["Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy"])
        expect(headers).toMatch(new RegExp(`^  ${name}: \\S`, "m"));
      expect(headers).toMatch(/^\/\*\n/);
      expect(headers).toMatch(/^ {2}X-Robots-Tag: noindex, nofollow$/m);
      expect(headers).not.toContain("Cache-Control");
      expect(existsSync(join(dir, ".htaccess"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("prepends a banner with the pull request number", async () => {
    vi.stubEnv("PREVIEW_PR", "12");
    const withPr = await load({});
    const prepend: string[] = [];
    (await import("../../server/preview/banner.ts")).default({
      hooks: {
        hook: (_name, listener) => {
          listener({ bodyPrepend: prepend });
        },
      },
    });
    expect(withPr.previewPr).toBe("12");
    expect(prepend[0]).toContain("これはプレビューです（PR #12）");
    expect(prepend[0]).not.toContain("<script");
  });
  it("omits the number when PREVIEW_PR is not given", async () => {
    vi.stubEnv("PREVIEW_PR", "");
    await load({});
    const prepend: string[] = [];
    (await import("../../server/preview/banner.ts")).default({
      hooks: {
        hook: (_name, listener) => {
          listener({ bodyPrepend: prepend });
        },
      },
    });
    expect(prepend[0]).toContain(">これはプレビューです<");
  });
});
