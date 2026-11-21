import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { load } from "cheerio";

import { siteUrl } from "../plugins/site.ts";
import { warn } from "../plugins/warn.ts";

const output = ".output/public";
const cards = join(output, "_cards");
const used = new Set<string>();
const origin = new URL(siteUrl).origin;
const collect = (markup: string) => {
  const $ = load(markup);
  $('img[src], img[srcset], img[data-zoom-src], meta[property="og:image"], meta[name="twitter:image"]').each(
    (_, element) => {
      const node = $(element);
      const values = node.is("img")
        ? [node.attr("src"), node.attr("srcset"), node.attr("data-zoom-src")]
        : [node.attr("content")];
      for (const value of values) {
        for (const part of (value ?? "").split(/[\s,]+/)) {
          const url = URL.parse(part, origin);
          if (url?.origin !== origin) continue;
          const image = /^\/_cards\/([a-f\d]{16}\.webp)$/.exec(url.pathname);
          if (image) used.add(image[1]!);
        }
      }
    }
  );
};
const scan = (dir: string): boolean => {
  let complete = true;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (path === cards) continue;
      if (entry.isDirectory() && !scan(path)) complete = false;
      else if (entry.isFile() && /\.(html|xml)$/.test(path)) {
        try {
          collect(readFileSync(path, "utf8"));
        } catch (error) {
          complete = false;
          warn(`出力を読めないため画像の整理を省略します: ${path}（${String(error)}）`, path);
        }
      }
    }
  } catch (error) {
    complete = false;
    warn(`出力を読めないため画像の整理を省略します: ${dir}（${String(error)}）`, dir);
  }
  return complete;
};
if (existsSync(cards)) {
  if (scan(output)) {
    try {
      for (const name of readdirSync(cards)) {
        if (used.has(name)) continue;
        const path = join(cards, name);
        try {
          rmSync(path, { recursive: true, force: true });
        } catch (error) {
          warn(`不要な画像を削除できません: ${path}（${String(error)}）`, path);
        }
      }
    } catch (error) {
      warn(`画像のディレクトリを読めません: ${cards}（${String(error)}）`, cards);
    }
  }
}
