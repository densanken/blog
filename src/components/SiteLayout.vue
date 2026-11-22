<script setup lang="ts">
// 記事の見出しが画面から外れたら、記事のタイトルと著者をヘッダーに表示する（記事のページが設定する）
const article = useState<{ title: string; authorId: string; authorName: string; authorIcon?: string } | undefined>(
  "header-article"
);
const scripts = analyticsScripts(useRuntimeConfig().public.googleAnalyticsId);
if (scripts.length) useHead({ script: scripts });
const toTop = () => {
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
};
</script>

<template>
  <header class="site-header">
    <div class="site-header-inner">
      <div class="header-brand">
        <NuxtLink to="/" class="site-title" :class="{ 'is-sub': article }">
          <img
            src="/ccsko-32.webp"
            srcset="/ccsko-32.webp 1x, /ccsko-64.webp 2x, /ccsko-96.webp 3x"
            alt=""
            width="32"
            height="32"
            loading="eager"
          />
          CCSブログ
        </NuxtLink>
        <div v-if="article" class="header-article">
          <button type="button" class="article-title" :title="article.title" @click="toTop">
            {{ article.title }}
          </button>
          <NuxtLink :to="authorPath(article.authorId)" class="header-author">
            <img v-if="article.authorIcon" :src="authorIconUrl(article.authorIcon)" alt="" width="16" height="16" />
            <span>{{ article.authorName }}</span>
          </NuxtLink>
        </div>
      </div>
      <div class="site-tools">
        <SearchDialog />
        <ThemeToggle />
      </div>
    </div>
  </header>
  <div class="site-shell">
    <main id="main"><slot /></main>
    <footer class="site-footer">
      <SiteIntro />
      <div class="footer-links">
        <a href="https://densanken.com" target="_blank" rel="noopener noreferrer">千葉大学電子計算機研究会</a>
        <NuxtLink to="/privacy/">プライバシーポリシー</NuxtLink>
        <a href="/feed.xml">フィード</a>
      </div>
    </footer>
  </div>
</template>
