<script setup lang="ts">
import { GraduationCap, Link } from "@lucide/vue";
import { siGithub, siX } from "simple-icons";

const { authorId, as = "h2" } = defineProps<{ authorId: string; as?: "h1" | "h2" }>();
const author = await useAuthor(authorId);
// x と twitter が両方ある場合は x を使う
const x = author.x ?? author.twitter;
// `www.` を除いたホスト名で表示する
const website = author.website && {
  href: author.website,
  host: (author.websiteHost ?? new URL(author.website).hostname).replace(/^www\./, ""),
};
</script>

<template>
  <div class="author-profile">
    <img v-if="author.icon" :src="authorIconUrl(author.icon, 240)" alt="" width="120" height="120" />
    <div>
      <component :is="as" class="author-name">
        <NuxtLink :to="authorPath(authorId)">{{ author.name }}</NuxtLink>
      </component>
      <p v-if="author.bio">{{ author.bio }}</p>
      <p v-if="author.admissionYear" class="post-author icon-text">
        <GraduationCap :size="16" aria-hidden="true" />({{ author.admissionYear }})
      </p>
      <p class="profile-links">
        <a v-if="author.github" :href="`https://github.com/${author.github}`" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
            <path :d="siGithub.path" />
          </svg>
          {{ author.github }}
        </a>
        <a v-if="x" :href="`https://x.com/${x}`" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
            <path :d="siX.path" />
          </svg>
          @{{ x }}
        </a>
        <a v-if="website" :href="website.href" :title="author.websiteAscii" target="_blank" rel="noopener noreferrer">
          <Link :size="20" aria-hidden="true" />
          {{ website.host }}
          <strong v-if="author.websiteWarning">⚠ 接続先に注意</strong>
        </a>
      </p>
    </div>
  </div>
</template>
