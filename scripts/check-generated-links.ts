import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { load } from "cheerio";

import { siteUrl } from "../plugins/site.ts";
import { warn } from "../plugins/warn.ts";

export const checkGeneratedLinks = (output: string) => {
  const files: string[] = [];
  const scan = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (entry.isFile() && path.endsWith(".html")) files.push(path);
    }
  };
  scan(output);
  // ページの URL は、`index.html` のあるディレクトリ（末尾のスラッシュつき）
  const routes = new Set(
    files.filter((file) => file.endsWith("/index.html")).map((file) => file.slice(output.length, -"index.html".length))
  );
  for (const file of files) {
    const base = `${siteUrl}${file.slice(output.length).replace(/index\.html$/, "")}`;
    let markup: string;
    try {
      markup = readFileSync(file, "utf8");
    } catch (error) {
      warn(`生成物を検査できません: ${String(error)}`, file);
      continue;
    }
    const $ = load(markup);
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href")!;
      const url = URL.parse(href, base);
      if (url?.origin !== new URL(siteUrl).origin) return;
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        pathname = url.pathname;
      }
      if (!/^\/@[^/]+\/.+/.test(pathname)) return;
      if (!routes.has(url.pathname)) warn(`生成物のリンク先が存在しないか正規 URL ではありません: ${href}`, file);
    });
  }
};

if (process.argv[1]?.endsWith("check-generated-links.ts")) {
  try {
    checkGeneratedLinks(".output/public");
  } catch (error) {
    warn(`生成物を検査できません: ${String(error)}`, ".output/public");
  }
}
