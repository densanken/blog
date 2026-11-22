import { globSync, statSync } from "node:fs";

import { listPosts } from "../../utils/posts";

import type { H3Event } from "h3";

// 開発サーバーで検索を使うための、`/pagefind/*` を返すルート（ビルド後は、pagefind コマンドが作った静的なファイルが配信される）
// 記事のページを開発サーバーから取得して Pagefind のインデックスをメモリ上に作り、contents/ のファイルが更新されていたら作り直す
let cache: { stamp: number; files: Promise<Map<string, Uint8Array>> } | undefined;

const build = async (event: H3Event) => {
  const { createIndex } = await import("pagefind");
  const { index } = await createIndex();
  for (const { stem } of await listPosts(event)) {
    const url = postPath(stem);
    await index!.addHTMLFile({ url, content: await (await event.fetch(url)).text() });
  }
  const { files } = await index!.getFiles();
  await index!.deleteIndex();
  return new Map(files.map(({ path, content }) => [path, content]));
};

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ status: 404 });
  const contents = useRuntimeConfig(event).contents;
  const stamp = Math.max(
    ...globSync("**/*.{md,yaml,yml}", { cwd: contents }).map((path) => statSync(`${contents}/${path}`).mtimeMs)
  );
  if (cache?.stamp !== stamp) cache = { stamp, files: build(event) };
  const path = getRouterParam(event, "path")!;
  const content = (await cache.files).get(path);
  if (!content) throw createError({ status: 404 });
  setResponseHeader(event, "content-type", path.endsWith(".js") ? "text/javascript" : "application/octet-stream");
  return content;
});
