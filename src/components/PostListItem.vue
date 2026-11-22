<script setup lang="ts">
const { post, showAuthor, plain } = defineProps<{
  post: { title: string; description: string; excerpt: string; date: string; readingTime: number; stem: string };
  showAuthor?: boolean;
  // タイトルと日付を移動させず、ページ全体のフェードだけで遷移する
  plain?: boolean;
}>();
</script>

<template>
  <article>
    <p v-if="$slots.meta" class="post-label"><slot name="meta" /></p>
    <p class="post-meta">
      <time :datetime="post.date" :style="!plain && { '--vt': transitionName(post.stem, 'date') }">{{
        post.date
      }}</time>
      <ReadingTime :minutes="post.readingTime" />
    </p>
    <h2>
      <NuxtLink :to="postPath(post.stem)" :style="!plain && { '--vt': transitionName(post.stem, 'title') }">{{
        post.title
      }}</NuxtLink>
    </h2>
    <p>{{ post.description || post.excerpt }}</p>
    <AuthorLink v-if="showAuthor" :author-id="post.stem.split('/')[0]!" />
  </article>
</template>
