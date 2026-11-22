<script setup lang="ts">
import { ogLogo } from "../../../plugins/og-icon.ts";
import { ogLines } from "../../../plugins/og-text.ts";

const { title = "CCSブログ", description = "" } = defineProps<{ title?: string; description?: string }>();
// 説明文は固定なので、語の区切りで 2 行に分ける（text-balance は語の途中で折れる）
const lines = ogLines(description, 22, 2);
const logo = await ogLogo(useRuntimeConfig().ogLogoPath);
</script>

<template>
  <div class="flex h-full w-full bg-[#3b5bdb] p-9" style="font-family: &quot;Noto Sans JP&quot;">
    <div class="flex h-full w-full items-center rounded-3xl bg-[#f8fafc] px-12 pb-[50px] text-[#1e293b]">
      <img :src="logo" width="200" height="200" class="mr-10" />
      <div class="flex flex-1 flex-col">
        <h1 class="m-0 line-clamp-2 text-8xl font-bold leading-tight text-[#1e293b]">{{ title }}</h1>
        <div v-if="description" class="mt-6 flex flex-col text-4xl leading-snug text-[#475569]">
          <p v-for="line in lines" :key="line" class="m-0">{{ line }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
