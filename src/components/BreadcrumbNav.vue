<script setup lang="ts">
import { ChevronRight } from "@lucide/vue";

// 最後の項目は現在のページなので、リンクにしない
const { items } = defineProps<{ items: { label: string; to?: string }[] }>();
const { url } = useSiteConfig();

useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: items.map(({ label, to }, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: label,
          ...(to && { item: `${url}${to}` }),
        })),
      },
    },
  ],
});
</script>

<template>
  <nav aria-label="パンくずリスト" class="breadcrumb">
    <ol>
      <li v-for="{ label, to } in items" :key="label">
        <NuxtLink v-if="to" :to="to">{{ label }}</NuxtLink>
        <span v-else aria-current="page">{{ label }}</span>
        <ChevronRight v-if="to" :size="14" aria-hidden="true" />
      </li>
    </ol>
  </nav>
</template>
