import { describe, expect, it } from "vitest";

import { duplicateOf, validIdentifier } from "../../../plugins/identifiers.ts";
import { inspectTextUrls, inspectUrl } from "../../../plugins/url-guard.ts";

describe("content identifiers and URLs", () => {
  it("limits identifiers to ASCII letters, numbers and hyphens", () => {
    expect(validIdentifier("DenSanken-123")).toBe(true);
    for (const value of ["", "a_b", "日本語", "a.b"]) expect(validIdentifier(value)).toBe(false);
  });
  it("keeps the first case-insensitive identifier and reports its original name", () => {
    const authors = new Map<string, string>();
    expect(duplicateOf(authors, "Densanken")).toBeUndefined();
    expect(duplicateOf(authors, "densanken")).toBe("Densanken");
    const slugs = new Map<string, string>();
    expect(duplicateOf(slugs, "Nested/Hello-World", "Nested/Hello-World.md")).toBeUndefined();
    expect(duplicateOf(slugs, "nested/hello-world", "nested/hello-world.md")).toBe("Nested/Hello-World.md");
  });
  it("displays Japanese IDNs as Unicode and other IDNs as ASCII", () => {
    expect(inspectUrl("https://例え.テスト")?.display).toBe("例え.テスト");
    expect(inspectUrl("https://пример.рф")?.display).toBe("xn--e1afmkfd.xn--p1ai");
    expect(inspectUrl("https://aа.example")?.mixed).toBe(true);
    expect(inspectUrl("https://กა.example")?.mixed).toBe(true);
    expect(inspectUrl("https://ա.example")?.mixed).toBe(false);
    expect(inspectUrl("https://аррӏе.com")?.confusable).toBe(true);
    expect(inspectUrl("https://аррӏе.com.")?.confusable).toBe(true);
    expect(inspectUrl("https://例え.テスト.")?.display).toBe("例え.テスト.");
    expect(inspectUrl("https://goog1e.com")?.confusable).toBe(true);
    expect(inspectUrl("https://例えa.テスト")?.mixed).toBe(false);
    for (const variant of ["ª", "Ⓐ"]) {
      expect(inspectUrl(`https://例え${variant}.test`)?.mixed).toBe(true);
      expect(inspectUrl(`https://例え${variant}.test`)?.display).toBe(new URL(`https://例え${variant}.test`).hostname);
    }
    const fullwidth = inspectUrl("https://例えＡ.テスト");
    expect(fullwidth?.mixed).toBe(true);
    expect(fullwidth?.display).toBe(new URL("https://例えＡ.テスト").hostname);
    expect(inspectUrl("https://%E4%BE%8B%E3%81%88%EF%BC%A1.test")?.mixed).toBe(true);
    expect(inspectUrl("https://ｇoogle.com\\@example.com")?.mixed).toBe(true);
    expect(inspectUrl("https://example.com\\@ｇoogle.com")?.mixed).toBe(false);
    expect(inspectUrl("https:ｇoogle.com")?.ascii).toBe("blog.densanken.com");
    expect(inspectUrl(" https://ｇoogle.com")?.mixed).toBe(true);
    expect(inspectUrl("https:\n//ｇoogle.com")?.mixed).toBe(true);
  });
  it("inspects URLs embedded in metadata strings", () => {
    expect(
      inspectTextUrls("See https://goog1e.com/path and https://example.com/").map((item) => item.confusable)
    ).toEqual([true, false]);
    expect(inspectTextUrls("[https://gоogle.com]")[0]?.confusable).toBe(true);
    expect(inspectTextUrls("https://example.com,https://gоogle.com").at(-1)?.confusable).toBe(true);
    expect(inspectTextUrls("https://[::1]")).toHaveLength(1);
    expect(inspectTextUrls("[https://gоogle.com](https://example.com)").some((item) => item.confusable)).toBe(true);
    expect(inspectTextUrls("【https://goog1e.com】").some((item) => item.confusable)).toBe(true);
    expect(inspectTextUrls("https://goog1e.com、").some((item) => item.confusable)).toBe(true);
  });
  it("detects a different domain in a URL-shaped label", () => {
    expect(inspectUrl("https://example.com", "https://google.com")?.mismatch).toBe(true);
    expect(inspectUrl("https://example.com", "//google.com")?.mismatch).toBe(true);
    expect(inspectUrl("/@writer/post", "google.com")?.mismatch).toBe(true);
    expect(inspectUrl("/例えª")?.idn).toBe(false);
    expect(inspectUrl("https://example.com", "https://例え.テスト")?.mismatch).toBe(true);
    expect(inspectUrl("https://example.com", "https://example.com/path")?.mismatch).toBe(false);
    expect(inspectUrl("https://example.com.", "https://example.com")?.mismatch).toBe(false);
    for (const dot of ["。", "．", "｡"]) {
      expect(inspectUrl("https://evil.example", `https://google${dot}com`)?.mismatch).toBe(true);
      expect(inspectUrl("https://evil.example", `google${dot}com`)?.mismatch).toBe(true);
      expect(inspectUrl("https://google.com", `https://google${dot}com`)?.mismatch).toBe(false);
    }
    expect(inspectUrl("https://evil.example", "http://localhost")?.mismatch).toBe(true);
    expect(inspectUrl("https://evil.example", "https://google。com login")?.mismatch).toBe(true);
    expect(inspectUrl("https://evil.example", "google。com login")?.mismatch).toBe(true);
  });
});
