<script setup lang="ts">
// `/page/1` は `/` と重複するため、2ページ目以降だけを受け付ける
const raw = String(useRoute().params.page);
const page = Number(raw);
if (!/^[1-9]\d*$/.test(raw) || page < 2) {
  throw createError({ status: 404, statusText: "Page not found", fatal: true });
}
</script>

<template>
  <PostIndex :page="page" />
</template>
