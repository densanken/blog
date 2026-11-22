<script setup lang="ts">
// `/@<著者ID>/page/1` は `/@<著者ID>` と重複するため、2ページ目以降だけを受け付ける
// 著者ディレクトリの `page/` の下の記事は、このルートと衝突するため、ビルドの対象から外している（content.config.ts）
const route = useRoute();
const raw = String(route.params.page);
const page = Number(raw);
if (!/^[1-9]\d*$/.test(raw) || page < 2) {
  throw createError({ status: 404, statusText: "Page not found", fatal: true });
}
</script>

<template>
  <AuthorIndex :author-id="route.params.author as string" :page="page" />
</template>
