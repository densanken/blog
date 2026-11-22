// プレビュー用のビルド（PREVIEW=1）だけが、nuxt.config.ts から登録する Nitro プラグイン
import { previewPr } from "../../../plugins/site.ts";

// 全ページの先頭に、閉じられないバナーを埋め込む（本番のビルドには含まれない）
// 見出しの下に潜らないよう、ヘッダーとページ内の固定位置を、バナーの高さだけ下げる
interface NitroApp {
  hooks: { hook: (name: "render:html", listener: (html: { bodyPrepend: string[] }) => void) => void };
}

const height = 28;
const escape = (text: string) => text.replace(/[&<>"]/g, (char) => `&#${String(char.charCodeAt(0))};`);

export default (nitroApp: NitroApp) => {
  const text = escape(`これはプレビューです${previewPr ? `（PR #${previewPr}）` : ""}`);
  const banner = `<div class="preview-banner" role="note">${text}</div><style>
.preview-banner{position:fixed;inset:0 0 auto;z-index:2147483647;height:${String(height)}px;line-height:${String(height)}px;background:#b45309;color:#fff;font:700 13px/${String(height)}px sans-serif;text-align:center}
body{padding-top:${String(height)}px}
:root{--header-height:${String(72 + height)}px}
.site-header{top:${String(height)}px;height:72px}
</style>`;
  nitroApp.hooks.hook("render:html", (html) => {
    html.bodyPrepend.unshift(banner);
  });
};
