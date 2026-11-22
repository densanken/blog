<script setup lang="ts">
import { ogIcon, ogLogo } from "../../../plugins/og-icon.ts";
import { ogInitial } from "../../../plugins/og-text.ts";

// icon は、プロフィールの icon の値
// アイコンがない場合も同じ位置に、名前の頭文字の円を置き、レイアウトを変えない
const {
  author = "",
  authorId = "",
  icon = "",
} = defineProps<{
  author?: string;
  authorId?: string;
  icon?: string;
}>();
const { cards, ogLogoPath } = useRuntimeConfig();
const iconUri = icon ? await ogIcon(authorId, icon, { cards }) : undefined;
const logo = await ogLogo(ogLogoPath);
const initial = ogInitial(author);
</script>

<template>
  <div class="flex h-full w-full bg-[#3b5bdb] p-9" style="font-family: &quot;Noto Sans JP&quot;">
    <div class="flex h-full w-full flex-col justify-between rounded-3xl bg-[#f8fafc] p-9 text-[#1e293b]">
      <div class="flex flex-1 items-center">
        <img v-if="iconUri" :src="iconUri" width="200" height="200" class="mr-12 rounded-full" />
        <div
          v-else
          class="mr-12 flex h-[200px] w-[200px] items-center justify-center rounded-full bg-[#dbe4ff] text-8xl font-bold text-[#1d4ed8]"
        >
          {{ initial }}
        </div>
        <div class="flex flex-1 flex-col">
          <h1 class="m-0 line-clamp-2 text-7xl font-bold leading-tight">{{ author }}</h1>
          <p class="m-0 mt-4 text-4xl text-[#475569]">の記事一覧</p>
        </div>
      </div>
      <div class="flex items-center justify-end text-4xl">
        <img :src="logo" width="72" height="72" class="mb-[12px] mr-2" />
        <span class="font-bold text-[#1e293b]">CCSブログ</span>
      </div>
    </div>
  </div>
</template>
