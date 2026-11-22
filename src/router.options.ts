import { START_LOCATION } from "vue-router";

import type { RouterConfig } from "@nuxt/schema";

const scrollMarginTop = (hash: string) => {
  const element = document.getElementById(hash.slice(1));
  return element ? Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0 : 0;
};

// ページを移動するときのスクロールは即時にし、同じページ内の移動はなめらかにする
export default {
  // Nuxt が使う vue-router の scrollBehavior は、非推奨だが Nuxt 側が対応するまで、これを使う
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  scrollBehavior(to, from, savedPosition) {
    const nuxtApp = useNuxtApp();
    const router = useRouter();
    const position = () => {
      if (to.hash) return { el: to.hash, top: scrollMarginTop(to.hash), behavior: "instant" as const };
      if (savedPosition) return { ...savedPosition, behavior: "instant" as const };
      return { left: 0, top: 0, behavior: "instant" as const };
    };
    if (from === START_LOCATION) return position();
    if (to.path === from.path) {
      if (to.hash) return { el: to.hash, top: scrollMarginTop(to.hash), behavior: "auto" };
      if (savedPosition) return { ...savedPosition, behavior: "instant" };
      return from.hash ? { left: 0, top: 0, behavior: "auto" } : false;
    }
    return new Promise((resolve) => {
      // 新しいページを描画してから、フレームの終わりにスクロールする
      nuxtApp.hooks.hookOnce("page:loading:end", () => {
        requestAnimationFrame(() => {
          if (router.currentRoute.value.fullPath !== to.fullPath) {
            resolve(false);
          } else {
            resolve(position());
          }
        });
      });
    });
  },
} satisfies RouterConfig;
