<script setup lang="ts">
const { authorId } = defineProps<{ authorId: string }>();
const author = await useAuthor(authorId);
</script>

<template>
  <NuxtLink :to="authorPath(authorId)" class="author-link">
    <img v-if="author.icon" :src="authorIconUrl(author.icon)" alt="" width="24" height="24" />
    {{ author.name }}
  </NuxtLink>
</template>
