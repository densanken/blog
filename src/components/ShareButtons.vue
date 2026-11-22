<script setup lang="ts">
import { Check, Link, Share2 } from "@lucide/vue";
import { siBluesky, siHatenabookmark, siX } from "simple-icons";

const { title, path } = defineProps<{ title: string; path: string }>();
const url = `${useSiteConfig().url}${path}`;
const u = encodeURIComponent(url);
const t = encodeURIComponent(title);
const both = encodeURIComponent(`${title} ${url}`);
const services = [
  { name: "X", icon: siX, href: `https://x.com/intent/post?text=${t}&url=${u}` },
  { name: "Bluesky", icon: siBluesky, href: `https://bsky.app/intent/compose?text=${both}` },
  {
    name: "はてなブックマーク",
    icon: siHatenabookmark,
    href: `https://b.hatena.ne.jp/add?mode=confirm&url=${u}&title=${t}`,
  },
];

// Web Share API に対応する環境（主にスマートフォン）だけに、共有ボタンを表示する
const canShare = ref(false);
onMounted(() => {
  canShare.value = "share" in navigator;
});

// 共有メニューを閉じたときは reject されるため、無視する
const share = () => navigator.share({ title, url }).catch(() => undefined);
const copied = ref(false);
const copy = async () => {
  // クリップボードを使えない環境（非 HTTPS や権限なし）では、何もしない
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    return;
  }
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
};
</script>

<template>
  <div class="share-buttons">
    <a
      v-for="service in services"
      :key="service.name"
      :href="service.href"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="`${service.name}で共有`"
      :title="`${service.name}で共有`"
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path :d="service.icon.path" />
      </svg>
    </a>
    <button v-if="canShare" type="button" aria-label="共有メニューを開く" title="共有メニューを開く" @click="share">
      <Share2 :size="18" aria-hidden="true" />
    </button>
    <button
      type="button"
      :title="copied ? 'コピーしました' : 'リンクをコピー'"
      :aria-label="copied ? 'コピーしました' : 'リンクをコピー'"
      @click="copy"
    >
      <Check v-if="copied" :size="18" aria-hidden="true" />
      <Link v-else :size="18" aria-hidden="true" />
    </button>
  </div>
</template>
