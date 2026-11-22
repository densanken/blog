// 固定ヘッダーの高さ（CSS の `--header-height`）
// 見出しの位置の判定などに使う
export const headerHeight = () =>
  Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 72;
