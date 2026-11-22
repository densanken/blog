<script setup lang="ts">
import { ArrowRight, Pin } from "@lucide/vue";

const { authorId, current = "" } = defineProps<{ authorId: string; current?: string }>();
const author = await useAuthor(authorId);
const candidates = author.pinnedStems.length
  ? await queryCollection("posts")
      .select("title", "description", "excerpt", "date", "stem", "readingTime")
      .where("stem", "IN", author.pinnedStems)
      .all()
  : [];
const pinned = author.pinnedStems.flatMap((stem) => candidates.filter((post) => post.stem === stem));
const recent = current
  ? await queryCollection("posts")
      .select("title", "description", "excerpt", "date", "stem", "readingTime")
      .where("stem", ">=", authorRange(authorId)[0])
      .where("stem", "<", authorRange(authorId)[1])
      .where("stem", "<>", current)
      .order("date", "DESC")
      .order("stem", "ASC")
      .limit(relatedPostsLimit)
      .all()
  : [];
const posts = current ? selectRelatedPosts(pinned, recent, current) : pinned;
const pinnedStems = new Set(author.pinnedStems);
</script>

<template>
  <section v-if="posts.length" class="suggested-posts" :class="current && 'related-posts'">
    <div v-if="current" class="related-heading">
      <h2>{{ author?.name }} の他の記事</h2>
      <NuxtLink to="/">記事一覧 <ArrowRight :size="16" aria-hidden="true" /></NuxtLink>
    </div>
    <ul class="post-list">
      <li v-for="post in posts" :key="post.stem">
        <PostListItem :post="post" plain>
          <template v-if="pinnedStems.has(post.stem)" #meta>
            <span class="icon-text" data-pagefind-ignore><Pin :size="16" aria-hidden="true" />ピン留め</span>
          </template>
        </PostListItem>
      </li>
    </ul>
  </section>
</template>
