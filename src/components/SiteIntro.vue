<script setup lang="ts">
const requestFetch = useRequestFetch();
const { data } = await useAsyncData("site-intro-post", () => requestFetch("/api/intro-post.json"));
</script>

<template>
  <p class="site-intro">
    <span v-for="sentence in siteIntroSentences" :key="sentence">{{ sentence }}</span>
    <span v-if="data?.post"
      >詳しくは「<NuxtLink :to="postPath(data.post.stem)">{{ data.post.title }}</NuxtLink>」をご覧ください。</span
    >
  </p>
</template>
