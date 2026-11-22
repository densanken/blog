<script setup lang="ts">
import type { IconTocLink } from "~/shared/utils/toc";

// 広い画面では本文の右の列に表示し、狭い画面では FloatingActions のボタンで開くポップオーバーに表示する
const { links } = defineProps<{ links: IconTocLink[] }>();
const active = ref<string>();
const panel = useTemplateRef<HTMLElement>("panel");
const popover = useTemplateRef<HTMLElement>("popover");

// 画面の上端付近を通り過ぎた最後の見出しを、現在の節として強調する
// ページの下端では、最後の見出しが画面の上端に届かないため、URL の `#` が指す見出しが画面内にあればそれを、なければ画面内の最後の見出しを選ぶ
// 画面内に見出しがない場合（記事の後のプロフィールなどまでスクロールした場合）は、通り過ぎた最後の見出しを選ぶ
onMounted(() => {
  const headings = [...document.querySelectorAll<HTMLElement>(".prose :is(h2, h3)[id]:not(.sr-only)")];
  const decode = () => {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return location.hash.slice(1);
    }
  };
  let target = decode();
  const update = () => {
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    // 各見出しの位置は、1回の更新で1度だけ読む
    const rects = headings.map((heading) => {
      const { top, bottom } = heading.getBoundingClientRect();
      return { heading, top, bottom };
    });
    const shown = rects.filter(({ top, bottom }) => top < window.innerHeight && bottom > 0);
    const limit = headerHeight() + 24;
    const passed = rects.filter(({ top }) => top <= limit);
    const bottomHeading = atBottom ? (shown.find(({ heading }) => heading.id === target) ?? shown.at(-1)) : undefined;
    active.value = (bottomHeading ?? passed.at(-1) ?? rects[0])?.heading.id;
  };
  // スクロールのたびではなく、描画の直前に1度だけ更新する
  let frame = 0;
  const onScroll = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  const onHashChange = () => {
    target = decode();
    update();
  };
  update();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("hashchange", onHashChange);
  onBeforeUnmount(() => {
    window.removeEventListener("scroll", onScroll);
    cancelAnimationFrame(frame);
    window.removeEventListener("hashchange", onHashChange);
  });
});

// 現在の節が、目次の枠の中で下から 1/3（上へ戻るときは上から 1/3）より外に出たら、枠の上から 1/3 の位置にくるようにスクロールする
// ページ本体は動かさず、固定した「目次」の見出しの下だけを使う
const follow = (box: HTMLElement | null, instant = false) => {
  const current = box?.querySelector("[aria-current]");
  // 表示していない枠（広い画面のポップオーバーなど）は、対象外
  if (!box || !current || !box.getClientRects().length) return;
  const label = box.querySelector("p")!.getBoundingClientRect();
  const boxRect = box.getBoundingClientRect();
  const height = boxRect.bottom - label.bottom;
  const offset = current.getBoundingClientRect().top - label.bottom;
  if (!instant && offset >= height / 3 && offset <= (height * 2) / 3) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  box.scrollTo({ top: box.scrollTop + offset - height / 3, behavior: instant || reduced ? "instant" : "smooth" });
};
watch(active, async () => {
  await nextTick();
  // 広い画面の枠は、ポインターが枠の上にある間（自分でスクロールしている間）は動かさない
  if (!panel.value?.matches(":hover")) follow(panel.value);
  follow(popover.value);
});
// ポップオーバーは、開いたときに現在の節の位置へ移す
const onToggle = (event: Event) => {
  if ((event as ToggleEvent).newState === "open") follow(popover.value, true);
};
</script>

<template>
  <nav ref="panel" class="toc toc-panel" aria-label="目次">
    <p>目次</p>
    <TocList :links="links" :active="active" rail />
  </nav>
  <nav
    id="toc-popover"
    ref="popover"
    popover
    class="toc toc-popover"
    aria-label="目次"
    @click="popover?.hidePopover()"
    @toggle="onToggle"
  >
    <p>目次</p>
    <TocList :links="links" :active="active" rail />
  </nav>
</template>
