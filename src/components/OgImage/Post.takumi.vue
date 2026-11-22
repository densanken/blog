<script setup lang="ts">
import { ogIcon, ogLogo } from "../../../plugins/og-icon.ts";
import { ogInitial } from "../../../plugins/og-text.ts";

// icon は、プロフィールの icon の値
// 検査して変換し直した data URI にして使う（画像を取得しない）
// アイコンがない場合も同じ位置に、名前の頭文字の円を置き、レイアウトを変えない
const {
  title = "CCSブログ",
  author = "",
  authorId = "",
  icon = "",
} = defineProps<{
  title?: string;
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
      <h1 class="m-0 line-clamp-3 text-6xl font-bold leading-tight">{{ title }}</h1>
      <div class="flex items-center justify-between text-4xl">
        <div class="flex items-center">
          <img v-if="iconUri" :src="iconUri" width="64" height="64" class="mr-4 rounded-full" />
          <div
            v-else
            class="mr-4 flex h-[64px] w-[64px] items-center justify-center rounded-full bg-[#dbe4ff] text-3xl font-bold text-[#1d4ed8]"
          >
            {{ initial }}
          </div>
          <span>{{ author }}</span>
        </div>
        <div class="flex items-center">
          <img :src="logo" width="72" height="72" class="mb-[12px] mr-2" />
          <span class="font-bold text-[#1e293b]">CCSブログ</span>
        </div>
      </div>
    </div>
  </div>
</template>
