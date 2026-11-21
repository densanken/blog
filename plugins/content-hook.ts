import { readFileSync, realpathSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";

import { load } from "cheerio";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { authorsPath } from "./content-paths.ts";
import { lastCommitDate } from "./git-updated.ts";
import { saveAuthorIcon } from "./hosted-images.ts";
import { readLocalImage } from "./image-check.ts";
import { jstDate, today } from "./jst.ts";
import { cleanTextUnicode, cleanYamlSource } from "./unicode.ts";
import { inspectTextUrls, inspectUrl } from "./url-guard.ts";
import { validateAuthor, validatePinned, validatePost } from "./validate-content.ts";
import { defect, warn } from "./warn.ts";

import type { ArticleFile } from "./article-state.ts";

const markdownParser = unified().use(remarkParse).use(remarkGfm);

export const beforeParse = ({ file }: { file: { path: string; body: string } }) => {
  (file as typeof file & ArticleFile).articleContext = {};
  const bom = file.body.startsWith("\ufeff") ? "\ufeff" : "";
  let source = file.body.slice(bom.length);
  let yamlChanged = false;
  let bodyOffset = 0;
  if (/\.ya?ml$/i.test(file.path)) {
    const text = cleanTextUnicode(source);
    const cleaned = cleanYamlSource(text.value);
    source = cleaned.value;
    yamlChanged = text.changed || cleaned.changed;
  } else if (/\.md$/i.test(file.path)) {
    const start = /^---[^\n]*\n/.exec(source)?.[0].length;
    const end = start === undefined ? -1 : source.indexOf("\n---", start);
    if (start !== undefined && end >= 0) {
      const text = cleanTextUnicode(source.slice(start, end));
      const cleaned = cleanYamlSource(text.value);
      if (text.changed || cleaned.changed) {
        source = source.slice(0, start) + cleaned.value.replace(/\n$/, "") + source.slice(end);
        yamlChanged = true;
      }
      bodyOffset = source.indexOf("\n---", start) + 4;
    }
  }
  const ranges: [number, number][] = [];
  if (/\.md$/i.test(file.path)) {
    const htmlRanges: [number, number][] = [];
    visit(markdownParser.parse(source), (node) => {
      if (node.position?.start.offset === undefined || node.position.end.offset === undefined) return;
      const range: [number, number] = [node.position.start.offset, node.position.end.offset];
      if ((node.type === "code" || node.type === "inlineCode") && range[0] >= bodyOffset) ranges.push(range);
      if (node.type === "html" && range[0] >= bodyOffset) htmlRanges.push(range);
    });
    if (htmlRanges.length && /<(?:code|pre)\b/i.test(source)) {
      const masked = source.split("");
      masked.fill(" ", 0, bodyOffset);
      for (const [start, end] of ranges) masked.fill(" ", start, end);
      const $ = load(masked.join(""), { sourceCodeLocationInfo: true });
      $("pre, code").each((_, element) => {
        const location = element.sourceCodeLocation;
        if (!location) return;
        let low = 0;
        let high = htmlRanges.length - 1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          const [start, end] = htmlRanges[middle]!;
          if (location.startOffset < start) high = middle - 1;
          else if (location.startOffset >= end) low = middle + 1;
          else {
            ranges.push([location.startOffset, location.endOffset]);
            break;
          }
        }
      });
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  let offset = 0;
  let result = "";
  let changed = false;
  for (const [start, end] of merged) {
    const clean = cleanTextUnicode(source.slice(offset, start));
    result += clean.value + source.slice(start, end);
    changed ||= clean.changed;
    offset = end;
  }
  const clean = cleanTextUnicode(source.slice(offset));
  file.body = bom + result + clean.value;
  if (changed || clean.changed || yamlChanged) defect("不可視文字を取り除きました", file.path);
};

// @nuxt/content の `content:file:afterParse` フック（nuxt.config.ts から呼ぶ）
// 解析した記事とプロフィールを、検証して整える
// 検証に通らないファイルは、Error を投げる（@nuxt/content が、そのファイルを使わず、警告する）
// @nuxt/content は、内容が同じファイルの解析結果をキャッシュ（.data/）するため、キャッシュが残っていると、このフックの結果は、ファイルを変更するまで更新されない（CI は、キャッシュのない状態から始まる）
export const afterParse = async (
  {
    collection,
    file,
    content,
  }: { collection: { name: string }; file: { path: string } & ArticleFile; content: Record<string, unknown> },
  { contents, iconCache }: { contents: string; iconCache: string }
) => {
  const path = relative(contents, file.path);
  try {
    // パスの途中にシンボリックリンクがある（contents/ の外のファイルを指す可能性がある）ファイルは、使わない
    if (realpathSync(file.path) !== join(realpathSync(contents), path))
      throw new Error("シンボリックリンクを含むパスです");

    const ancestors = new WeakSet<object>();
    const cleanValue = (value: unknown, depth = 0): unknown => {
      if (depth > 64) throw new Error("メタデータの入れ子が深すぎます");
      if (typeof value === "string") {
        const cleaned = cleanTextUnicode(value);
        if (cleaned.changed) defect("メタデータの不可視文字を取り除きました", `${authorsPath}/${path}`);
        for (const info of inspectTextUrls(cleaned.value)) {
          if (info.mixed || info.confusable)
            defect(`リンクの接続先を確認してください: ${info.ascii}`, `${authorsPath}/${path}`);
        }
        return cleaned.value;
      }
      if (!value || typeof value !== "object" || value instanceof Date) return value;
      if (ancestors.has(value)) throw new Error("メタデータに循環参照があります");
      ancestors.add(value);
      try {
        if (Array.isArray(value)) return value.map((item) => cleanValue(item, depth + 1));
        const entries = Object.entries(value).map(
          ([key, item]) => [cleanValue(key, depth + 1) as string, cleanValue(item, depth + 1)] as const
        );
        if (new Set(entries.map(([key]) => key)).size !== entries.length)
          throw new Error("メタデータのキーが重複します");
        return Object.fromEntries(entries);
      } finally {
        ancestors.delete(value);
      }
    };
    if (collection.name === "authors" && Object.hasOwn(content, "pinned")) {
      content.pinned = validatePinned(content.pinned, undefined, `${authorsPath}/${path}`);
    }
    const protectedKeys = ["id", "path", "stem", "body", "__metadata"];
    for (const key of Object.keys(content)) {
      if (protectedKeys.includes(key)) continue;
      const cleanedKey = cleanValue(key) as string;
      if (cleanedKey !== key && Object.hasOwn(content, cleanedKey)) throw new Error("メタデータのキーが重複します");
      const value = cleanValue(content[key]);
      if (cleanedKey !== key) delete content[key];
      Object.defineProperty(content, cleanedKey, { value, enumerable: true, configurable: true, writable: true });
    }
    content.stem = path.slice(0, -extname(path).length).split("\\").join("/");
    if (collection.name === "authors") {
      const author = validateAuthor(content);
      const id = basename(dirname(file.path));
      content.pinned = validatePinned(content.pinned, undefined, `${authorsPath}/${path}`);
      if (author.icon) {
        try {
          const source = author.icon.startsWith("https://")
            ? readFileSync(join(iconCache, `${id}.img`))
            : readLocalImage(join(contents, id, "assets"), join(contents, id, author.icon));
          author.icon = await saveAuthorIcon(
            source,
            author.icon.startsWith("https://") ? undefined : extname(author.icon).slice(1)
          );
        } catch (error) {
          // 外部の画像の取得・検査の失敗は、書き手が直せないため、不備にしない
          (author.icon.startsWith("https://") ? warn : defect)(
            `プロフィールのアイコンを使えません: ${author.icon}（${error instanceof Error ? error.message : String(error)}）`,
            `${authorsPath}/${path}`
          );
          author.icon = undefined;
        }
      }
      Object.assign(content, author);
      if (author.website) {
        const info = inspectUrl(author.website);
        if (info) {
          content.websiteHost = info.display;
          content.websiteAscii = info.ascii;
          content.websiteWarning = info.mixed || info.confusable;
          if (content.websiteWarning)
            defect(`リンクの接続先を確認してください: ${info.ascii}`, `${authorsPath}/${path}`);
        }
      }
    } else if (collection.name === "posts") {
      content.sourceStem = content.stem;
      const [author, ...slug] = (content.stem as string).split("/");
      content.stem = [author, ...slug.map((part) => part.toLowerCase())].join("/");
      Object.assign(content, validatePost(content));
      content.excerpt = cleanValue(file.articleContext?.excerpt ?? "");
      // 更新日は Git の最終コミット日を日本時間で求め、今日を上限とする（公開日より後の場合だけ設定する）
      // frontmatter に書かれた値は使わない
      const committed = lastCommitDate(contents, file.path);
      const current = today();
      const updated = committed ? (committed < current ? committed : current) : undefined;
      content.updated = updated && updated > jstDate(content.date) ? updated : undefined;
    }
  } catch (error) {
    defect(`${path} を使いません: ${error instanceof Error ? error.message : String(error)}`, `${authorsPath}/${path}`);
    throw error;
  }
};
