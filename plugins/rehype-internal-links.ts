import { globSync } from "node:fs";
import { relative, sep } from "node:path";

import { visit } from "unist-util-visit";

import { excludedFiles } from "./content-filter.ts";
import { excludeScheduled, siteUrl } from "./site.ts";
import { warn } from "./warn.ts";

import type { Root } from "hast";
import type { VFile } from "vfile";

export default ({ contents }: { contents: string }) => {
  const routes = new Map<string, string>();
  const excluded = excludedFiles(contents, { scheduled: excludeScheduled });
  for (const file of globSync("*/**/*.md", { cwd: contents, exclude: excluded.posts }).sort()) {
    const [author, ...slug] = file.slice(0, -3).split("/");
    const path = `/@${author!}/${slug.join("/").toLowerCase()}/`;
    if (!routes.has(path.toLowerCase())) routes.set(path.toLowerCase(), path);
  }
  return (tree: Root, file: VFile) => {
    const [author, ...slug] = relative(contents, file.path).split(sep);
    const base = `${siteUrl}/@${author ?? ""}/${slug.join("/").replace(/\.md$/, "").toLowerCase()}`;
    visit(tree, "element", (node) => {
      if (node.tagName !== "a" || typeof node.properties.href !== "string") return;
      const href = node.properties.href;
      if (!href || href.startsWith("#") || href.startsWith("?")) return;
      const url = URL.parse(href, base);
      if (url?.origin !== new URL(siteUrl).origin) return;
      let pathname = url.pathname;
      try {
        pathname = decodeURIComponent(pathname);
      } catch {
        warn(`リンク先の記事が見つかりません: ${href}`, file.path);
        return;
      }
      const setPath = (path: string) => {
        const target = `${path}${url.search}${url.hash}`;
        node.properties.href =
          /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//") ? `${url.origin}${target}` : target;
      };
      // 著者ページのページ送り（/@<著者ID>/page/<番号>）は、記事ではない（記事の slug に page は使えない）
      if (!/^\/@[^/]+\/.+/.test(pathname) || /^\/@[^/]+\/page(?:\/|$)/i.test(pathname)) {
        // 記事以外のページ（/privacy、/@<著者ID> など）も、正規 URL の末尾のスラッシュをつける（拡張子のあるファイルは除く）
        if (!/(?:\/|\.[^/]*)$/.test(pathname)) setPath(`${url.pathname}/`);
        return;
      }
      const canonical = routes.get(pathname.replace(/\/?$/, "/").toLowerCase());
      if (!canonical) {
        warn(`リンク先の記事が見つかりません: ${href}`, file.path);
        return;
      }
      setPath(canonical);
    });
  };
};
