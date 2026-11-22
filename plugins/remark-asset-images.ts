import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";

import { visit } from "unist-util-visit";

import { imageState } from "./article-state.ts";
import { authorsPath } from "./content-paths.ts";
import { hostImage, localImage, maxPerOwner } from "./hosted-images.ts";
import { defect, warn } from "./warn.ts";

import type { Image, Root } from "mdast";
import type { VFile } from "vfile";

// 記事の画像を検査して WebP に変換し、生成画像の URL に書き換える
// 画像は、記事と同じ著者の assets の中にある、通常のファイル（シンボリックリンクを除く）だけを参照できる
// 画像は検査し（image-check.ts）、大きさを求めて、width と height 属性にする（記事で `{width="200"}` と指定した場合は、その幅に合わせた高さにする）
// 画像が見つからない、または検査に通らない場合は、記事を生成したまま、警告を出して src を空にする（代替テキストが表示される）
// 外部の画像の取得の失敗（書き手が直せないため、不備にしない）
class FetchFailure extends Error {}

export default ({ contents }: { contents: string }) =>
  async (tree: Root, file: VFile) => {
    const author = relative(contents, file.path).split(sep)[0] ?? "";
    const assets = join(contents, author, "assets");
    const nodes: (Image & { attributes?: unknown })[] = [];
    const definitions = new Map<string, { url: string; title?: string | null }>();
    const normalize = (id: string) => id.replace(/\s+/g, " ").trim().toUpperCase();
    visit(tree, "definition", (node) => {
      const id = normalize(node.identifier);
      if (!definitions.has(id)) definitions.set(id, node);
    });
    visit(tree, "imageReference", (node, index, parent) => {
      const definition = definitions.get(normalize(node.identifier));
      if (!definition || index === undefined || !parent) return;
      parent.children[index] = { ...node, type: "image", url: definition.url, title: definition.title };
    });
    visit(tree, "image", (node) => {
      if (!/^([a-z][a-z\d+.-]*:|[/#])/i.test(node.url) || /^https?:\/\//i.test(node.url)) nodes.push(node);
    });
    const state = imageState(file);
    const store = (image: { src: string; large?: string }) => {
      const key = `generated-${randomUUID()}`;
      state.generated.set(key, image);
      return key;
    };
    for (const node of nodes) {
      try {
        const attributes = node.attributes && typeof node.attributes === "object" ? node.attributes : {};
        const value = "width" in attributes ? attributes.width : undefined;
        const specifiedWidth = typeof value === "number" || typeof value === "string" ? Number(value) : 0;
        if (++state.count > maxPerOwner) throw new Error("画像の数が上限を超えています");
        // 外部の画像は、取得してこのサイトから配信する（取得できなければ、警告を出して src を空にする）
        if (/^https?:\/\//i.test(node.url)) {
          const hosted = await hostImage(node.url, { width: 1600, maxBytes: 5_000_000 });
          if (!hosted) throw new FetchFailure("外部の画像を取得できません");
          const width = specifiedWidth || hosted.width;
          node.url = store(hosted);
          node.attributes = { ...attributes, width, height: Math.round((width * hosted.height) / hosted.width) };
          continue;
        }
        // 画像の URL は、パーセントエンコードされている（`my%20photo.png`）ため、ファイルのパスに戻す
        const path = resolve(dirname(file.path), decodeURIComponent(node.url));
        if (!path.startsWith(`${assets}${sep}`)) throw new Error("assets の外にある画像は使えません");
        const size = await localImage(assets, path);
        node.url = store(size);
        const width = specifiedWidth || size.width;
        node.attributes = { ...attributes, width, height: Math.round((width * size.height) / size.width) };
      } catch (error) {
        (error instanceof FetchFailure ? warn : defect)(
          `${relative(contents, file.path)} の画像を使えません: ${node.url}（${error instanceof Error ? error.message : String(error)}）`,
          `${authorsPath}/${relative(contents, file.path)}`
        );
        node.url = "";
      }
    }
  };
