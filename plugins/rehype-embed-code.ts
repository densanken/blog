import { h } from "hastscript";

import { iframeSrc } from "./embeds/code.ts";
import { invalidPublishedSlides } from "./embeds/google-slides.ts";
import { embeds } from "./embeds/index.ts";
import { invalidTwitterRanges } from "./remark-embed-blockquote.ts";
import { defect } from "./warn.ts";

import type { Element, Root, RootContent } from "hast";
import type { VFile } from "vfile";

// 各サービスの「埋め込み」メニューでコピーしたコード（iframe、script、ラッパーの div、説明リンク）を、リンクだけの段落（`<p><a href=URL>URL</a></p>`）に置き換える
// 後段の rehype-embed が、URL を貼った場合と同じ埋め込みにする
// 作者の HTML の属性は、URL と縦横比を取り出す以外に使わない
// どのサービスの形にも当てはまらない iframe と script は、そのまま残り、続く rehype-sanitize が取り除く
// このプラグインは rehype-sanitize より前に置く

const isBlank = (node: RootContent) => node.type === "text" && !node.value.trim();

const convert = (children: RootContent[], file: VFile, position?: RootContent["position"]): RootContent[] => {
  const result: RootContent[] = [];
  for (let index = 0; index < children.length;) {
    const node = children[index];
    const nodePosition = node?.position ?? position;
    // rehype-raw が生成した位置には end がない場合がある
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const start = nodePosition?.start?.offset;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const end = nodePosition?.end?.offset ?? (start === undefined ? undefined : start + 1);
    const suppressed =
      start !== undefined &&
      end !== undefined &&
      invalidTwitterRanges.get(file)?.some(([from, to]) => start < to && end > from);
    const found = suppressed
      ? undefined
      : embeds.map(({ fromEmbedCode }) => fromEmbedCode(children, index)).find(Boolean);
    const src = iframeSrc(node);
    const srcUrl = src ? URL.parse(src) : null;
    if (srcUrl && invalidPublishedSlides(srcUrl)) {
      defect("Google スライドの公開 ID が不正です", file.path);
    }
    if (found) {
      const url = new URL(found.url);
      const text = `${url.origin}${url.pathname}${url.search}`;
      const paragraph = h("p", [h("a", { href: found.url }, text)]);
      paragraph.position = node?.position ?? position;
      result.push(paragraph);
      index += found.length;
      continue;
    }
    index++;
    if (node?.type !== "element") {
      if (node) result.push(node);
      continue;
    }
    node.children = convert(node.children, file, node.position ?? position) as Element["children"];
    // 段落の中の埋め込みコードだけの段落は、段落を入れ子にしない
    const [only, ...rest] = node.children.filter((child) => !isBlank(child));
    result.push(
      node.tagName === "p" && rest.length === 0 && only?.type === "element" && only.tagName === "p" ? only : node
    );
  }
  return result;
};

export default () => (tree: Root, file: VFile) => {
  tree.children = convert(tree.children, file);
};
