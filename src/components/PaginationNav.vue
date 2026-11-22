<script setup lang="ts">
import { ChevronLeft, ChevronRight } from "@lucide/vue";

const { page, pageCount, base = "/" } = defineProps<{ page: number; pageCount: number; base?: string }>();
// 最初と最後、現在のページとその前後だけを番号で表示し、間は省略する
const numbers = computed(() =>
  Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (number) => number === 1 || number === pageCount || Math.abs(number - page) <= 1
  )
);
</script>

<template>
  <nav v-if="pageCount > 1" class="pagination" aria-label="ページ送り">
    <NuxtLink v-if="page > 1" :to="pagePath(base, page - 1)" rel="prev" aria-label="前のページ"
      ><ChevronLeft :size="18"
    /></NuxtLink>
    <template v-for="(number, index) in numbers" :key="number">
      <span v-if="index && number - numbers[index - 1]! > 1" aria-hidden="true">…</span>
      <NuxtLink :to="pagePath(base, number)" :aria-current="number === page ? 'page' : undefined">{{
        number
      }}</NuxtLink>
    </template>
    <NuxtLink v-if="page < pageCount" :to="pagePath(base, page + 1)" rel="next" aria-label="次のページ"
      ><ChevronRight :size="18"
    /></NuxtLink>
  </nav>
</template>
