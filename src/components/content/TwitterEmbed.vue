<script setup lang="ts">
const { url } = defineProps<{ url: string }>();
</script>

<template>
  <div class="twitter-embed">
    <blockquote>
      <a :href="url">{{ url }}</a>
    </blockquote>
  </div>
</template>
