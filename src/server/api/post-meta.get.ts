import { queryCollection } from "@nuxt/content/server";

import { tocWithIcons } from "../utils/toc";

export default defineEventHandler(async (event) => {
  const stem = getQuery(event).stem;
  if (typeof stem !== "string") return { post: null };
  const result = await queryCollection(event, "posts").where("stem", "=", stem).first();
  if (!result) return { post: null };
  const { body, ...metadata } = result;
  return { post: { ...metadata, toc: body.toc && { ...body.toc, links: tocWithIcons(body.toc.links, body.value) } } };
});
