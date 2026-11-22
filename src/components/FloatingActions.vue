<script setup lang="ts">
import { ListTree, Share2 } from "@lucide/vue";

// 狭い画面で、目次、共有、先頭へ戻るボタンを右下にまとめて表示する（共有は、ボタンの左に共有先が横に開く）
defineProps<{ hasToc: boolean; title: string; path: string }>();
const shareOpen = ref(false);
const share = useTemplateRef<HTMLElement>("share");
const shareButton = useTemplateRef<HTMLButtonElement>("shareButton");

// 外側をタップするか、Escape キーを押すと閉じる
const onPointerdown = (event: PointerEvent) => {
  if (!share.value?.contains(event.target as Node)) shareOpen.value = false;
};
const onKeydown = (event: KeyboardEvent) => {
  if (event.key === "Escape" && shareOpen.value) {
    shareOpen.value = false;
    shareButton.value?.focus();
  }
};
onMounted(() => {
  document.addEventListener("pointerdown", onPointerdown);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerdown);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="floating-actions">
    <button v-if="hasToc" type="button" popovertarget="toc-popover" aria-label="目次を開く">
      <ListTree :size="20" aria-hidden="true" />
    </button>
    <div ref="share" class="floating-share">
      <button
        ref="shareButton"
        type="button"
        aria-label="この記事をシェアする"
        aria-controls="share-options"
        :aria-expanded="shareOpen"
        @click="shareOpen = !shareOpen"
      >
        <Share2 :size="20" aria-hidden="true" />
      </button>
      <div id="share-options" class="share-options" :inert="!shareOpen">
        <ShareButtons :title="title" :path="path" />
      </div>
    </div>
    <ScrollTopButton />
  </div>
</template>
