<script setup lang="ts">
// 連続するコードブロックを、タブで切り替える（rehype-code-group が、`tab` を付けたコードブロックをまとめる）
// タブの名前は、各コードブロックのファイル名（`[npm]`）で、なければ言語名になる
// スロットは描画の中で評価する（setup で一度だけ呼ぶと、Vue が依存関係を追跡できないと警告する）
provide("codeGroup", true);
const slots = useSlots();
const panels = computed(() => (slots.default?.() ?? []).filter((vnode) => vnode.props));
const labels = computed(() =>
  panels.value.map(
    ({ props }) => (props as Record<string, string>).filename ?? (props as Record<string, string>).language ?? ""
  )
);
const id = useId();
</script>

<template>
  <div class="code-group">
    <div role="tablist" class="code-tabs" aria-label="コードの切り替え">
      <button
        v-for="(label, index) in labels"
        :id="`${id}-tab-${index}`"
        :key="index"
        type="button"
        role="tab"
        :aria-selected="index === 0"
        :aria-controls="`${id}-panel-${index}`"
        :tabindex="index === 0 ? 0 : -1"
        :title="label"
      >
        {{ label }}
      </button>
    </div>
    <div
      v-for="(panel, index) in panels"
      :id="`${id}-panel-${index}`"
      :key="index"
      role="tabpanel"
      :aria-labelledby="`${id}-tab-${index}`"
      :hidden="index !== 0"
    >
      <component :is="panel" />
    </div>
  </div>
</template>
