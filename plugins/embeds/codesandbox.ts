import { iframeSrc } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

// ID は、スラッグ付きの形式（`/s/<スラッグ>-<ID>`）も含めて、英数字、`_`、`-` だけ（`new` は新規作成のページ）
const id = "(?!new(?:[/?#]|$))([\\w-]{1,100})";
const pathPattern = new RegExp(`^/(?:s|embed|p/sandbox|p/devbox)/${id}$`);

export const codesandbox: Embed = {
  fromUrl: ({ hostname, pathname }) => {
    const sandbox = hostname === "codesandbox.io" && pathPattern.exec(pathname)?.[1];
    if (sandbox) return frame(`https://codesandbox.io/embed/${sandbox}`, "CodeSandbox", 400, "embed-frame");
  },
  // `<iframe src="https://codesandbox.io/embed/<ID>?..." sandbox="..." allow="...">`
  // 作者の sandbox と allow は使わない
  fromEmbedCode: (nodes, index) => {
    const url = URL.parse(iframeSrc(nodes[index]) ?? "");
    if (url?.protocol !== "https:" || url.hostname !== "codesandbox.io" || url.port || url.username || url.password)
      return;
    const sandbox = /^\/(?:embed|p\/sandbox|p\/devbox)\//.test(url.pathname) && pathPattern.exec(url.pathname)?.[1];
    if (sandbox) return { url: `https://codesandbox.io/s/${sandbox}`, length: 1 };
  },
};
