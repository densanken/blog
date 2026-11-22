<script setup lang="ts">
if (import.meta.prerender) {
  const authors = await queryCollection("authors").select("stem").all();
  prerenderRoutes(
    authors.flatMap(({ stem }) => {
      const id = stem.split("/")[0]!;
      return [authorPath(id), `/api/author/${encodeURIComponent(id)}`];
    })
  );
}
</script>

<template>
  <PostIndex :page="1" />
</template>
