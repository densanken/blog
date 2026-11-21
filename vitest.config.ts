import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unicode の辞書は、テスト用の小さなものを使い、ネットワークに接続しない（plugins/unicode-tables.ts）
    // SITE_URL と PREVIEW は、空にして既定の動作に固定する（実行環境の値で、サイトの URL を前提にしたテストが変わらないようにする）
    env: {
      UNICODE_DATA_DIR: fileURLToPath(new URL("./src/test/fixtures/unicode/", import.meta.url)),
      SITE_URL: "",
      PREVIEW: "",
    },
  },
});
