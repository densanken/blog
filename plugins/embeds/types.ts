import type { Element, RootContent } from "hast";

// 貼られた埋め込みコードから取り出した、正規の URL と、コードのうち消費するノードの数
export interface EmbedCode {
  url: string;
  length: number;
}

// サービスごとの埋め込み
export interface Embed {
  // URL を埋め込みの要素にする（対象でなければ undefined）
  fromUrl: (url: URL, reserveFetch: () => void) => Element | undefined | Promise<Element | undefined>;
  // 兄弟ノードの index から始まる埋め込みコード（iframe、script、ラッパーの div、説明リンクなど）を、正規の URL にする（対象でなければ undefined）
  // 作者の属性は URL を取り出す以外に使わず、縦横比は URL の hash（`ratio.ts`）で fromUrl に渡す
  fromEmbedCode: (nodes: readonly RootContent[], index: number) => EmbedCode | undefined;
}
