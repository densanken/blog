// 記事一覧の1ページあたりの記事数（一覧のページ送りとサイトマップが使う）
export const postsPerPage = 10;
export const pinnedPostsLimit = 3;
export const relatedPostsLimit = 5;

export const resolvePinnedPosts = <T extends { stem: string }>(posts: T[], authorId: string, slugs: string[]) =>
  slugs.flatMap((slug) => {
    const post = posts.find((item) => item.stem === `${authorId}/${slug.toLowerCase()}`);
    return post ? [post] : [];
  });

export const selectRelatedPosts = <T extends { stem: string }>(pinned: T[], recent: T[], current: string) => {
  const seen = new Set([current]);
  return [...pinned, ...recent]
    .filter((post) => {
      if (seen.has(post.stem)) return false;
      seen.add(post.stem);
      return true;
    })
    .slice(0, relatedPostsLimit);
};

// 著者 ID のディレクトリ内の記事（stem が `<著者ID>/` で始まるもの）の範囲を半開区間で返す
// `/` の次の文字 `0` までなので、LIKE のワイルドカード（`_` と `%`）を使わずに完全に一致する
export const authorRange = (authorId: string) => [`${authorId}/`, `${authorId}0`] as const;

// 記事の stem（`<著者ID>/<スラッグ>`）を、URL のパスの形（セグメントごとにエンコード）にする
export const encodeStem = (stem: string) => stem.split("/").map(encodeURIComponent).join("/");
// ページの正規 URL は、末尾のスラッシュつき（配信する Apache が、ディレクトリの URL をスラッシュつきへリダイレクトするため）
export const postPath = (stem: string) => `/@${encodeStem(stem)}/`;
export const authorPath = (authorId: string) => `/@${encodeURIComponent(authorId)}/`;
// 一覧の n ページ目（base はトップページなら `/`、著者のページなら authorPath）
export const pagePath = (base: string, page: number) => (page === 1 ? base : `${base}page/${String(page)}/`);

// View Transitions の名前（記事ごとに一意で、CSS の識別子として有効な値）
export const transitionName = (stem: string, part: "title" | "date") =>
  `${part}-${encodeURIComponent(stem).replace(/[^\w-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`)}`;
