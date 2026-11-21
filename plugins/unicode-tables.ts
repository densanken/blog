import { resolve } from "node:path";

import { loadUnicodeTables, readUnicodeTables } from "./unicode-data.ts";

import type { UnicodeTables } from "./unicode-data.ts";

// Unicode の最新の辞書（取得とキャッシュは unicode-data.ts）
// ビルドの入口（nuxt.config.ts）が prepareUnicodeTables で、先にキャッシュへ取得する
// Nitro のバンドルは別のモジュールとして読み込むため、キャッシュを同期的に読む
// UNICODE_DATA_DIR を指定すると、そのディレクトリの辞書を使い、ネットワークに接続しない（単体テスト用）
const options = () => ({ cacheDir: resolve("node_modules/.cache/unicode"), dataDir: process.env.UNICODE_DATA_DIR });

export const prepareUnicodeTables = async () => {
  await loadUnicodeTables(options());
};

let tables: UnicodeTables | undefined;
export const unicodeTables = () => (tables ??= readUnicodeTables(options()));
