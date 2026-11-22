<script setup lang="ts">
const authorId = useRoute().params.author as string;
</script>

<template>
  <AuthorIndex :author-id="authorId" :page="1" />
</template>
