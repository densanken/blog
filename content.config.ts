import { defineCollection, defineContentConfig, z } from "@nuxt/content";

import { excludedFiles } from "./plugins/content-filter.ts";
import { contents as cwd } from "./plugins/paths.ts";
import { excludeScheduled } from "./plugins/site.ts";

// ビルドに含めない記事とプロフィール（理由は plugins/content-filter.ts）
// 開発サーバーでは、公開前（予約投稿）の記事も確認できるよう、除外しない
const excluded = excludedFiles(cwd, { scheduled: excludeScheduled });

export default defineContentConfig({
  collections: {
    posts: defineCollection({
      type: "page",
      source: {
        cwd,
        include: "*/**/*.md",
        exclude: excluded.posts,
      },
      schema: z.object({
        date: z.string().date(),
        // Git の最終コミット日（日本時間）から nuxt.config.ts のフックが設定する（frontmatter では指定できない）
        updated: z.string().date().optional(),
        // remark-post-meta が求める、読了までの分数と、本文の先頭の抜粋
        // `.int()` を付けると、@nuxt/content が SQLite の列を TEXT 型で作り、値が文字列で返るため、付けない
        sourceStem: z.string(),
        readingTime: z.number(),
        excerpt: z.string(),
      }),
    }),
    authors: defineCollection({
      type: "data",
      source: { cwd, include: "*/profile.{yaml,yml}", exclude: excluded.profiles },
      // 値の検証は、nuxt.config.ts のフックが plugins/validate-content.ts で行う（@nuxt/content は、スキーマで値を検証しない）
      schema: z.object({
        name: z.string(),
        github: z.string().optional(),
        website: z.string().optional(),
        websiteHost: z.string().optional(),
        websiteAscii: z.string().optional(),
        websiteWarning: z.boolean().optional(),
        icon: z.string().optional(),
        twitter: z.string().optional(), // x 側が優先される
        x: z.string().optional(),
        bio: z.string().optional(),
        admissionYear: z.number().int().nonnegative().optional(),
        pinned: z.array(z.string()).optional(),
      }),
    }),
  },
});
