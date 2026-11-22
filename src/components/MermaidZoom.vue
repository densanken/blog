<script setup lang="ts">
import { RotateCcw, X, ZoomIn, ZoomOut } from "@lucide/vue";

import type { PanzoomObject } from "@panzoom/panzoom";

const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const stage = useTemplateRef<HTMLElement>("stage");
const zooms = new Map<HTMLElement, PanzoomObject>();
let dialogZoom: PanzoomObject | undefined;
let panzoom: typeof import("@panzoom/panzoom").default;
let disposed = false;
let ready: Promise<void>;

const operate = (zoom: PanzoomObject, action: string) => {
  if (action === "zoom-in") zoom.zoomIn();
  else if (action === "zoom-out") zoom.zoomOut();
  else zoom.reset();
};

// 図ごとのボタン（ビルド時に埋め込み済み）を、拡大縮小の操作とダイアログの表示に結び付ける
const onClick = ({ target }: MouseEvent) => {
  const button = (target as Element).closest<HTMLElement>(".mermaid [data-action]");
  if (!button) return;
  void ready.then(() => {
    if (disposed) return;
    const canvas = button.closest(".mermaid")!.querySelector<HTMLElement>(".mermaid-canvas")!;
    if (button.dataset.action === "fullscreen") {
      if (dialog.value!.open) return;
      const copy = canvas.cloneNode(true) as HTMLElement;
      copy.removeAttribute("style");
      copy.querySelector("svg")!.removeAttribute("style");
      stage.value!.replaceChildren(copy);
      dialogZoom = panzoom(copy, { maxScale: 20 });
      dialog.value!.showModal();
    } else {
      operate(zooms.get(canvas)!, button.dataset.action!);
    }
  });
};

// 通常のスクロールを妨げないよう、ホイールは Ctrl または Command を押したときだけ拡大縮小に使う
const onWheel = (zoom: PanzoomObject, event: WheelEvent) => {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    zoom.zoomWithWheel(event);
  }
};

const initialize = async () => {
  const figures = document.querySelectorAll(".mermaid");
  if (!figures.length) return;
  panzoom = (await import("@panzoom/panzoom")).default;
  if (disposed) return;
  for (const figure of figures) {
    const canvas = figure.querySelector<HTMLElement>(".mermaid-canvas")!;
    const zoom = panzoom(canvas, { maxScale: 20, touchAction: "pan-y" });
    zooms.set(canvas, zoom);
    figure.addEventListener(
      "wheel",
      (event) => {
        onWheel(zoom, event as WheelEvent);
      },
      { passive: false }
    );
  }
};

onMounted(() => {
  ready = initialize();
  document.addEventListener("click", onClick);
});

onBeforeUnmount(() => {
  disposed = true;
  document.removeEventListener("click", onClick);
  dialogZoom?.destroy();
  for (const zoom of zooms.values()) {
    zoom.destroy();
  }
});
</script>

<template>
  <dialog
    ref="dialog"
    class="mermaid-dialog"
    @close="
      dialogZoom?.destroy();
      dialogZoom = undefined;
    "
  >
    <div class="mermaid-toolbar">
      <button type="button" aria-label="拡大" @click="dialogZoom?.zoomIn()"><ZoomIn :size="18" /></button>
      <button type="button" aria-label="縮小" @click="dialogZoom?.zoomOut()"><ZoomOut :size="18" /></button>
      <button type="button" aria-label="元の大きさに戻す" @click="dialogZoom?.reset()"><RotateCcw :size="18" /></button>
      <button type="button" aria-label="閉じる" @click="dialog?.close()"><X :size="18" /></button>
    </div>
    <div ref="stage" class="mermaid-stage" @wheel.prevent="dialogZoom?.zoomWithWheel($event)"></div>
  </dialog>
</template>
