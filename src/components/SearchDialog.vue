<script setup lang="ts">
import { Search, X } from "@lucide/vue";

// 検索インデックスは、ビルド後は pagefind コマンドが `.output/public/pagefind/` に出力し、開発サーバーでは src/server/routes/pagefind/ がメモリ上に作る
interface PagefindData {
  url: string;
  excerpt: string;
  meta: { title: string; author?: string; icon?: string; date?: string };
  sub_results: { title: string; url: string; excerpt: string }[];
}
interface Pagefind {
  search: (query: string) => Promise<{ results: { data: () => Promise<PagefindData> }[] }>;
}
// 抜粋を、強調する部分としない部分に分けたもの
type Parts = { text: string; mark: boolean }[];
interface Link {
  url: string;
  title: string;
  parts: Parts;
}
interface Hit extends Link {
  author?: string;
  icon?: string;
  date?: string;
  subs: Link[];
}

const maxHits = 10;
const maxSubs = 3;
const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const input = useTemplateRef<HTMLInputElement>("input");
const list = useTemplateRef<HTMLElement>("list");
const query = ref("");
const hits = ref<Hit[]>([]);
const total = ref(0);
const status = ref<"idle" | "searching" | "missing" | "error">("idle");
// 結果の記事と見出しのリンクを順に並べたときの、選択中の位置（↑↓ で動かし、Enter で開く）
const active = ref(0);
const links = computed(() => hits.value.flatMap((hit) => [hit, ...hit.subs]));
// 型定義のない、ビルド後に生成されるファイルのため、変数で指定する
const pagefindUrl = "/pagefind/pagefind.js";
let pagefind: Pagefind | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

const open = () => {
  dialog.value!.showModal();
  input.value!.focus();
};

// Cmd + K（Windows と Linux は Ctrl + K）で検索を開く
const isMac = ref(false);
const onKeydown = (event: KeyboardEvent) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "k") {
    event.preventDefault();
    open();
  }
};
onMounted(() => {
  isMac.value = /Mac|iPhone|iPad/.test(navigator.userAgent);
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});

// Pagefind の抜粋は、HTML としてエスケープされた本文と `<mark>` だけからなる
// HTML として挿入せず、テキストと強調に分けて表示する
const toParts = (excerpt: string): Parts =>
  [...new DOMParser().parseFromString(excerpt, "text/html").body.childNodes].map((node) => ({
    text: node.textContent ?? "",
    mark: node.nodeName === "MARK",
  }));

const search = async () => {
  const text = query.value.trim();
  active.value = 0;
  if (!text) {
    hits.value = [];
    total.value = 0;
    status.value = "idle";
    return;
  }
  status.value = "searching";
  try {
    pagefind ??= (await import(/* @vite-ignore */ pagefindUrl)) as Pagefind;
  } catch {
    status.value = "missing";
    return;
  }
  let results;
  let data;
  try {
    ({ results } = await pagefind.search(text));
    data = await Promise.all(results.slice(0, maxHits).map((result) => result.data()));
  } catch {
    if (text === query.value.trim()) status.value = "error";
    return;
  }
  // 入力が変わっていたら、古い結果は捨てる
  if (text !== query.value.trim()) return;
  total.value = results.length;
  hits.value = data.map(({ url, meta, excerpt, sub_results }) => ({
    url,
    title: meta.title,
    parts: toParts(excerpt),
    author: meta.author,
    icon: meta.icon,
    date: meta.date,
    // 記事全体と同じ位置を指す見出し（先頭）は除く
    subs: sub_results
      .filter((sub) => sub.url !== url)
      .slice(0, maxSubs)
      .map((sub) => ({ url: sub.url, title: sub.title, parts: toParts(sub.excerpt) })),
  }));
  status.value = "idle";
};

// 入力が止まってから検索する
const onInput = () => {
  clearTimeout(timer);
  if (query.value.trim()) status.value = "searching";
  timer = setTimeout(() => void search(), 150);
};

const go = async (url: string) => {
  dialog.value?.close();
  await navigateTo(url);
};

