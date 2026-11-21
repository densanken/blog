import { extname } from "node:path";

// contents/ で受け付ける拡張子は大文字と小文字を区別せず、最後の拡張子だけを見る
// `x.png.html` は `.html` として拒否する
// それ以外のファイルは、読み込まず、公開もしない（content-filter.ts が警告し、nuxt.config.ts の公開のフックも、この一覧に従う）
export const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif"]);
export const allowedExtensions = new Set([".md", ".yaml", ".yml", ...imageExtensions]);

export const extensionOf = (path: string) => extname(path).toLowerCase();
