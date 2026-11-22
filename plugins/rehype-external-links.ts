import rehypeExternalLinks from "rehype-external-links";

import { siteUrl } from "./site.ts";

// MDC 既定の rehype-external-links は、HTML の解析と sanitize より前に動くため、作者の HTML のリンクを処理できない
// nuxt.config.ts で既定の rehype-external-links を無効にし、sanitize の後に動くこのプラグインに置き換える
// このサイトの絶対 URL は、同じページを指すため、新しいタブで開かない
const origin = new URL(siteUrl).origin;
export default () =>
  rehypeExternalLinks({
    target: "_blank",
    rel: ["noopener", "noreferrer"],
    test: (node) => URL.parse(String(node.properties.href), siteUrl)?.origin !== origin,
  });