const onInputKeydown = (event: KeyboardEvent) => {
  // 日本語の変換中の Enter と矢印キーは、変換の操作なので（Safari では isComposing が false になるため、key が Process のものも除く）、扱わない
  if (event.isComposing || event.key === "Process" || !links.value.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    active.value = (active.value + (event.key === "ArrowDown" ? 1 : -1) + links.value.length) % links.value.length;
    void nextTick(() => list.value?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" }));
  } else if (event.key === "Enter") {
    event.preventDefault();
    void go(links.value[active.value]!.url);
  }
};
</script>

<template>
  <button type="button" class="icon-button search-button" aria-label="記事を検索" title="記事を検索" @click="open">
    <Search :size="20" aria-hidden="true" />
    <kbd aria-hidden="true">{{ isMac ? "⌘K" : "Ctrl K" }}</kbd>
  </button>
  <dialog ref="dialog" class="search-dialog" aria-label="記事の検索" @click.self="dialog?.close()">
    <form method="dialog" class="search-form" @submit.prevent="search">
      <Search :size="20" aria-hidden="true" />
      <input
        ref="input"
        v-model="query"
        type="search"
        placeholder="記事を検索"
        aria-label="検索語"
        @input="onInput"
        @keydown="onInputKeydown"
      />
      <button type="button" class="icon-button" aria-label="閉じる" title="閉じる（Esc）" @click="dialog?.close()">
        <X :size="20" aria-hidden="true" />
      </button>
    </form>
    <div ref="list" class="search-body">
      <p v-if="status === 'missing'" class="search-status">検索を読み込めませんでした。</p>
      <p v-else-if="status === 'error'" class="search-status">検索に失敗しました。もう一度試してください。</p>
      <p v-else-if="status === 'searching'" class="search-status">検索しています…</p>
      <p v-else-if="!query.trim()" class="search-status">キーワードを入力すると、記事の本文から探します。</p>
      <p v-else-if="!hits.length" class="search-status">「{{ query.trim() }}」に一致する記事は見つかりませんでした。</p>
      <template v-else>
        <p class="search-status" aria-live="polite">{{ total }} 件の記事が見つかりました</p>
        <ul class="search-results">
          <li v-for="hit in hits" :key="hit.url">
            <a
              :href="hit.url"
              class="search-hit"
              :aria-current="links.indexOf(hit) === active || undefined"
              :data-active="links.indexOf(hit) === active || undefined"
              @click.prevent="go(hit.url)"
              @mousemove="active = links.indexOf(hit)"
            >
              <span class="search-hit-title">{{ hit.title }}</span>
              <span v-if="hit.author || hit.date" class="search-hit-meta">
                <template v-if="hit.author">
                  <img v-if="hit.icon" :src="hit.icon" alt="" width="16" height="16" />
                  {{ hit.author }}
                </template>
                <time v-if="hit.date" :datetime="hit.date">{{ hit.date }}</time>
              </span>
              <span class="search-hit-excerpt">
                <template v-for="(part, index) in hit.parts" :key="index">
                  <mark v-if="part.mark">{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
            </a>
            <ul v-if="hit.subs.length" class="search-subs" :aria-label="`${hit.title} の該当する見出し`">
              <li v-for="sub in hit.subs" :key="sub.url">
                <a
                  :href="sub.url"
                  class="search-hit"
                  :aria-current="links.indexOf(sub) === active || undefined"
                  :data-active="links.indexOf(sub) === active || undefined"
                  @click.prevent="go(sub.url)"
                  @mousemove="active = links.indexOf(sub)"
                >
                  <span class="search-hit-title">{{ sub.title }}</span>
                  <span class="search-hit-excerpt">
                    <template v-for="(part, index) in sub.parts" :key="index">
                      <mark v-if="part.mark">{{ part.text }}</mark>
                      <template v-else>{{ part.text }}</template>
                    </template>
                  </span>
                </a>
              </li>
            </ul>
          </li>
        </ul>
      </template>
    </div>
    <p class="search-hints" aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd> 移動</span>
      <span><kbd>Enter</kbd> 開く</span>
      <span><kbd>Esc</kbd> 閉じる</span>
    </p>
  </dialog>
</template>
