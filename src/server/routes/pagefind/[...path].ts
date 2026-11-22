import { listPosts } from "../../utils/posts";

import type { H3Event } from "h3";

// 開発サーバーで検索を使うための、`/pagefind/*` を返すルート（ビルド後は、pagefind コマンドが作った静的なファイルが配信される）
// 記事のページを開発サーバーから取得して Pagefind のインデックスをメモリ上に作り、contents/ のファイルが更新されていたら作り直す
interface Cache {
  stamp: string;
  files: Promise<Map<string, Uint8Array>>;
}
let cache: Cache | undefined;
// アセットごとの要求が、同時に contents/ を調べ直さないよう、実行中の調査を共有する
let scanning: Promise<string> | undefined;

const build = async (event: H3Event) => {
  const urls = (await listPosts(event)).map(({ stem }) => postPath(stem));
  const { createIndex } = await import("pagefind");
  const { index, errors } = await createIndex();
  if (!index) throw new Error(`Pagefind のインデックスを作れません: ${errors.join("、")}`);
  return await buildPagefindFiles({ index, urls, fetchPage: (url) => event.fetch(url) });
};

export default defineEventHandler(async (event) => {
  if (!import.meta.dev) throw createError({ status: 404 });
  const contents = useRuntimeConfig(event).contents;
  scanning ??= contentsFingerprint(contents).finally(() => {
    scanning = undefined;
  });
  const stamp = await scanning;
  let current = cache;
  if (current?.stamp !== stamp) {
    const entry: Cache = { stamp, files: build(event) };
    current = entry;
    cache = entry;
    // 失敗した結果は、次の要求で作り直せるよう、まだ現在のキャッシュなら捨てる（新しいキャッシュは消さない）
    entry.files.catch(() => {
      if (cache === entry) cache = undefined;
    });
  }
  const path = getRouterParam(event, "path")!;
  const content = (await current.files).get(path);
  if (!content) throw createError({ status: 404 });
  setResponseHeader(event, "content-type", path.endsWith(".js") ? "text/javascript" : "application/octet-stream");
  return content;
});
