<script setup lang="ts">
import { Clock } from "@lucide/vue";

defineProps<{ minutes: number }>();
</script>

<template>
  <span class="icon-text"><Clock :size="16" aria-hidden="true" />約 {{ minutes }} 分で読めます</span>
</template>
