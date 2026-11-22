<script setup lang="ts">
// MDC 既定の ProseA は、すべてのリンクを NuxtLink にする
// `#` のリンクや href のない a まで、ページデータの先読みの対象になり、クリック時に NUXT_E7001 のエラーになるため、サイト内のページへのリンクだけを NuxtLink にする
const { href = "", target = null } = defineProps<{ href?: string; target?: string | null }>();
</script>

<template>
  <NuxtLink v-if="/^\/(?!\/)/.test(href)" :href="href" :target="target ?? undefined">
    <slot />
  </NuxtLink>
  <a v-else :href="href || undefined" :target="target ?? undefined">
    <slot />
  </a>
</template>
