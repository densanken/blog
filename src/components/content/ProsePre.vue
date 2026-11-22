<script setup lang="ts">
import { Check, Copy, MoveHorizontal, WrapText } from "@lucide/vue";
import { siGithub } from "simple-icons";

// MDC 既定の ProsePre を置き換え、ファイル名、コピーボタン、行番号を表示する
// meta の `showLineNumbers` または `showLineNumbers=開始行` で行番号を表示し、`href=URL` でファイル名をリンクにする
defineOptions({ inheritAttrs: false });
const {
  code,
  filename = null,
  meta = null,
  class: className = null,
  markdownPreview,
  markdownDefault,
  filenameUrlHost = null,
  filenameUrlAscii = null,
  filenameUrlWarning,
  githubEmbed,
} = defineProps<{
  code: string;
  filename?: string | null;
  meta?: string | null;
  class?: string | null;
  // eslint-disable-next-line vue/require-default-prop
  markdownPreview?: string;
  markdownDefault?: boolean;
  filenameUrlHost?: string | null;
  filenameUrlAscii?: string | null;
  filenameUrlWarning?: boolean;
  githubEmbed?: boolean;
}>();

const inCodeGroup = inject("codeGroup", false);
const lineNumbers = meta?.match(/\bshowLineNumbers(?:=(\d+))?/);
// https の URL だけをリンクにする（javascript: などを防ぐ）
const href = meta?.match(/\bhref=(https:\/\/\S+)/)?.[1];
const rendered = markdownPreview !== undefined && markdownDefault;
const id = useId();
</script>

<template>
  <div class="code-block" :data-code="code">
    <div v-if="filename && markdownPreview === undefined" class="code-filename" :title="filename">
      <svg
        v-if="githubEmbed"
        class="github-embed-icon"
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        fill="currentColor"
        aria-hidden="true"
      >
        <path :d="siGithub.path" />
      </svg>
      <a v-if="href" :href="href" target="_blank" rel="noopener noreferrer"
        ><span class="code-filename-text">{{ filename }}</span
        ><span v-if="filenameUrlHost" class="url-host" :title="filenameUrlAscii ?? undefined">
          ({{ filenameUrlHost }})</span
        ><strong v-if="filenameUrlWarning" class="url-warning"> ⚠ 接続先に注意</strong></a
      >
      <span v-else class="code-filename-text">{{ filename }}</span>
    </div>
    <div v-if="markdownPreview !== undefined" class="code-preview-bar">
      <span v-if="filename && (!inCodeGroup || href)" class="code-preview-filename" :title="filename">
        <svg
          v-if="githubEmbed"
          class="github-embed-icon"
          viewBox="0 0 24 24"
          width="1em"
          height="1em"
          fill="currentColor"
          aria-hidden="true"
        >
          <path :d="siGithub.path" />
        </svg>
        <a v-if="href" :href="href" target="_blank" rel="noopener noreferrer"
          ><span class="code-filename-text">{{ filename }}</span
          ><span v-if="filenameUrlHost" class="url-host" :title="filenameUrlAscii ?? undefined">
            ({{ filenameUrlHost }})</span
          ><strong v-if="filenameUrlWarning" class="url-warning"> ⚠ 接続先に注意</strong></a
        >
        <span v-else class="code-filename-text">{{ filename }}</span>
      </span>
      <div role="tablist" class="code-tabs code-preview-tabs" aria-label="Markdown の表示切り替え">
        <button
          :id="`${id}-raw-tab`"
          type="button"
          role="tab"
          :aria-selected="!rendered"
          :aria-controls="`${id}-raw`"
          :tabindex="rendered ? -1 : 0"
        >
          Markdown
        </button>
        <button
          :id="`${id}-preview-tab`"
          type="button"
          role="tab"
          :aria-selected="!!rendered"
          :aria-controls="`${id}-preview`"
          :tabindex="rendered ? 0 : -1"
        >
          プレビュー
        </button>
      </div>
    </div>
    <div class="code-body">
      <button v-show="!rendered" type="button" class="code-wrap" aria-pressed="false" aria-label="コードを折り返す">
        <MoveHorizontal v-show="false" :size="16" aria-hidden="true" />
        <WrapText :size="16" aria-hidden="true" />
      </button>
      <button type="button" class="code-copy" aria-label="コードをコピー">
        <Check v-show="false" :size="16" aria-hidden="true" />
        <Copy :size="16" aria-hidden="true" />
      </button>
      <pre
        :id="markdownPreview !== undefined ? `${id}-raw` : undefined"
        :role="markdownPreview !== undefined ? 'tabpanel' : undefined"
        :tabindex="markdownPreview !== undefined ? 0 : undefined"
        :aria-labelledby="markdownPreview !== undefined ? `${id}-raw-tab` : undefined"
        :hidden="rendered"
        :class="[className, { 'line-numbers': lineNumbers }]"
        :style="lineNumbers && { counterReset: `line ${Number(lineNumbers[1] ?? 1) - 1}` }"
      ><slot /></pre>
      <!-- プレビューはビルド時に sanitize 済み -->
      <!-- eslint-disable vue/no-v-html -->
      <div
        v-if="markdownPreview !== undefined"
        :id="`${id}-preview`"
        role="tabpanel"
        tabindex="0"
        :aria-labelledby="`${id}-preview-tab`"
        :hidden="!rendered"
        class="markdown-preview"
        v-html="markdownPreview"
      />
      <!-- eslint-enable vue/no-v-html -->
    </div>
  </div>
</template>
