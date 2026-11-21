import rehypeExternalLinks from "rehype-external-links";

// MDC 既定の rehype-external-links は、HTML の解析と sanitize より前に動くため、作者の HTML のリンクを処理できない
// nuxt.config.ts で既定の rehype-external-links を無効にし、sanitize の後に動くこのプラグインに置き換える
export default () => rehypeExternalLinks({ target: "_blank", rel: ["noopener", "noreferrer"] });
