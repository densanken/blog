import { pinnedPostsLimit } from "../src/shared/utils/posts.ts";
import { postDate } from "./jst.ts";
import { defect, warn } from "./warn.ts";

export const validatePinned = (value: unknown, available?: Set<string>, file?: string) => {
  // DB から読んだ未指定の値と、YAML の空の pinned: は null になる
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    if (file) defect("pinned は配列で指定してください", file);
    return undefined;
  }
  const result: string[] = [];
  for (const [index, item] of value.entries()) {
    const slug = typeof item === "string" ? item.toLowerCase() : undefined;
    if (index >= pinnedPostsLimit) {
      if (file) defect(`pinned の ${String(pinnedPostsLimit)} 件を超える項目を無視します`, file);
    } else if (!slug) {
      if (file) defect("pinned の項目が不正です（文字列以外）", file);
    } else if (available && !available.has(slug)) {
      // CI は他の著者の記事を削除してビルドし、予約投稿は公開日まで含まれないため、不備にしない
      if (file) warn(`pinned の記事が見つからないか公開されていません: ${slug}`, file);
    } else if (result.includes(slug)) {
      if (file) defect(`pinned の記事が重複しています: ${slug}`, file);
    } else result.push(slug);
  }
  return result;
};

// 記事とプロフィールの値を検証する（@nuxt/content は、スキーマ（zod）で値を検証しないため、nuxt.config.ts のフックが、解析のたびにここで検証する）
// 必須の値（name、title、date）が不正な場合は、Error を投げる（その記事とプロフィールは、使われない）
// それ以外の不正な値は、undefined にする（表示されない）
// 作者が自由に書ける値のため、型が違う値（配列やオブジェクトなど）でも、例外にならない
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length >= 1 && value.length <= max ? value : undefined;
const match = (value: unknown, pattern: RegExp) =>
  typeof value === "string" && pattern.test(value) ? value : undefined;

// `https://` の URL（認証情報なし）
const httpsUrl = (value: unknown, max: number) => {
  if (typeof value !== "string" || !text(value, max) || !value.startsWith("https://")) return undefined;
  try {
    const url = new URL(value);
    return url.username || url.password ? undefined : value;
  } catch {
    return undefined;
  }
};

export const validateAuthor = (content: Record<string, unknown>) => {
  const name = text(content.name, 100);
  if (!name) throw new Error("name が不正です");
  const year = typeof content.admissionYear === "number" ? String(content.admissionYear) : content.admissionYear;
  // icon は、`https://` の URL か、著者のディレクトリからの相対パス（`assets/icon.png`）だけ（取得して保存した画像のパスは、ビルドが設定するため、書けない）
  const localIcon = match(content.icon, /^assets\/[\w./-]{1,200}$/);
  const icon =
    httpsUrl(content.icon, 500) ?? (localIcon && !localIcon.split("/").includes("..") ? localIcon : undefined);
  return {
    name,
    // GitHub のユーザー名と Organization 名: 英数字とハイフン、39 文字まで
    github: match(content.github, /^[a-z\d][a-z\d-]{0,38}$/i),
    x: match(content.x, /^\w{1,15}$/),
    twitter: match(content.twitter, /^\w{1,15}$/),
    website: httpsUrl(content.website, 200),
    bio: text(content.bio, 500),
    admissionYear: text(year, 20),
    icon,
  };
};

export const validatePost = (content: Record<string, unknown>) => {
  const title = text(content.title, 300);
  if (!title) throw new Error("title が不正です");
  // YAML が日付として読んだ値（Date）も受け付ける
  const date = postDate(content.date);
  if (!date) throw new Error("date が不正です");
  return { title, date, description: text(content.description, 1000) };
};
