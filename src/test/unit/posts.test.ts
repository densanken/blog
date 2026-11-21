import { expect, it } from "vitest";

import { authorPath, authorRange, encodeStem, pagePath, postPath, postsPerPage } from "../../shared/utils/posts.ts";

it("encodes path segments and selects only the author's stems", () => {
  expect(encodeStem("writer/日本 語/article#1")).toBe("writer/%E6%97%A5%E6%9C%AC%20%E8%AA%9E/article%231");
  expect(postPath("writer/日本語")).toBe("/@writer/%E6%97%A5%E6%9C%AC%E8%AA%9E/");
  expect(authorPath("writer")).toBe("/@writer/");
  expect(pagePath("/", 1)).toBe("/");
  expect(pagePath(authorPath("writer"), 2)).toBe("/@writer/page/2/");
  const [from, to] = authorRange("a_b");
  expect("a_b/post" >= from && "a_b/post" < to).toBe(true);
  expect("axb/post" >= from && "axb/post" < to).toBe(false);
  expect(postsPerPage).toBe(10);
});
