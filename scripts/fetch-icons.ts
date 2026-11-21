import { existsSync, globSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { readText, validAuthor } from "../plugins/content-filter.ts";
import { authorsPath } from "../plugins/content-paths.ts";
import { contents } from "../plugins/paths.ts";
import { safeFetch } from "../plugins/safe-fetch.ts";
import { validateAuthor } from "../plugins/validate-content.ts";
import { warn } from "../plugins/warn.ts";

// ビルドの前に、プロフィールの icon（https の URL）を取得して、`.cache/icons/<著者ID>.img` に、受け取ったままの内容で保存する
// ここでは画像を解釈しない
// ウイルススキャン（CI）のあと、ビルドが検査して、変換し直した画像だけを配信する（ビルドは、外部に接続しない）
// 取得できなかったアイコンは、警告を出して、アイコンなしとして扱う
const cache = fileURLToPath(new URL("../.cache/icons/", import.meta.url));
const maxBytes = 1_000_000;

rmSync(cache, { recursive: true, force: true });
mkdirSync(cache, { recursive: true });

await Promise.all(
  globSync("*/profile.{yaml,yml}", { cwd: contents }).map(async (path) => {
    const id = basename(dirname(path));
    if (!validAuthor(contents, id) || (path.endsWith(".yml") && existsSync(join(contents, id, "profile.yaml")))) return;
    let icon: unknown;
    try {
      const text = readText(join(contents, path));
      if (text === null) throw new Error("invalid profile");
      const profile: unknown = parse(text);
      icon =
        profile && typeof profile === "object" ? validateAuthor(profile as Record<string, unknown>).icon : undefined;
    } catch {
      warn(`プロフィールの YAML が不正なため、アイコンを取得しません: ${path}`, `${authorsPath}/${path}`);
      return;
    }
    if (typeof icon !== "string" || !icon.startsWith("https://")) return;
    try {
      writeFileSync(join(cache, `${id}.img`), await safeFetch(icon, { maxBytes }));
    } catch (error) {
      warn(
        `プロフィールのアイコンを取得できませんでした: ${icon}（${error instanceof Error ? error.message : String(error)}）`,
        `${authorsPath}/${path}`
      );
    }
  })
);
