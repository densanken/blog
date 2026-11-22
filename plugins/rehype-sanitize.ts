import { relative, resolve, sep } from "node:path";

import { toString } from "mdast-util-to-string";
import { find, html } from "property-information";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import { imageState } from "./article-state.ts";
import { authorsPath } from "./content-paths.ts";
import { localImage, maxPerOwner } from "./hosted-images.ts";
import assetImages from "./remark-asset-images.ts";
import { defect } from "./warn.ts";

import type { Element, Root } from "hast";
import type { Schema } from "hast-util-sanitize";
import type { VFile } from "vfile";

const attributes = defaultSchema.attributes ?? {};

// 作者が書いた HTML と MDC の記法（属性、コンポーネント）を、許可したものだけに絞る
// GitHub と同じ既定の許可リストに、このブログで使う HTML と、MDC がコードブロックと数式のために生成する属性を加える
// 許可リストにないタグ（MDC のコンポーネントを含む）は、タグだけが取り除かれる
// このプラグインより後で、ビルド時の信頼できる処理が埋め込み、数式、図、コールアウトなどのマークアップを生成する
export const schema: Schema = {
  ...defaultSchema,
  // `id`、`name`、`aria-*` は `user-content-` を付けて、DOM clobbering（`<a id="document">` など）を防ぐ（`name` はアンカー（`<a name>`）にだけ許可する）
  clobber: ["ariaDescribedBy", "ariaLabelledBy", "id", "name"],
  strip: ["script", "style"],
  // リンクの URL のスキームは、http と https だけにする（既定は mailto、irc、ircs、xmpp も許可する）
  protocols: { ...defaultSchema.protocols, href: ["http", "https"] },
  tagNames: [
    ...(defaultSchema.tagNames ?? []).filter((name) => name !== "picture" && name !== "source"),
    "mark",
    "small",
    "u",
    "abbr",
    "figure",
    "figcaption",
    "icon",
  ],
  attributes: {
    ...attributes,
    "*": (attributes["*"] ?? []).filter((attribute) => attribute !== "name"),
    a: [...(attributes.a ?? []), "name"],
    // `code`（コピーボタンがコピーする文字列）は、作者が書けないよう許可せず、sanitize のあとに、表示するコードの文字列から設定する
    pre: ["language", "filename", "highlights", "meta", ["className", /^language-[\w+-]+$/]],
    code: ["__ignoreMap", ["className", /^language-[\w+-]+$/, "math-inline", "math-display"]],
    img: [...(attributes.img ?? []), "width", "height"],
    icon: ["dataLucideName", "dataLucideLabel", "dataLucideSize"],
  },
};

// href が許可されないリンクは中身だけを残し、名前付きアンカーは残す
export const unwrapLinks = (tree: Root) => {
  visit(tree, "element", (node, index, parent) => {
    if (
      node.tagName === "a" &&
      node.properties.href === undefined &&
      node.properties.name === undefined &&
      node.properties.id === undefined &&
      parent &&
      index !== undefined
    ) {
      parent.children.splice(index, 1, ...node.children);
      return index;
    }
  });
};

// 木に含まれる要素の名前と、要素ごとの属性の数を求める
const tally = (tree: Root) => {
  const elements = new Map<string, number>();
  const attributes = new Map<string, number>();
  const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  visit(tree, "element", (node) => {
    count(elements, node.tagName);
    for (const [key, value] of Object.entries(node.properties)) {
      // 値のない属性と、MDC がコードブロックに付ける code（作者が書いたものと見分けられない）は、数えない
      if (value === undefined || value === null || (node.tagName === "pre" && key === "code")) continue;
      count(attributes, `${node.tagName}\0${key}`);
    }
  });
  return { elements, attributes };
};

// sanitize が取り除いた要素と属性の名前を求める（記事ごとの警告に使う）
const removed = (before: ReturnType<typeof tally>, after: ReturnType<typeof tally>) => {
  const names = (a: Map<string, number>, b: Map<string, number>, name: (key: string) => string) =>
    [...new Set([...a].filter(([key, count]) => count > (b.get(key) ?? 0)).map(([key]) => name(key)))].sort();
  return {
    elements: names(before.elements, after.elements, (key) => key),
    attributes: names(before.attributes, after.attributes, (key) => find(html, key.split("\0")[1]!).attribute),
  };
};

