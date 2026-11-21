import { mkdirSync } from "node:fs";

import { cards, contents, ogLogoPath } from "./plugins/paths.ts";
import { prepareUnicodeTables } from "./plugins/unicode-tables.ts";

// Unicode の辞書は、ビルドのたびに最新版を取得する（取得できず、キャッシュもなければ失敗する）
await prepareUnicodeTables();

// 外部の画像と GIF の保存先（plugins/hosted-images.ts）
mkdirSync(cards, { recursive: true });

export default defineNuxtConfig({
  runtimeConfig: {
    contents,
    cards,
    ogLogoPath,
    public: { googleAnalyticsId: "" },
  },
  srcDir: "src/",
  serverDir: "src/server",
  dir: { shared: "src/shared" },
  modules: ["@nuxt/content", "@nuxt/eslint"],
  content: {
    experimental: { sqliteConnector: "native" },
  },
  eslint: {
    config: { typescript: { strict: true, tsconfigPath: "./tsconfig.json" } },
  },
  devtools: { enabled: true },
  compatibilityDate: "2026-11-01",
  typescript: {
    strict: true,
    nodeTsConfig: {
      include: [
        "../content.config.ts",
        "../oxfmt.config.ts",
        "../vitest.config.ts",
        "../probe-image-size.d.ts",
        "../plugins/*.ts",
        "../plugins/embeds/*.ts",
        "../scripts/*.ts",
      ],
      compilerOptions: {
        erasableSyntaxOnly: true,
        allowImportingTsExtensions: true,
        noEmit: true,
      },
    },
  },
  nitro: {
    prerender: {
      failOnError: false,
      ignore: ["/contents/"],
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: "ja" },
      title: "CCSブログ",
      titleTemplate: "%s | CCSブログ",
    },
  },
});
