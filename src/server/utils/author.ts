import { queryCollection } from "@nuxt/content/server";

import { validatePinned } from "../../../plugins/validate-content.ts";

import type { H3Event } from "h3";

export const resolveAuthor = <T extends { stem: string; pinned?: string[] }>(author: T, posts: { stem: string }[]) => ({
  ...author,
  pinnedStems: resolvePinnedPosts(posts, author.stem.split("/")[0]!, author.pinned ?? []).map((post) => post.stem),
});

export const getAuthor = async (event: H3Event, authorId: string) => {
  const author = await queryCollection(event, "authors").where("stem", "=", `${authorId}/profile`).first();
  if (!author) return null;
  const slugs = author.pinned ?? [];
  const candidates = slugs.length
    ? await queryCollection(event, "posts")
        .select("stem")
        .where(
          "stem",
          "IN",
          slugs.map((slug) => `${authorId}/${slug}`)
        )
        .all()
    : [];
  const resolved = resolveAuthor(author, candidates);
  if (import.meta.dev) {
    validatePinned(
      slugs,
      new Set(resolved.pinnedStems.map((stem) => stem.slice(authorId.length + 1))),
      `contents/${author.id}`
    );
  }
  return resolved;
};
