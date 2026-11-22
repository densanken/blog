import { queryCollection } from "@nuxt/content/server";
import { Feed } from "feed";

import { getSiteConfig } from "#site-config/server/composables";

const limit = 20;

// feed はタイトルと概要を type="html" で出力するため、作者が書いた文字列は HTML として解釈されないようにエスケープする
const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

// OG 画像の URL は nuxt-og-image が記事ごとのオプションからハッシュを求めて決めるため、記事のページを内部でレンダリングして og:image を読む
const ogImage = async (event: Parameters<Parameters<typeof defineEventHandler>[0]>[0], path: string) => {
  try {
    const html = await event.$fetch<string>(path, { responseType: "text" });
    const tag = /<meta\s[^>]*property="og:image"[^>]*>/.exec(html)?.[0];
    return tag ? /\scontent="([^"]*)"/.exec(tag)?.[1]?.replaceAll("&amp;", "&") : undefined;
  } catch {
    return undefined;
  }
};

export default defineEventHandler(async (event) => {
  const { url, name, description } = getSiteConfig(event) as { url: string; name: string; description: string };
  const [posts, authors] = await Promise.all([listPosts(event), queryCollection(event, "authors").all()]);
  const feed = new Feed({
    id: `${url}/`,
    title: name,
    description,
    link: `${url}/`,
    language: "ja",
    copyright: "千葉大学電子計算機研究会",
    // 公開日が最新の記事より、古い記事の更新日のほうが新しい場合があるため、全記事の更新日の最大値を使う
    updated: postDate(
      posts
        .map(({ date, updated }) => updated ?? date)
        .sort()
        .at(-1) ?? "1970-01-01"
    ),
    feedLinks: { atom: `${url}/feed.xml` },
  });
  const items = posts.slice(0, limit);
  const images = await Promise.all(items.map((post) => ogImage(event, postPath(post.stem))));
  const icons: (string | undefined)[] = [];
  for (const [index, post] of items.entries()) {
    const authorId = post.stem.split("/")[0]!;
    const author = authors.find(({ stem }) => stem === `${authorId}/profile`);
    // アイコンは 48px と 96px の URL をカンマで並べた形のため、大きいほうを使う
    const icon = author?.icon ? (author.icon.split(",")[1] ?? author.icon.split(",")[0] ?? "") : "";
    icons.push(icon ? `${url}${icon}` : undefined);
    const link = `${url}${postPath(post.stem)}`;
    const image = images[index];
    feed.addItem({
      id: link,
      link,
      title: escapeHtml(post.title),
      description: escapeHtml(post.description || post.excerpt || ""),
      published: postDate(post.date),
      date: postDate(post.updated ?? post.date),
      ...(image && { enclosure: { url: image, type: "image/png" } }),
      author: [{ name: author?.name, link: `${url}${authorPath(authorId)}` }],
    });
  }
  setHeader(event, "content-type", "application/atom+xml; charset=utf-8");
  // Atom の author には画像の要素がないため、Media RSS の media:thumbnail を author の中に足す（記事と author は 1 対 1 で、出力の順に対応する）
  let index = 0;
  return feed
    .atom1()
    .replace("<feed ", '<feed xmlns:media="http://search.yahoo.com/mrss/" ')
    .replace(/(\n[ \t]*)<\/author>/g, (end, indent: string) => {
      const icon = icons[index++];
      return icon ? `${indent}    <media:thumbnail url="${escapeHtml(icon)}"/>${end}` : end;
    });
});
