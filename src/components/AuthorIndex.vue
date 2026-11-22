<script setup lang="ts">
const { authorId, page } = defineProps<{ authorId: string; page: number }>();
const author = await useAuthor(authorId);
const { posts, pageCount } = await usePostPage(page, authorId, author.pinnedStems);

const suffix = page > 1 ? `（${String(page)}ページ目）` : "";
const description = `${author.bio ?? `${author.name} の記事一覧です。`}${suffix}`;
useSeoMeta({ title: `${author.name}${suffix}`, description, ogDescription: description });
defineOgImage("Author", {
  author: author.name,
  authorId,
  icon: author.icon,
});
</script>

<template>
  <section>
    <BreadcrumbNav :items="[{ label: 'ホーム', to: '/' }, { label: author.name }]" />
    <AuthorProfile :author-id="authorId" as="h1" class="page-heading" />
    <SuggestedPosts v-if="page === 1" :author-id="authorId" />
    <ul v-if="posts.length" class="post-list">
      <li v-for="post in posts" :key="post.stem">
        <PostListItem :post="post" />
      </li>
    </ul>
    <p v-else-if="!author.pinnedStems.length">記事はまだありません。</p>
    <PaginationNav :page="page" :page-count="pageCount" :base="authorPath(authorId)" />
  </section>
</template>
