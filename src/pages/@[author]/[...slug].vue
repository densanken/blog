<script setup lang="ts">
import { CalendarSync, SquarePen } from "@lucide/vue";
import mediumZoom from "medium-zoom";

import { authorsDirectory } from "../../../plugins/content-paths";

import type { Zoom } from "medium-zoom";

const contentsRepository = "https://github.com/densanken/blog-contents";
// GFM の脚注が生成する、読み上げ専用の見出しは、目次に入れない
const footnoteLabelId = "user-content-footnote-label";
const route = useRoute();
const authorId = route.params.author as string;
const stem = `${authorId}/${(route.params.slug as string[]).filter(Boolean).join("/")}`;
const requestFetch = useRequestFetch();
const { data: result, error } = await useAsyncData(`post-${stem}`, () =>
  requestFetch("/api/post-meta", { query: { stem } })
);

if (error.value) {
  throw createError({ status: 500, statusText: "Failed to load post", fatal: true });
}
if (!result.value?.post) {
  throw createError({ status: 404, statusText: "Post not found", fatal: true });
}
const post = computed(() => result.value!.post!);
usePostBodyInteractions();
const author = await useAuthor(authorId);

const tocLinks = post.value.toc?.links.filter(({ id }) => id !== footnoteLabelId) ?? [];

// 記事の更新日があれば、更新日を最終更新として使う
const { url } = useSiteConfig();
const description = post.value.description || post.value.excerpt || "";
const modified = post.value.updated ?? post.value.date;
useSeoMeta({
  title: post.value.title,
  description,
  ogTitle: post.value.title,
  ogDescription: description,
  ogType: "article",
  articlePublishedTime: post.value.date,
  articleModifiedTime: modified,
});

useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: post.value.title,
        description,
        datePublished: post.value.date,
        dateModified: modified,
        author: { "@type": "Person", name: author.name, url: `${url}${authorPath(authorId)}` },
        mainEntityOfPage: `${url}${postPath(stem)}`,
      },
    },
  ],
});

defineOgImage("Post", {
  title: post.value.title,
  author: author.name,
  authorId,
  icon: author.icon,
});

// 記事内の画像をクリックで拡大する（リンクとリンクカードの画像は除く）
let zoom: Zoom | undefined;
onMounted(() => {
  zoom = mediumZoom(".prose img:not(a img, .link-card img)", { background: "var(--color-bg)" });
});

// タイトル（h1）が画面の上に外れたら、ヘッダーに記事のタイトルと著者を表示する
const headerArticle = useState("header-article");
let titleObserver: IntersectionObserver | undefined;
onMounted(() => {
  titleObserver = new IntersectionObserver(
    ([entry]) => {
      headerArticle.value =
        entry && !entry.isIntersecting && entry.boundingClientRect.top < 0
          ? { title: post.value.title, authorId, authorName: author.name, authorIcon: author.icon }
          : undefined;
    },
    { rootMargin: `-${String(headerHeight())}px 0px 0px 0px` }
  );
  titleObserver.observe(document.querySelector(".post-main h1")!);
});

onBeforeUnmount(() => {
  zoom?.detach();
  titleObserver?.disconnect();
  headerArticle.value = undefined;
});
</script>

<template>
  <article v-if="post" class="post-layout">
    <div class="post-main">
      <BreadcrumbNav
        :items="[{ label: 'ホーム', to: '/' }, { label: author.name, to: authorPath(authorId) }, { label: post.title }]"
      />
      <header class="page-heading">
        <p class="post-meta">
          <time :datetime="post.date" :style="{ '--vt': transitionName(stem, 'date') }">{{ post.date }}</time>
          <span v-if="post.updated" class="icon-text" title="更新日">
            <CalendarSync :size="16" role="img" aria-label="更新日" />
            <time :datetime="post.updated">{{ post.updated }}</time>
          </span>
          <ReadingTime :minutes="post.readingTime" />
        </p>
        <h1 data-pagefind-meta="title" :style="{ '--vt': transitionName(stem, 'title') }">{{ post.title }}</h1>
        <!-- 検索結果に表示する日付と著者（Pagefind のインデックスに入る） -->
        <!-- 値は要素の内容から取るため、値の中の記号は解釈されない -->
        <span hidden data-pagefind-meta="date">{{ post.date }}</span>
        <span hidden data-pagefind-meta="author">{{ author.name }}</span>
        <span v-if="author.icon" hidden data-pagefind-meta="icon">{{ authorIconUrl(author.icon) }}</span>
        <AuthorLink :author-id="authorId" />
      </header>
      <PostBody :stem="stem" />
      <MermaidZoom />
      <FootnotePreview />
      <div class="post-actions">
        <p>この記事をシェアする</p>
        <div class="post-actions-row">
          <ShareButtons :title="post.title" :path="postPath(stem)" />
          <a
            :href="`${contentsRepository}/edit/main/${authorsDirectory}/${encodeStem(post.sourceStem)}.md`"
            target="_blank"
            rel="noopener noreferrer"
            class="button"
          >
            <SquarePen :size="16" aria-hidden="true" />
            GitHub で編集
          </a>
        </div>
      </div>
      <AuthorProfile :author-id="authorId" class="post-footer" />
      <SuggestedPosts :author-id="authorId" :current="stem" />
    </div>
    <aside class="post-aside" aria-label="共有と目次">
      <ShareButtons :title="post.title" :path="postPath(stem)" />
      <PostToc v-if="tocLinks.length" :links="tocLinks" />
      <ScrollTopButton />
    </aside>
    <FloatingActions :has-toc="tocLinks.length > 0" :title="post.title" :path="postPath(stem)" />
  </article>
</template>
