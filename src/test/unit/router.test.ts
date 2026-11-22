import { expect, it, vi } from "vitest";
import { START_LOCATION } from "vue-router";

it("restores the saved position instantly when returning to the same page without a hash", async () => {
  vi.stubGlobal("useNuxtApp", () => ({}));
  vi.stubGlobal("useRouter", () => ({}));
  try {
    const modulePath = "../../router.options.ts";
    const { default: routerOptions } = (await import(modulePath)) as {
      default: {
        scrollBehavior: (
          to: { path: string; hash: string },
          from: { path: string; hash: string },
          savedPosition: { left: number; top: number }
        ) => unknown;
      };
    };
    const to = { path: "/article", hash: "" };
    const from = { path: "/article", hash: "#heading" };
    expect(routerOptions.scrollBehavior(to, from, { left: 0, top: 850 })).toEqual({
      left: 0,
      top: 850,
      behavior: "instant",
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

type ScrollBehavior = (
  to: { path: string; hash: string },
  from: { path: string; hash: string },
  savedPosition: { left: number; top: number } | null
) => unknown;
const scrollBehavior = async () => {
  vi.stubGlobal("useNuxtApp", () => ({}));
  vi.stubGlobal("useRouter", () => ({}));
  const modulePath = "../../router.options.ts";
  return ((await import(modulePath)) as { default: { scrollBehavior: ScrollBehavior } }).default.scrollBehavior;
};

it("prefers the saved position to the hash on the same page and on the first navigation", async () => {
  try {
    const behave = await scrollBehavior();
    const saved = { left: 0, top: 1200 };
    const expected = { left: 0, top: 1200, behavior: "instant" };
    // 見出しへのリンクで開いた記事を読み進めて、別のページへ移動し、戻る
    expect(behave({ path: "/article", hash: "#heading" }, { path: "/article", hash: "" }, saved)).toEqual(expected);
    expect(behave({ path: "/article", hash: "#heading" }, START_LOCATION as never, saved)).toEqual(expected);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("scrolls to the heading when there is no saved position", async () => {
  vi.stubGlobal("document", { getElementById: () => null });
  try {
    const behave = await scrollBehavior();
    const result = behave({ path: "/article", hash: "#heading" }, { path: "/article", hash: "" }, null);
    expect(result).toEqual({ el: "#heading", top: 0, behavior: "auto" });
  } finally {
    vi.unstubAllGlobals();
  }
});
