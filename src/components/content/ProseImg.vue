<script setup lang="ts">
const {
  src = "",
  alt = "",
  width = null,
  height = null,
  srcset = null,
  dataZoomSrc = null,
} = defineProps<{
  src?: string;
  alt?: string;
  width?: string | number | null;
  height?: string | number | null;
  srcset?: string | null;
  dataZoomSrc?: string | null;
}>();
const displayWidth = Math.min(Number(width) || 800, 800);
const displayHeight = width && height ? Math.round((displayWidth * Number(height)) / Number(width)) : undefined;
</script>

<template>
  <img
    :src="src"
    :srcset="srcset ?? undefined"
    :data-zoom-src="dataZoomSrc"
    :alt="alt"
    :width="displayWidth"
    :height="displayHeight"
    loading="lazy"
  />
</template>