// 巨大な記事でビルドが重くならないよう、記事の大きさ（文字数）に上限を設ける
const maxLength = 500_000;
const markdown = unified().use(remarkParse).use(remarkRehype);

// 画像の src を検査する（markdown の画像は、remark-asset-images が検査して書き換え済み）
// 許可するのは、この記事の処理で生成した画像と、同じ著者の assets の、検査に通った画像だけ（それ以外は、img ごと取り除く）
const checkSrc = async (src: unknown, author: string, contents: string, state: ReturnType<typeof imageState>) => {
  if (!src) return;
  if (typeof src !== "string") throw new Error("画像のパスが不正です");
  if (state.generated.has(src)) return state.generated.get(src);
  const assets = resolve(contents, author, "assets");
  const prefix = `/${authorsPath}/`;
  const path = src.startsWith(`${prefix}${author}/assets/`) ? resolve(contents, src.slice(prefix.length)) : "";
  if (!path.startsWith(`${assets}${sep}`)) throw new Error("同じ著者の assets の画像ではありません");
  if (++state.count > maxPerOwner) throw new Error("画像の数が上限を超えています");
  return await localImage(assets, path);
};

export default ({ contents }: { contents: string }) => {
  const sanitize = rehypeSanitize(schema);
  return async (tree: Root, file: VFile) => {
    if (String(file.value).length > maxLength) file.fail(`記事が大きすぎます（${String(maxLength)} 文字まで）`);
    // summary の Markdown も本文と同じ画像検査と sanitize を通す
    const summaries: Element[] = [];
    visit(tree, "element", (node) => {
      if (node.tagName === "summary" && node.children.every((child) => child.type === "text")) {
        summaries.push(node);
      }
    });
    for (const node of summaries) {
      const text = node.children.map((child) => (child.type === "text" ? child.value : "")).join("");
      const parsed = markdown.parse(text);
      await assetImages({ contents })(parsed, file);
      const first = markdown.runSync(parsed).children[0];
      node.children = first?.type === "element" ? first.children : [];
    }
    // 脚注の ID には remark-rehype が `user-content-` を付けており、sanitize が重ねて付けるとリンクが切れるため、先に外す
    visit(tree, "element", ({ properties }) => {
      if (typeof properties.id === "string") properties.id = properties.id.replace(/^user-content-/, "");
    });
    visit(tree, "element", (node) => {
      if (node.tagName !== "icon") return;
      node.properties = {
        dataLucideName: node.properties.name,
        dataLucideLabel: node.properties.label,
        dataLucideSize: node.properties.size,
      };
      node.children = [];
    });
    const before = tally(tree);
    const sanitized = sanitize(tree);
    unwrapLinks(sanitized);
    // 許可されていない HTML を取り除いた場合は、記事ごとに 1 件、要素名と属性名を挙げて警告する
    const { elements, attributes } = removed(before, tally(sanitized));
    if (elements.length || attributes.length) {
      const parts = [
        elements.length ? `要素 ${elements.map((name) => `<${name}>`).join("、")}` : "",
        attributes.length ? `属性 ${attributes.join("、")}` : "",
      ].filter(Boolean);
      defect(
        `許可されていない HTML を取り除きました（${parts.join("、")}）`,
        `${authorsPath}/${relative(contents, file.path)}`
      );
    }
    // コピーボタンがコピーする文字列は、表示するコードの文字列にする
    visit(sanitized, "element", (node) => {
      if (node.tagName === "pre") node.properties.code = toString(node);
    });
    const author = relative(contents, file.path).split(sep)[0] ?? "";
    const images: { node: Element; parent: Root | Element }[] = [];
    visit(sanitized, "element", (node, index, parent) => {
      if (node.tagName === "img" && parent) images.push({ node, parent });
    });
    const state = imageState(file);
    for (const { node, parent } of images) {
      try {
        const converted = await checkSrc(node.properties.src, author, contents, state);
        if (converted) {
          node.properties.src = converted.src;
          if (converted.large) {
            node.properties.srcSet = `${converted.src} 1x, ${converted.large} 2x`;
            node.properties.dataZoomSrc = converted.large;
          }
        }
      } catch (error) {
        defect(
          `${relative(contents, file.path)} の画像を使いません: ${String(node.properties.src)}（${error instanceof Error ? error.message : String(error)}）`,
          `${authorsPath}/${relative(contents, file.path)}`
        );
        parent.children = parent.children.filter((child) => child !== node);
      }
    }
    return sanitized;
  };
};
