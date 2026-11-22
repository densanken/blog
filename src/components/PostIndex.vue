<script setup lang="ts">
const { page } = defineProps<{ page: number }>();
const description = String(useSiteConfig().description);

const { posts, pageCount } = await usePostPage(page);

const suffix = page > 1 ? `（${String(page)}ページ目）` : "";
useSeoMeta({
  title: `記事一覧${suffix}`,
  description: `${description}${suffix}`,
  ogDescription: `${description}${suffix}`,
});

defineOgImage("Site", { title: "CCSブログ", description });
</script>

<template>
  <section>
    <div class="page-heading">
      <SiteIntro />
    </div>
    <ul v-if="posts.length" class="post-list">
      <li v-for="post in posts" :key="post.stem">
        <PostListItem :post="post" show-author />
      </li>
    </ul>
    <p v-else>記事はまだありません。</p>
    <PaginationNav :page="page" :page-count="pageCount" />
  </section>
</template>
