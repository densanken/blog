import { queryCollection } from "@nuxt/content/server";

// 一覧の2ページ目以降の URL
const pagePaths = (base: string, count: number) =>
  Array.from({ length: Math.ceil(count / postsPerPage) - 1 }, (_, index) => ({ loc: pagePath(base, index + 2) }));

// @nuxtjs/sitemap に、記事、著者ページ、一覧のページ送りの URL を渡す（記事のある著者だけ）
export default defineSitemapEventHandler(async (event) => {
  const [posts, authors] = await Promise.all([listPosts(event), queryCollection(event, "authors").all()]);
  return [
    { loc: "/" },
    ...pagePaths("/", posts.length),
    ...authors.flatMap((author) => {
      const id = author.stem.split("/")[0]!;
      const authorPosts = posts.filter((post) => post.stem.startsWith(`${id}/`));
      const count = authorPosts.length - resolveAuthor(author, authorPosts).pinnedStems.length;
      return authorPosts.length ? [{ loc: authorPath(id) }, ...pagePaths(authorPath(id), count)] : [];
    }),
    ...posts.map((post) => ({ loc: postPath(post.stem), lastmod: post.updated ?? post.date })),
  ];
});
