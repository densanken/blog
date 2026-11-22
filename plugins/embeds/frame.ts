import { h } from "hastscript";

import { safeFetch } from "../safe-fetch.ts";

// aspectRatio が数値なら、縦横比の代わりの固定の高さ（px）
// allow は、再生にブラウザーの機能が必要なサービスだけが指定する（sandbox と referrerpolicy は共通）
export const frame = (
  src: string,
  title: string,
  aspectRatio: string | number,
  className = "embed-frame",
  allow = "fullscreen",
  sandbox = "allow-scripts allow-same-origin allow-popups allow-presentation"
) =>
  h(
    "div",
    {
      className,
      style: typeof aspectRatio === "number" ? `height: ${String(aspectRatio)}px` : `aspect-ratio: ${aspectRatio}`,
    },
    [
      h("iframe", {
        src,
        title,
        loading: "lazy",
        allow,
        // 埋め込み先のスクリプトと、そのオリジンのストレージは使えるが、親のページの移動などはできない
        sandbox,
        referrerpolicy: "strict-origin-when-cross-origin",
      }),
    ]
  );

// 各サービスの oEmbed から、埋め込み用 iframe の URL と縦横比を取得する
// iframe の URL は、サービスのプレーヤーの URL（player）に一致するものだけを使う
export const oembed = async (endpoint: string, url: URL, player: RegExp) => {
  const body = await safeFetch(`${endpoint}${encodeURIComponent(url.href)}`, { maxBytes: 100_000 });
  const data: unknown = JSON.parse(body.toString());
  if (!data || typeof data !== "object" || !("html" in data) || typeof data.html !== "string")
    throw new Error("不正な埋め込みデータです");
  const { html } = data;
  const titleValue = "title" in data ? data.title : undefined;
  const title =
    titleValue === null ||
    typeof titleValue === "string" ||
    typeof titleValue === "number" ||
    typeof titleValue === "boolean" ||
    titleValue === undefined
      ? String(titleValue)
      : "undefined";
  const dimension = (value: unknown) => {
    if (typeof value !== "number" && typeof value !== "string") return 0;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };
  const width = dimension("width" in data ? data.width : undefined);
  const height = dimension("height" in data ? data.height : undefined);
  const src = /<iframe[^>]*\ssrc="([^"]+)"/.exec(html)?.[1];
  if (!src || !player.test(src)) throw new Error(`埋め込みの URL が不正です: ${String(src)}`);
  return frame(src, title.slice(0, 100), width && height ? `${String(width)} / ${String(height)}` : "16 / 9");
};
