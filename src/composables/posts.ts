// 記事一覧の1ページ分と総ページ数を返す（authorId があれば、その著者の記事だけを対象とする）
// 範囲外のページは 404
export const usePostPage = async (page: number, authorId?: string, pinned: string[] = []) => {
  const { data } = await useAsyncData(`posts-${authorId ?? ""}-page-${String(page)}`, async () => {
    const query = () => {
      const posts = queryCollection("posts");
      if (!authorId) return posts;
      const [from, to] = authorRange(authorId);
      posts.where("stem", ">=", from).where("stem", "<", to);
      if (pinned.length) posts.where("stem", "NOT IN", pinned);
      return posts;
    };
    return {
      posts: await query()
        .select("title", "description", "excerpt", "date", "stem", "readingTime")
        .order("date", "DESC")
        .order("stem", "ASC")
        .limit(postsPerPage)
        .skip((page - 1) * postsPerPage)
        .all(),
      total: await query().count(),
    };
  });

  const pageCount = Math.max(1, Math.ceil((data.value?.total ?? 0) / postsPerPage));
  if (page > pageCount) {
    throw createError({ status: 404, statusText: "Page not found", fatal: true });
  }
  return { posts: data.value?.posts ?? [], pageCount };
};
