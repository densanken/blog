import { load } from "cheerio";
import { h } from "hastscript";
import ogs from "open-graph-scraper";

import { hostImage } from "../hosted-images.ts";
import { safeFetch } from "../safe-fetch.ts";
import { cleanTextUnicode } from "../unicode.ts";
import { inspectTextUrls } from "../url-guard.ts";
import { warn } from "../warn.ts";

export const linkCard = async (url: URL, owner: string) => {
  const html = (await safeFetch(url.href, { maxBytes: 1_000_000, truncate: true })).toString();
  // ボットチャレンジのページは、リンク先の内容ではないため、カードにしない
  if (/<title[^>]*>\s*(?:Client Challenge|Just a moment\.\.\.)\s*<\/title>/i.test(html)) {
    throw new Error(`ボットチャレンジのページが返されました: ${url.href}`);
  }
  const { result } = await ogs({ html });
  // 外部のページが指定した URL は、http(s) のものだけを使う
  const absolute = (value: string | undefined) => {
    const { protocol, href } = (value ? URL.parse(value, url) : null) ?? {};
    return typeof protocol === "string" && /^https?:$/.test(protocol) ? href : undefined;
  };
  // サムネイルとファビコンは、取得してこのサイトから配信する（取得できなければ、なし）
  // ファビコンは、ホスト名ごとに 1 つ
  const imageUrl = absolute(result.ogImage?.[0]?.url);
  const thumbnail = imageUrl && (await hostImage(imageUrl, { width: 480 }));
  if (imageUrl && !thumbnail) warn(`${owner} のリンクカードの画像を取得できません: ${imageUrl}`, owner);
  const $ = load(html);
  const links = $("link[rel]")
    .toArray()
    .filter((node) => /icon/i.test($(node).attr("rel") ?? ""));
  const candidates = links
    .flatMap((node) => {
      const href = absolute($(node).attr("href"));
      if (!href) return [];
      const type = ($(node).attr("type") ?? "").toLowerCase();
      const path = new URL(href).pathname.toLowerCase();
      if (type.includes("svg") || path.endsWith(".svg")) return [];
      return [{ href, ico: path.endsWith(".ico") || /(?:x-icon|vnd.microsoft.icon)/.test(type) }];
    })
    .sort((a, b) => Number(a.ico) - Number(b.ico))
    .map(({ href }) => href);
  if (!links.length) candidates.push(new URL("/favicon.ico", url).href);
  candidates.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(url.host)}&sz=64`);
  const favicon = await hostImage(candidates, {
    width: 32,
    maxBytes: 256_000,
    key: `favicon:${url.host}`,
    icon: true,
  });
  if (!favicon) warn(`${owner} のリンクカードのアイコンを取得できません: ${url.href}`, owner);
  const clean = (value: string) => {
    const result = cleanTextUnicode(value);
    if (result.changed) warn("リンクカードの不可視文字を取り除きました", owner);
    for (const info of inspectTextUrls(result.value)) {
      if (info.mixed || info.confusable) warn(`リンクの接続先を確認してください: ${info.ascii}`, owner);
    }
    return result.value;
  };
  return h("a.link-card", { href: url.href }, [
    h("span.link-card-body", [
      h("span.link-card-title", clean(result.ogTitle ?? url.href)),
      result.ogDescription && h("span.link-card-description", clean(result.ogDescription)),
      h("span.link-card-site", [
        favicon && h("img", { src: favicon.src, alt: "", width: 16, height: 16 }),
        h("span.link-card-url", url.href),
      ]),
    ]),
    thumbnail &&
      h("img.link-card-image", {
        src: thumbnail.src,
        alt: "",
        loading: "lazy",
        width: thumbnail.width,
        height: thumbnail.height,
      }),
  ]);
};
