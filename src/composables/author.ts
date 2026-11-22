import type { getAuthor } from "../server/utils/author";

export const authorIconUrl = (icon: string, size = 48) => icon.split(",")[size > 48 ? 1 : 0] ?? "";

export const useAuthor = async (authorId: string) => {
  const path = `/api/author/${encodeURIComponent(authorId)}`;
  const requestFetch = useRequestFetch();
  const { data: author, error } = await useAsyncData(`author-${authorId}`, () =>
    requestFetch<Awaited<ReturnType<typeof getAuthor>>>(path, { responseType: "json" })
  );
  if (error.value && error.value.status !== 404) {
    throw createError({ status: 500, statusText: "Failed to load author", fatal: true });
  }
  if (!author.value?.name) {
    throw createError({ status: 404, statusText: `Profile not found or invalid: ${authorId}`, fatal: true });
  }
  return author.value;
};
