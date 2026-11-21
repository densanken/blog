import { execFileSync } from "node:child_process";
import { relative, resolve } from "node:path";

import { jstDate } from "./jst.ts";

// contents ディレクトリの Git の履歴から、各ファイルを最後にコミットした日（日本時間の日付）を、1回の git log でまとめて求める
// contents がサブモジュールでも、コミットされていないファイルや Git の管理外でも動く（求められないファイルは含まれない）
// 空のパスは存在しないため、NUL の空トークンをコミットの日時の区切りに使う
const iso = /^\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:\d\d)$/;

const load = (contents: string): Map<string, string> => {
  const dates = new Map<string, string>();
  let out: string;
  try {
    out = execFileSync(
      "git",
      [
        "-C",
        contents,
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
  } catch {
    return dates;
  }
  let date = "";
  let nextIsDate = false;
  let firstPath = false;
  for (const token of out.split("\0")) {
    if (nextIsDate) {
      date = iso.test(token) ? jstDate(token) : "";
      nextIsDate = false;
      firstPath = true;
    } else if (!token) {
      nextIsDate = true;
    } else {
      const path = firstPath ? token.replace(/^\n/, "") : token;
      firstPath = false;
      if (path && date && !dates.has(path)) dates.set(path, date);
    }
  }
  return dates;
};

const cache = new Map<string, Map<string, string>>();

// 記事ファイル（絶対パス）の、最後にコミットした日
// ない場合は undefined
export const lastCommitDate = (contents: string, path: string): string | undefined => {
  const root = resolve(contents);
  if (!cache.has(root)) cache.set(root, load(root));
  return cache.get(root)?.get(relative(root, path));
};
