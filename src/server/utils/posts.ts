import { queryCollection } from "@nuxt/content/server";

import type { H3Event } from "h3";

// 日付だけの記事の日時は、日本時間の 0 時として扱う
export const postDate = (date: string) => new Date(`${date}T00:00:00+09:00`);

// 新しい順に、記事の一覧を返す
export const listPosts = (event: H3Event) =>
  queryCollection(event, "posts")
    .select("title", "description", "excerpt", "date", "updated", "stem")
    .order("date", "DESC")
    .order("stem", "ASC")
    .all();
