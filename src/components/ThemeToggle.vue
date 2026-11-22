<script setup lang="ts">
import { Check, Monitor, Moon, Sun } from "@lucide/vue";

// 現在のテーマのアイコンのボタンから、システム、ライト、ダークを選ぶメニューを開く（設定は localStorage に保存される）
// メニューは popover 属性で作るため、外側のクリックと Escape で閉じ、閉じたときにボタンへフォーカスが戻る
const colorMode = useColorMode();
const modes = [
  { value: "system", label: "システム", icon: Monitor },
  { value: "light", label: "ライト", icon: Sun },
  { value: "dark", label: "ダーク", icon: Moon },
] as const;

const button = useTemplateRef<HTMLButtonElement>("button");
const menu = useTemplateRef<HTMLElement>("menu");
const current = computed(() => modes.find(({ value }) => value === colorMode.preference) ?? modes[0]);

// ボタンの下に、右端をそろえてメニューを表示し、現在の項目にフォーカスする
const onToggle = (event: Event) => {
  const opened = (event as ToggleEvent).newState === "open";
  button.value!.setAttribute("aria-expanded", String(opened));
  if (!opened) return;
  const { bottom, right } = button.value!.getBoundingClientRect();
  menu.value!.style.top = `${String(bottom + 4)}px`;
  menu.value!.style.right = `${String(window.innerWidth - right)}px`;
  menu.value!.querySelector<HTMLElement>("[aria-checked='true']")?.focus();
};

const select = (value: (typeof modes)[number]["value"]) => {
  colorMode.preference = value;
  menu.value!.hidePopover();
};

// 上下の矢印キーと Home、End で、項目を移動する
const onKeydown = (event: KeyboardEvent) => {
  // Tab と Shift+Tab は、項目の間を移動せず、メニューを閉じて、外へ移動する（フォーカスは、メニューを開いたボタンに戻り、そこから進む）
  if (event.key === "Tab") {
    menu.value!.hidePopover();
    return;
  }
  const items = [...menu.value!.querySelectorAll<HTMLElement>("[role='menuitemradio']")];
  const index = items.indexOf(document.activeElement as HTMLElement);
  const target = {
    ArrowDown: (index + 1) % items.length,
    ArrowUp: (index + items.length - 1) % items.length,
    Home: 0,
    End: items.length - 1,
  }[event.key];
  if (target === undefined) return;
  event.preventDefault();
  items[target]!.focus();
};
</script>

<template>
  <button
    ref="button"
    type="button"
    class="icon-button"
    popovertarget="theme-menu"
    title="テーマの切り替え"
    aria-haspopup="menu"
    aria-expanded="false"
    :aria-label="`テーマの切り替え（現在: ${current.label}）`"
  >
    <ClientOnly>
      <component :is="current.icon" :size="20" aria-hidden="true" />
      <template #fallback><Monitor :size="20" aria-hidden="true" /></template>
    </ClientOnly>
  </button>
  <div
    id="theme-menu"
    ref="menu"
    popover
    class="menu"
    role="menu"
    aria-label="テーマ"
    @toggle="onToggle"
    @keydown="onKeydown"
  >
    <button
      v-for="mode in modes"
      :key="mode.value"
      type="button"
      role="menuitemradio"
      :aria-checked="mode.value === current.value"
      @click="select(mode.value)"
    >
      <component :is="mode.icon" :size="16" aria-hidden="true" />
      {{ mode.label }}
      <Check v-if="mode.value === current.value" :size="16" aria-hidden="true" class="menu-check" />
    </button>
  </div>
</template>
