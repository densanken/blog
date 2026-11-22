import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterParse, beforeParse } from "./plugins/content-hook.ts";
import { highlight } from "./plugins/highlight.ts";
import { katexCss } from "./plugins/markdown-options.ts";
import { cards, contents, ogLogoPath } from "./plugins/paths.ts";
import { writePreviewHeaders } from "./plugins/preview.ts";
import { preview } from "./plugins/site.ts";
import { prepareUnicodeTables } from "./plugins/unicode-tables.ts";
import { defect } from "./plugins/warn.ts";

// Unicode の辞書は、ビルドのたびに最新版を取得する（取得できず、キャッシュもなければ失敗する）
await prepareUnicodeTables();

const plugin = (name: string) => fileURLToPath(new URL(`./plugins/${name}.ts`, import.meta.url));

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
  // 見出しのアンカーリンク（ホバー時のリンクアイコン）を h2 から h6 に付ける
  mdc: {
    headings: {
      anchorLinks: {
        h1: false,
        h2: true,
        h3: true,
        h4: true,
        h5: true,
        h6: true,
      },
    },
  },
  modules: ["@nuxt/content", "@nuxt/eslint"],
  content: {
    experimental: { sqliteConnector: "native" },
    build: {
      markdown: {
        // 既定では bash、html、ts など数種類しか色付けされないため、Shiki が対応する全言語を登録する
        // MDC は言語名を別名で解決しないため、`py` などの別名も個別に登録する（`c++` のようにファイル名にできない別名は除く）
        highlight,
        toc: { depth: 3, searchDepth: 3 },
        remarkPlugins: {
          "remark-math": {},
          [plugin("remark-embed-blockquote")]: {},
          [plugin("remark-asset-images")]: { options: { contents } },
          [plugin("remark-post-meta")]: {},
        },
        // プラグインは、MDC 既定の rehype-raw（HTML の解析）の後に、ここに書いた順で動く
        // 作者の入力は最初の rehype-sanitize で許可リストに絞り、それより後のプラグインだけが、埋め込み、数式、図などの信頼できるマークアップを生成する
        rehypePlugins: {
          // 埋め込みコードは、sanitize が取り除く前に、URL だけの段落に置き換える
          [plugin("rehype-embed-code")]: {},
          [plugin("rehype-sanitize")]: { options: { contents } },
          [plugin("rehype-lucide")]: { options: { contents } },
          [plugin("rehype-embed")]: {},
          [plugin("rehype-code-group")]: {},
          // 既定の rehype-external-links は sanitize より前に動くため、無効にして置き換える
          "rehype-external-links": false,
          [plugin("rehype-unicode-generated")]: {},
          [plugin("rehype-external-links")]: {},
          [plugin("rehype-url-guard")]: {},
          [plugin("rehype-internal-links")]: { options: { contents } },
          [plugin("rehype-anchor-guard")]: {},
          [plugin("rehype-markdown-preview")]: {},
          [plugin("rehype-mdc-compat")]: { options: { contents } },
          [plugin("rehype-callouts")]: {},
          "rehype-katex": {},
          [plugin("rehype-mermaid")]: { options: { contents } },
          [plugin("rehype-plantuml")]: { options: { contents } },
          [plugin("rehype-svg-attributes")]: {},
          [plugin("rehype-mermaid-toolbar")]: {},
        },
      },
    },
  },
  css: [katexCss, "rehype-callouts/theme/github"],
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
