import { queryCollection } from "@nuxt/content/server";

import { validatePinned } from "../../../plugins/validate-content.ts";

export default defineEventHandler(async (event) => {
  if (import.meta.prerender) {
    const [authors, posts] = await Promise.all([
      queryCollection(event, "authors").select("id", "stem", "pinned").all(),
      queryCollection(event, "posts").select("stem").all(),
    ]);
    for (const author of authors) {
      const prefix = `${author.stem.slice(0, -"/profile".length)}/`;
      const available = new Set(
        posts.filter((post) => post.stem.startsWith(prefix)).map((post) => post.stem.slice(prefix.length))
      );
      validatePinned(author.pinned, available, `contents/${author.id}`);
    }
  }
  const [author, ...slug] = introPostStem.split("/");
  const stem = [author, ...slug.map((part) => part.toLowerCase())].join("/");
  const post = stem
    ? await queryCollection(event, "posts").select("title", "stem").where("stem", "=", stem).first()
    : null;
  return { post };
});
