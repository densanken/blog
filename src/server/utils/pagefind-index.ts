import { glob, stat } from "node:fs/promises";
import { join } from "node:path";

interface PagefindIndex {
  addHTMLFile: (file: { url: string; content: string }) => Promise<{ errors: string[] }>;
  getFiles: () => Promise<{ errors: string[]; files: { path: string; content: Uint8Array }[] }>;
  deleteIndex: () => Promise<unknown>;
}

// 記事のページを取得して Pagefind のインデックスに加え、できたファイルを返す（開発サーバーで検索を使うため）
// 取得や追加に失敗したときは、記事が欠けたインデックスを成功として返さず、エラーにする
// どの場合も、Pagefind 側（ネイティブ）に確保したインデックスは、解放する
export const buildPagefindFiles = async ({
  index,
  urls,
  fetchPage,
}: {
  index: PagefindIndex;
  urls: string[];
  fetchPage: (url: string) => Promise<Response>;
}) => {
  try {
    for (const url of urls) {
      const response = await fetchPage(url);
      if (!response.ok) throw new Error(`${url} を取得できません（HTTP ${String(response.status)}）`);
      const { errors } = await index.addHTMLFile({ url, content: await response.text() });
      if (errors.length) throw new Error(`${url} をインデックスに追加できません: ${errors.join("、")}`);
    }
    const { files, errors } = await index.getFiles();
    if (errors.length) throw new Error(`インデックスのファイルを作れません: ${errors.join("、")}`);
    return new Map(files.map(({ path, content }) => [path, content]));
  } finally {
    await index.deleteIndex();
  }
};

// contents/ の記事とプロフィールの状態を表す文字列（ファイルの一覧と、更新時刻）
// 最も新しい更新時刻だけでは、古いファイルを削除したときの変化を検出できないため、ファイルごとの更新時刻を並べる
export const contentsFingerprint = async (contents: string) => {
  const paths: string[] = [];
  for await (const path of glob("**/*.{md,yaml,yml}", { cwd: contents })) paths.push(path);
  const entries = await Promise.all(
    paths.sort().map(async (path) => {
      try {
        return `${path}:${String((await stat(join(contents, path))).mtimeMs)}`;
      } catch {
        // 一覧を作った後に消えたファイル
        return `${path}:gone`;
      }
    })
  );
  return entries.join("\n");
};
