import { toString } from "hast-util-to-string";
import { h } from "hastscript";
import { visit } from "unist-util-visit";

import { embeds } from "./embeds/index.ts";
import { linkCard } from "./embeds/link-card.ts";
import { embeddedUrls, guardedEmbeds } from "./rehype-url-guard.ts";
import { invalidTwitterRanges, restoredQuoteStarts } from "./remark-embed-blockquote.ts";
import { siteUrl } from "./site.ts";
import { inspectUrl } from "./url-guard.ts";
import { defect, warn } from "./warn.ts";

import type { Root, RootContent } from "hast";
import type { VFile } from "vfile";

// 1つの記事で埋め込みにするリンクの上限（ビルド時の外部通信を抑える）
const maxEmbeds = 50;

// 対応するサービスがなければ、リンクカード
const embed = async (url: URL, owner: string, reserveFetch: () => void) => {
  if (url.hostname === "maps.app.goo.gl") return;
  for (const { fromUrl } of embeds) {
    const element = await fromUrl(url, reserveFetch);
    if (element) return element;
  }
  reserveFetch();
  return linkCard(url, owner);
};

class BudgetExceeded extends Error {}

// リンクだけの段落（URL、`<URL>`、`[テキスト](URL)`、`[テキスト][参照名]`）を、動画、投稿、スライド、コード、リンクカードに置き換える
// 文中にリンクを含む段落は、そのまま残して直後に埋め込みを追加する（本文直下と、`<details>` と引用の直下の段落だけ）
// 取得に失敗した場合は、置き換えも追加もしない
// 作者が書いた HTML は、このプラグインより前に sanitize 済みなので、ここで作る要素は信頼できる
export default () => async (tree: Root, file: VFile) => {
  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- rehype-raw が生成した位置には end がない場合がある */
  const tasks: Promise<void>[] = [];
  let budget = maxEmbeds;
  visit(tree, "element", (paragraph, _index, parent) => {
    if (
      !parent ||
      paragraph.tagName !== "p" ||
      invalidTwitterRanges
        .get(file)
        ?.some(
          ([start, end]) =>
            (paragraph.position?.start?.offset ?? Infinity) < end &&
            (paragraph.position?.end?.offset ?? (paragraph.position?.start?.offset ?? -2) + 1) > start
        ) ||
      !(
        parent.type === "root" ||
        ["details", "blockquote"].includes(parent.tagName) ||
        (restoredQuoteStarts.get(file)?.has(paragraph.position?.start?.offset ?? -1) ?? false)
      )
    )
      return;
    const hrefs = new Map<string, NonNullable<ReturnType<typeof inspectUrl>>>();
    visit(paragraph, "element", (node) => {
      const { tagName, properties } = node;
      if (tagName !== "a" || typeof properties.href !== "string") return;
      const url = URL.parse(properties.href, siteUrl);
      const info = inspectUrl(properties.href, toString(node));
      if (!url || url.origin === new URL(siteUrl).origin || !info) return;
      const previous = hrefs.get(url.href);
      if (previous) {
        info.idn ||= previous.idn;
        info.mixed ||= previous.mixed;
        info.mismatch ||= previous.mismatch;
        info.confusable ||= previous.confusable;
        if (info.mixed) info.display = info.ascii;
      }
      hrefs.set(url.href, info);
    });
    const content = paragraph.children.filter((child) => child.type !== "text" || child.value.trim());
    // リンクだけの段落は、テキストだけを含む 1 つのリンク（画像や強調を含むリンクは、リンクのまま残す）
    const [only] = content;
    const linkOnly =
      content.length === 1 &&
      hrefs.size === 1 &&
      only?.type === "element" &&
      only.tagName === "a" &&
      only.children.every(({ type }) => type === "text");
    if (!hrefs.size) return;
    const targets = [...hrefs.keys()];
    tasks.push(
      Promise.allSettled(
        targets.map((href) => {
          let reserved = false;
          return embed(new URL(href), file.path, () => {
            if (reserved) return;
            if (budget === 0) throw new BudgetExceeded();
            budget--;
            reserved = true;
          });
        })
      ).then((results) => {
        const cards = results.flatMap((result, i) => {
          if (result.status === "fulfilled") {
            if (!result.value) return [];
            const info = hrefs.get(targets[i]!);
            const showHost = info && (info.idn || info.mismatch || info.confusable);
            const element = showHost ? h("div", [result.value]) : result.value;
            if (showHost) {
              embeddedUrls.set(element, info);
              guardedEmbeds.add(result.value);
            }
            return [element];
          }
          if (result.reason instanceof BudgetExceeded) {
            defect(`${file.path} の埋め込みの上限を超えました: ${String(targets[i])}`, file.path);
            return [];
          }
          warn(`${file.path} 埋め込めませんでした: ${String(targets[i])}（${String(result.reason)}）`, file.path);
          return [];
        });
        const nodes: RootContent[] = linkOnly ? (cards.length ? cards : [paragraph]) : [paragraph, ...cards];
        if (parent.type === "root")
          parent.children = parent.children.flatMap((child) => (child === paragraph ? nodes : [child]));
        else
          parent.children = parent.children.flatMap((child) =>
            child === paragraph ? nodes.filter((node) => node.type !== "doctype") : [child]
          );
      })
    );
  });
  await Promise.all(tasks);
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */
};
