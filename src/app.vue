<script setup lang="ts">
// 正規 URL は、サイトの URL とページのパス（末尾のスラッシュつき、ハッシュなし）にする
const route = useRoute();
const router = useRouter();
const siteUrl = useSiteConfig().url;
useHead({ link: [{ rel: "canonical", href: () => `${siteUrl}${route.path}` }] });

const onAnchorClick = (event: MouseEvent) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>("a[href]");
  // 同じページの見出しへのリンク（`#section` も、`/@writer/hello/#section` のようなルート相対のリンクも）は、なめらかにスクロールする
  const samePageAnchor =
    !!link?.hash &&
    link.origin === location.origin &&
    link.pathname === location.pathname &&
    link.search === location.search;
  if (
    link?.closest(".prose, .suggested-posts") &&
    /^\/(?!\/)/.test(link.getAttribute("href")!) &&
    router.resolve(link.getAttribute("href")!).matched.length > 0 &&
    !link.target &&
    !link.hasAttribute("download") &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  ) {
    event.preventDefault();
    if (samePageAnchor) document.documentElement.classList.add("smooth-anchor");
    void router.push(link.getAttribute("href")!);
    return;
  }
  if (samePageAnchor) document.documentElement.classList.add("smooth-anchor");
};
onMounted(() => {
  document.addEventListener("click", onAnchorClick);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onAnchorClick);
});
</script>

<template>
  <NuxtRouteAnnouncer />
  <SiteLayout><NuxtPage /></SiteLayout>
</template>
