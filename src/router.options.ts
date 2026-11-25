import { createMemoryHistory, createWebHistory, START_LOCATION } from "vue-router";

import type { RouterConfig } from "@nuxt/schema";

const scrollMarginTop = (hash: string) => {
  const element = document.getElementById(hash.slice(1));
  return element ? Number.parseFloat(getComputedStyle(element).scrollMarginTop) || 0 : 0;
};

// ページを移動するときのスクロールは即時にし、同じページ内の移動はなめらかにする
export default {
  // Cloudflare Workers の Static Assets は、`/@writer/hello/` を `/%40writer/hello/` にリダイレクトする
  // vue-router は URL を復号せずにルートと照合するため、`%40` のままでは `/@[author]` に一致せず、404 になる
  // ルーターを作る前に `%40` を `@` に戻す（それ以外は Nuxt の既定と同じ履歴を使う）
  history: (base) => {
    if (import.meta.client) {
      const { pathname, search, hash } = location;
      if (pathname.includes("%40")) {
        history.replaceState(history.state, "", `${pathname.replaceAll("%40", "@")}${search}${hash}`);
      }
      return createWebHistory(base);
    }
    return createMemoryHistory(base);
  },
  // Nuxt が使う vue-router の scrollBehavior は、非推奨だが Nuxt 側が対応するまで、これを使う
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  scrollBehavior(to, from, savedPosition) {
    const nuxtApp = useNuxtApp();
    const router = useRouter();
    // 戻る・進むでは、ハッシュより、履歴に保存した位置（離れたときの、読み進めた位置）を優先する（Nuxt の既定と同じ）
    // 新しくリンクをたどったときは、保存した位置がないため、ハッシュの見出しにスクロールする
    const position = () => {
      if (savedPosition) return { ...savedPosition, behavior: "instant" as const };
      if (to.hash) return { el: to.hash, top: scrollMarginTop(to.hash), behavior: "instant" as const };
      return { left: 0, top: 0, behavior: "instant" as const };
    };
    if (from === START_LOCATION) return position();
    if (to.path === from.path) {
      if (savedPosition) return { ...savedPosition, behavior: "instant" };
      if (to.hash) return { el: to.hash, top: scrollMarginTop(to.hash), behavior: "auto" };
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
