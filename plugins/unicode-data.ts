import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { warn } from "./warn.ts";

// 紛らわしい文字（confusables.txt）と文字体系（Scripts.txt）の辞書を、Unicode の最新版から取得して表にする
// 取得したファイルは、日単位でキャッシュする（取得できなければ、古いキャッシュを使って警告し、キャッシュがなければ失敗する）
export const confusablesUrl = "https://www.unicode.org/Public/security/latest/confusables.txt";
export const scriptsUrl = "https://www.unicode.org/Public/UCD/latest/ucd/Scripts.txt";

export interface UnicodeTables {
  // 16 進数のコードポイント → 置き換える文字列
  confusables: Record<string, string>;
  // [開始, 終了, 文字体系]（開始の昇順で、Common と Inherited は含まない）
  scripts: [number, number, string][];
}

const entries = (text: string) =>
  text
    .split("\n")
    .map((line) => line.split("#")[0]!.trim())
    .filter(Boolean);

export const parseConfusables = (text: string) => {
  const table: Record<string, string> = {};
  for (const data of entries(text)) {
    const [source, target] = data.split(";").map((value) => value.trim());
    if (!source || !target || source.includes(" ")) throw new Error(`confusables.txt の行が不正です: ${data}`);
    table[Number.parseInt(source, 16).toString(16)] = String.fromCodePoint(
      ...target.split(/\s+/).map((value) => Number.parseInt(value, 16))
    );
  }
  if (!Object.keys(table).length) throw new Error("confusables.txt に項目がありません");
  return table;
};

export const parseScripts = (text: string) => {
  const ranges: UnicodeTables["scripts"] = [];
  for (const data of entries(text)) {
    const [code, name] = data.split(";").map((value) => value.trim());
    if (!code || !name) throw new Error(`Scripts.txt の行が不正です: ${data}`);
    if (name === "Common" || name === "Inherited") continue;
    const [first, last = first] = code.split("..");
    ranges.push([Number.parseInt(first!, 16), Number.parseInt(last!, 16), name]);
  }
  if (!ranges.length) throw new Error("Scripts.txt に項目がありません");
  return ranges.sort((a, b) => a[0] - b[0]);
};

interface Sources {
  confusables: string;
  scripts: string;
}

const parse = ({ confusables, scripts }: Sources): UnicodeTables => ({
  confusables: parseConfusables(confusables),
  scripts: parseScripts(scripts),
});

const files = { confusables: "confusables.txt", scripts: "Scripts.txt" } as const;
const readFiles = (dir: string): Sources => ({
  confusables: readFileSync(join(dir, files.confusables), "utf8"),
  scripts: readFileSync(join(dir, files.scripts), "utf8"),
});

const download = async (url: string) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} を取得できません（${String(response.status)}）`);
  return await response.text();
};

const datePattern = /^\d{4}-\d\d-\d\d$/;
const cachedDates = (cacheDir: string) => {
  try {
    return readdirSync(cacheDir).filter((name) => datePattern.test(name));
  } catch {
    return [];
  }
};

const newestTables = (cacheDir: string) => {
  for (const name of cachedDates(cacheDir).sort().reverse()) {
    try {
      return { name, tables: parse(readFiles(join(cacheDir, name))) };
    } catch {
      // 次に新しいキャッシュを試す
    }
  }
};

// キャッシュ（または dataDir）の辞書を、同期的に読む（取得は、先に loadUnicodeTables が行う）
export const readUnicodeTables = ({ cacheDir, dataDir }: { cacheDir: string; dataDir?: string }): UnicodeTables => {
  if (dataDir) return parse(readFiles(dataDir));
  const cached = newestTables(cacheDir);
  if (!cached) throw new Error("Unicode の辞書がありません（先に loadUnicodeTables で取得してください）");
  return cached.tables;
};

export interface LoadOptions {
  // 辞書のファイルを置くディレクトリ（日付ごとのディレクトリを作る）
  cacheDir: string;
  // 今日の日付（YYYY-MM-DD）
  date?: string;
  // 辞書の URL から本文を取得する
  fetchText?: (url: string) => Promise<string>;
  // 指定した場合は、ネットワークとキャッシュを使わず、このディレクトリの confusables.txt と Scripts.txt を読む（テスト用）
  dataDir?: string;
}

export const loadUnicodeTables = async ({
  cacheDir,
  date = new Date().toISOString().slice(0, 10),
  fetchText = download,
  dataDir,
}: LoadOptions): Promise<UnicodeTables> => {
  if (dataDir) return parse(readFiles(dataDir));
  const dir = join(cacheDir, date);
  try {
    return parse(readFiles(dir));
  } catch {
    // 今日の分がなければ、取得する
  }
  try {
    const sources = { confusables: await fetchText(confusablesUrl), scripts: await fetchText(scriptsUrl) };
    const tables = parse(sources);
    // 並行する別のプロセスが途中のファイルを読まないよう、書き終えてから置く
    const temporary = `${dir}.${String(process.pid)}.tmp`;
    rmSync(temporary, { recursive: true, force: true });
    mkdirSync(temporary, { recursive: true });
    writeFileSync(join(temporary, files.confusables), sources.confusables);
    writeFileSync(join(temporary, files.scripts), sources.scripts);
    rmSync(dir, { recursive: true, force: true });
    renameSync(temporary, dir);
    // 古い日付のキャッシュは消す
    for (const name of cachedDates(cacheDir))
      if (name !== date) rmSync(join(cacheDir, name), { recursive: true, force: true });
    return tables;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const stale = newestTables(cacheDir);
    if (stale) {
      warn(`Unicode の辞書を取得できないため、${stale.name} のキャッシュを使います（${reason}）`);
      return stale.tables;
    }
    throw new Error(`Unicode の辞書を取得できず、キャッシュもありません（${reason}）`, { cause: error });
  }
};
