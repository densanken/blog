import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// プレビュー用のビルドは Cloudflare Workers で配信するため、.htaccess の全ページ共通のヘッダー（`Header always set`）を _headers に移し、すべてのパスに noindex を追加する
export const writePreviewHeaders = (publicDir: string) => {
  const htaccess = join(publicDir, ".htaccess");
  const headers = [...readFileSync(htaccess, "utf8").matchAll(/^\s*Header always set (\S+) "(.*)"$/gm)].map(
    ([, name, value]) => `  ${name!}: ${value!}`
  );
  writeFileSync(join(publicDir, "_headers"), ["/*", ...headers, "  X-Robots-Tag: noindex, nofollow", ""].join("\n"));
  rmSync(htaccess);
};
