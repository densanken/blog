import { createHash } from "node:crypto";

// ページごとに違う CSP を HTTP ヘッダー（public/.htaccess）では設定しにくいため、ビルド時に各ページへ Content-Security-Policy を `<meta>` で埋め込む
// ページ内のインラインのスクリプト（Nuxt の設定、テーマの初期化など）は、ハッシュで許可する
// 許可するのは、このサイト、埋め込みを作るサービス（`rehype-embed` が生成する iframe の URL）、X のウィジェットだけ
const frames = [
  "https://www.youtube-nocookie.com",
  "https://platform.twitter.com",
  "https://syndication.twitter.com",
  "https://speakerdeck.com",
  "https://www.docswell.com",
  "https://docs.google.com",
  "https://www.google.com",
  "https://embed.figma.com",
  "https://www.figma.com",
  "https://miro.com",
  "https://www.canva.com",
  "https://codepen.io",
  "https://codesandbox.io",
  "https://open.spotify.com",
  "https://embed.music.apple.com",
  "https://clips.twitch.tv",
];
const inlineScript = /<script(?![^>]*\ssrc=)(?![^>]*type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script[^>]*>/g;

export default defineNitroPlugin((nitroApp) => {
  // 開発サーバーは、HMR などのインラインのスクリプトを使うため、対象にしない
  if (!import.meta.prerender) return;
  nitroApp.hooks.hook("render:response", (response) => {
    if (typeof response.body !== "string" || !response.body.startsWith("<!DOCTYPE html>")) return;
    const hash = (code: string) => `'sha256-${createHash("sha256").update(code).digest("base64")}'`;
    // 記事の本文（main の中）に script があれば、ビルドを失敗にする（記事の内容を CSP のハッシュで許可しないため）
    // ハッシュで許可するのは、main の外（Nuxt が出力するスクリプト）だけ
    const main = /<main[\s>][\s\S]*<\/main>/.exec(response.body)?.[0] ?? "";
    if (/<script[\s/>]/i.test(main)) throw new Error("記事の本文に script が含まれています");
    const hashes = [...response.body.replace(main, "").matchAll(inlineScript)].map(([, code]) => hash(code!));
    const policy = [
      "default-src 'self'",
      `script-src 'self' 'wasm-unsafe-eval' https://platform.twitter.com https://www.googletagmanager.com ${hashes.join(" ")}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.twitter.com https://*.twimg.com https://www.google-analytics.com https://*.google-analytics.com https://www.googletagmanager.com",
      `frame-src ${frames.join(" ")}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join("; ");
    response.body = response.body.replace(
      "<head>",
      `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`
    );
  });
});
