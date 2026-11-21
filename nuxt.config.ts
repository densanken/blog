import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterParse, beforeParse } from "./plugins/content-hook.ts";
import { cards, contents, ogLogoPath } from "./plugins/paths.ts";
import { writePreviewHeaders } from "./plugins/preview.ts";
import { preview } from "./plugins/site.ts";
import { prepareUnicodeTables } from "./plugins/unicode-tables.ts";
import { defect } from "./plugins/warn.ts";

// Unicode の辞書は、ビルドのたびに最新版を取得する（取得できず、キャッシュもなければ失敗する）
await prepareUnicodeTables();

// 外部の画像と GIF の保存先（plugins/hosted-images.ts）
mkdirSync(cards, { recursive: true });
// 外部のプロフィールのアイコンは、ビルドの前に取得して iconCache に保存する（scripts/fetch-icons.ts）
const iconCache = fileURLToPath(new URL("./.cache/icons/", import.meta.url));

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
    // 外部の画像（リンクカードのサムネイルなど）と GIF は、ビルド時に変換して .data/cards/ に保存し（plugins/hosted-images.ts）、/_cards/ で配信する
    // contents/ の assets は、そのままでは公開しない（変換した画像だけを配信する）
    publicAssets: [{ dir: cards, baseURL: "/_cards" }],
    prerender: {
      failOnError: false,
      ignore: ["/contents/"],
    },
    hooks: {
      // 出力が出そろった後に、出力を整える（compiled は、先にプリレンダリング用の nitro でも呼ばれるため、そちらでは何もしない）
      compiled: (nitro) => {
        if (nitro.options.preset === "nitro-prerender") return;
        const { publicDir } = nitro.options.output;
        if (preview) writePreviewHeaders(publicDir);
      },
      "prerender:route": (route) => {
        if (route.error)
          defect(`プリレンダリングできません: ${route.route}（${route.error.message}）`, route.fileName ?? route.route);
      },
    },
  },
  hooks: {
    "content:file:beforeParse": beforeParse,
    "content:file:afterParse": (context) => afterParse(context, { contents, iconCache }),
  },
  app: {
    head: {
      htmlAttrs: { lang: "ja" },
      title: "CCSブログ",
      titleTemplate: "%s | CCSブログ",
    },
  },
});
