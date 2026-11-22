import { expect, it, vi } from "vitest";

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
