<script setup lang="ts">
import type { IconTocLink } from "~/shared/utils/toc";

// rail のときは、第 1 階層の項目に、進捗（通過した節、現在の節）を data-state で付ける
const props = defineProps<{ links: IconTocLink[]; active?: string; rail?: boolean }>();
const activeIndex = computed(() =>
  props.links.findIndex((link) => link.id === props.active || link.children?.some((child) => child.id === props.active))
);
const state = (index: number) => {
  if (!props.rail || activeIndex.value < 0) return undefined;
  return index < activeIndex.value ? "passed" : index === activeIndex.value ? "current" : undefined;
};
</script>

<template>
  <!-- 目次の SVG はサーバー側でビルド済みアイコンから生成する -->
  <!-- eslint-disable vue/no-v-html -->
  <ol>
    <li v-for="(link, index) in links" :key="link.id" :data-state="state(index)">
      <a :href="`#${link.id}`" :aria-label="link.iconLabel" :aria-current="link.id === active ? 'location' : undefined"
        ><template v-if="link.parts"
          ><template v-for="(part, partIndex) in link.parts" :key="partIndex"
            ><span v-if="'text' in part">{{ part.text }}</span><span v-else v-html="part.svg" /></template></template
        ><template v-else>{{ link.text }}</template></a
      >
      <TocList v-if="link.children?.length" :links="link.children" :active="active" />
    </li>
  </ol>
  <!-- eslint-enable vue/no-v-html -->
</template>
