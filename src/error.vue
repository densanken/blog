<script setup lang="ts">
import type { NuxtError } from "#app";

defineProps<{ error: NuxtError }>();
</script>

<template>
  <SiteLayout>
    <section class="error-page">
      <p class="eyebrow">{{ error.status }}</p>
      <h1>{{ error.status === 404 ? "ページが見つかりません" : "ページを表示できませんでした" }}</h1>
      <a href="/">記事一覧へ戻る</a>
    </section>
  </SiteLayout>
</template>
