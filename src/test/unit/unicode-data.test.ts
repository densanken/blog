import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  confusablesUrl,
  loadUnicodeTables,
  parseConfusables,
  parseScripts,
  readUnicodeTables,
} from "../../../plugins/unicode-data.ts";
import { skeleton } from "../../../plugins/unicode.ts";
import { inspectUrl } from "../../../plugins/url-guard.ts";

const confusables = "0430 ;\t0061 ;\tMA\t# ( а → a )\n\n# comment\n0031 ;\t006C ;\tMA\n";
const scripts =
  "0041..005A    ; Latin # L&\n0400..0481    ; Cyrillic # L&\n0020          ; Common\n0300..036F    ; Inherited\n";
const fetchText = vi.fn((url: string) => Promise.resolve(url === confusablesUrl ? confusables : scripts));

let dir: string;
let messages: string[];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "unicode-test-"));
  messages = [];
  vi.spyOn(console, "warn").mockImplementation((message: string) => void messages.push(message));
  fetchText.mockClear();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("Unicode dictionary", () => {
  it("parses confusables.txt and Scripts.txt", () => {
    expect(parseConfusables(confusables)).toEqual({ "430": "a", "31": "l" });
    expect(parseScripts(scripts)).toEqual([
      [0x41, 0x5a, "Latin"],
      [0x400, 0x481, "Cyrillic"],
    ]);
    expect(() => parseConfusables("# only comments\n")).toThrow();
    expect(() => parseScripts("0041 Latin\n")).toThrow();
  });
  it("builds the tables used by the guards from the small test dictionary", () => {
    expect(skeleton("аррӏе")).toBe(skeleton("apple"));
    expect(inspectUrl("https://aа.example")?.mixed).toBe(true);
  });
  it("fetches without a cache, saves the files by date and does not fetch again on the same day", async () => {
    const tables = await loadUnicodeTables({ cacheDir: dir, date: "2026-11-19", fetchText });
    expect(tables.confusables["430"]).toBe("a");
    expect(readFileSync(join(dir, "2026-11-19/Scripts.txt"), "utf8")).toBe(scripts);
    expect(fetchText).toHaveBeenCalledTimes(2);
    await loadUnicodeTables({ cacheDir: dir, date: "2026-11-19", fetchText });
    expect(fetchText).toHaveBeenCalledTimes(2);
    expect(readUnicodeTables({ cacheDir: dir }).scripts).toHaveLength(2);
  });
  it("fetches again on the next day and removes the old cache", async () => {
    await loadUnicodeTables({ cacheDir: dir, date: "2026-11-18", fetchText });
    await loadUnicodeTables({ cacheDir: dir, date: "2026-11-19", fetchText });
    expect(fetchText).toHaveBeenCalledTimes(4);
    expect(existsSync(join(dir, "2026-11-18"))).toBe(false);
    expect(existsSync(join(dir, "2026-11-19"))).toBe(true);
  });
  it("uses an old cache with a warning if the fetch fails", async () => {
    await loadUnicodeTables({ cacheDir: dir, date: "2026-11-18", fetchText });
    const tables = await loadUnicodeTables({
      cacheDir: dir,
      date: "2026-11-19",
      fetchText: () => Promise.reject(new Error("offline")),
    });
    expect(tables.confusables["31"]).toBe("l");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("2026-11-18");
    expect(messages[0]).toContain("offline");
  });
  it("fails if the fetch fails and there is no cache", async () => {
    await expect(
      loadUnicodeTables({ cacheDir: dir, date: "2026-11-19", fetchText: () => Promise.reject(new Error("offline")) })
    ).rejects.toThrow(/キャッシュもありません/);
  });
  it("does not save a download that cannot be parsed", async () => {
    await expect(
      loadUnicodeTables({ cacheDir: dir, date: "2026-11-19", fetchText: () => Promise.resolve("<html>error</html>") })
    ).rejects.toThrow();
    expect(existsSync(join(dir, "2026-11-19"))).toBe(false);
  });
  it("reads the given directory without the network or the cache", async () => {
    mkdirSync(join(dir, "data"));
    writeFileSync(join(dir, "data/confusables.txt"), confusables);
    writeFileSync(join(dir, "data/Scripts.txt"), scripts);
    const tables = await loadUnicodeTables({ cacheDir: join(dir, "cache"), dataDir: join(dir, "data"), fetchText });
    expect(tables.scripts).toHaveLength(2);
    expect(fetchText).not.toHaveBeenCalled();
    expect(existsSync(join(dir, "cache"))).toBe(false);
  });
});
