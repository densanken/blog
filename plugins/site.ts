// プレビュー用のビルド（PREVIEW=1）は、blog-contents の PR のプレビューに使う
// 予約投稿を含め、検索エンジンに載せず、プレビューであることをページに表示する
export const preview = process.env.PREVIEW === "1";
// プレビューの PR 番号（未指定なら、バナーに番号を出さない）
export const previewPr = /^\d+$/.test(process.env.PREVIEW_PR ?? "") ? process.env.PREVIEW_PR : undefined;

// プレビューの URL は PR ごとに変わるため、ビルドごとに SITE_URL で指定する（プレビューで未指定ならビルドを失敗にする）
const siteUrlOf = () => {
  const value = process.env.SITE_URL;
  if (!value) {
    if (preview) throw new Error("PREVIEW=1 のときは、SITE_URL にプレビューの URL を指定してください");
    return "https://blog.densanken.com";
  }
  const url = URL.parse(value);
  if (!url || !/^https?:$/.test(url.protocol)) throw new Error(`SITE_URL が不正です: ${value}`);
  return url.origin;
};
export const siteUrl = siteUrlOf();
export const figmaEmbedHost = "densanken-blog";

// 公開日がビルドした日より後の記事（予約投稿）を、ビルドから除外するか
// 開発サーバーとプレビューでは、公開前の記事も確認できるよう、除外しない
export const excludeScheduled = process.env.NODE_ENV !== "development" && !preview;
