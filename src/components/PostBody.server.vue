<script setup lang="ts">
const { stem } = defineProps<{ stem: string }>();
const post = await queryCollection("posts").where("stem", "=", stem).first();
</script>

<template>
  <ContentRenderer v-if="post" :value="post" class="prose" data-pagefind-body />
</template>
