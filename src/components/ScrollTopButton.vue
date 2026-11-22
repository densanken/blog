<script setup lang="ts">
import { ArrowUp } from "@lucide/vue";

// ページの先頭付近では、ボタンを隠す（レイアウトは動かさず、タブ移動と読み上げの対象からも外す）
const visible = ref(false);
const update = () => {
  visible.value = window.scrollY > 200;
};
onMounted(() => {
  update();
  window.addEventListener("scroll", update, { passive: true });
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", update);
});

// アニメーションを減らす設定では、すぐに移動する
const toTop = () => {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
};
</script>

<template>
  <button type="button" class="to-top" :class="{ 'is-hidden': !visible }" :inert="!visible" @click="toTop">
    <ArrowUp :size="20" aria-hidden="true" />
    <span class="to-top-label">トップへ戻る</span>
  </button>
</template>
