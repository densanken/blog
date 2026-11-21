import { describe, expect, it, vi } from "vitest";

import { validatePinned } from "../../../plugins/validate-content.ts";
import { stats } from "../../../plugins/warn.ts";
import {
  pinnedPostsLimit,
  relatedPostsLimit,
  resolvePinnedPosts,
  selectRelatedPosts,
} from "../../shared/utils/posts.ts";

describe("pinned posts", () => {
  it("warns and ignores invalid entries and entries beyond the limit", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(validatePinned(["HELLO", "hello", "missing"], new Set(["hello"]), "profile.yaml")).toEqual(["hello"]);
    expect(warning).toHaveBeenCalledTimes(2);
    expect(stats.defects).toBe(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("見つからないか公開されていません: missing"));
    const defects = stats.defects;
    expect(validatePinned([1], new Set(), "profile.yaml")).toEqual([]);
    expect(warning).toHaveBeenLastCalledWith(expect.stringContaining("pinned の項目が不正です"));
    expect(stats.defects).toBe(defects + 1);
    const slugs = Array.from({ length: pinnedPostsLimit + 1 }, (_, index) => `post${String(index)}`);
    expect(validatePinned(slugs, undefined, "profile.yaml")).toEqual(slugs.slice(0, pinnedPostsLimit));
    expect(warning).toHaveBeenLastCalledWith(
      expect.stringContaining(`pinned の ${String(pinnedPostsLimit)} 件を超える`)
    );
    expect(validatePinned("hello", new Set(["hello"]), "profile.yaml")).toBeUndefined();
    expect(validatePinned([{ toString: 1 }], new Set(), "profile.yaml")).toEqual([]);
    expect(validatePinned(["later"], undefined)).toEqual(["later"]);
    const before = warning.mock.calls.length;
    expect(validatePinned(null, new Set(), "profile.yaml")).toBeUndefined();
    expect(validatePinned(undefined, new Set(), "profile.yaml")).toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(before);
    warning.mockRestore();
  });

  it("resolves in profile order and selects distinct related posts", () => {
    const posts = Array.from({ length: Math.max(pinnedPostsLimit, relatedPostsLimit) + 2 }, (_, index) => ({
      stem: `writer/post${String(index)}`,
    }));
    const pinned = resolvePinnedPosts(posts, "writer", ["POST1", "post0", "missing"]);
    expect(pinned.map((post) => post.stem)).toEqual(["writer/post1", "writer/post0"]);
    expect(selectRelatedPosts(pinned, posts, "writer/post1").map((post) => post.stem)).toEqual(
      [posts[0]!, ...posts.slice(2)].slice(0, relatedPostsLimit).map((post) => post.stem)
    );
    expect(
      selectRelatedPosts(posts.slice(0, pinnedPostsLimit), posts, posts.at(-1)!.stem).map((post) => post.stem)
    ).toEqual(posts.slice(0, relatedPostsLimit).map((post) => post.stem));
  });
});
