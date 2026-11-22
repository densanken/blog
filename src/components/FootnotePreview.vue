<script setup lang="ts">
// 脚注の参照（`[^1]`）にマウスを重ねるかフォーカスすると、脚注の内容をポップオーバーで表示する
// 記事の末尾にある脚注の一覧から内容を複製するため、リンクによる移動はそのまま使える（タッチ操作では、タップで移動する）
const tip = useTemplateRef<HTMLElement>("tip");
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let activeReference: HTMLElement | undefined;
let previousDescription: string | null = null;

const restoreDescription = () => {
  if (!activeReference) return;
  if (previousDescription === null) activeReference.removeAttribute("aria-describedby");
  else activeReference.setAttribute("aria-describedby", previousDescription);
  activeReference = undefined;
};

onBeforeUnmount(() => {
  clearTimeout(hideTimer);
  restoreDescription();
});

const keep = () => {
  clearTimeout(hideTimer);
};

const show = (reference: HTMLElement) => {
  keep();
  const note = document.getElementById(reference.getAttribute("href")!.slice(1));
  if (!note) return;
  const content = note.cloneNode(true) as HTMLElement;
  content.querySelector("[data-footnote-backref]")?.remove();
  tip.value!.replaceChildren(...content.childNodes);
  tip.value!.hidden = false;
  const rect = reference.getBoundingClientRect();
  const { offsetWidth, offsetHeight } = tip.value!;
  // 参照の下に置き、画面の下に収まらなければ、参照の上に置く（画面より高い脚注は、CSS の max-height で、内部をスクロールする）
  const below = rect.bottom + 6;
  const top = below + offsetHeight + 8 <= window.innerHeight ? below : Math.max(8, rect.top - 6 - offsetHeight);
  tip.value!.style.top = `${String(top)}px`;
  tip.value!.style.left = `${String(Math.max(8, Math.min(rect.left, window.innerWidth - offsetWidth - 8)))}px`;
  restoreDescription();
  activeReference = reference;
  previousDescription = reference.getAttribute("aria-describedby");
  reference.setAttribute("aria-describedby", [previousDescription, tip.value!.id].filter(Boolean).join(" "));
};

const hide = () => {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    tip.value!.hidden = true;
    restoreDescription();
  }, 150);
};

const reference = (event: Event) => (event.target as Element).closest<HTMLElement>("a[data-footnote-ref]");
const onEnter = (event: Event) => {
  const target = reference(event);
  if (target && (event.type === "focusin" || (event as PointerEvent).pointerType === "mouse")) show(target);
};

const onLeave = (event: Event) => {
  if (reference(event)) hide();
};

const onKey = ({ key }: KeyboardEvent) => {
  if (key === "Escape") {
    tip.value!.hidden = true;
    restoreDescription();
  }
};

onMounted(() => {
  document.addEventListener("pointerover", onEnter);
  document.addEventListener("pointerout", onLeave);
  document.addEventListener("focusin", onEnter);
  document.addEventListener("focusout", onLeave);
  document.addEventListener("keydown", onKey);
  document.addEventListener("scroll", hide, { passive: true });
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerover", onEnter);
  document.removeEventListener("pointerout", onLeave);
  document.removeEventListener("focusin", onEnter);
  document.removeEventListener("focusout", onLeave);
  document.removeEventListener("keydown", onKey);
  document.removeEventListener("scroll", hide);
});
</script>

<template>
  <div
    id="footnote-tip"
    ref="tip"
    class="footnote-tip"
    role="tooltip"
    hidden
    @pointerenter="keep"
    @pointerleave="hide"
  ></div>
</template>
