import { defineConfig, mergeConfig } from "vitest/config";

import base from "../../../vitest.config.ts";

// fuzzing は、テスト用の小さな辞書では紛らわしい文字の多くを扱えないため、本物の Unicode の辞書を使う
// 辞書は setup.ts が node_modules/.cache/unicode に取得する（キャッシュがあればネットワークに接続しない）
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["src/test/fuzz/**/*.test.ts"],
      env: { UNICODE_DATA_DIR: "" },
      globalSetup: ["src/test/fuzz/setup.ts"],
    },
  })
);
