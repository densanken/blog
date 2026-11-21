import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unicode の辞書は、テスト用の小さなものを使い、ネットワークに接続しない（plugins/unicode-tables.ts）
    env: { UNICODE_DATA_DIR: fileURLToPath(new URL("./src/test/fixtures/unicode/", import.meta.url)) },
  },
});
