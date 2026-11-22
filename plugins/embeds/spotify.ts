import { iframeSrc } from "./code.ts";
import { frame } from "./frame.ts";

import type { Embed } from "./types.ts";

const types = "track|album|playlist|episode|show|artist";
const pagePath = new RegExp(`^/(?:intl-[a-z]{2}(?:-[A-Za-z]{2,4})?/)?(${types})/([A-Za-z0-9]{10,30})$`);
const embedSrc = new RegExp(
  `^https://open\\.spotify\\.com/embed(?:-podcast)?/(?:intl-[a-z]{2}(?:-[A-Za-z]{2,4})?/)?(${types})/([A-Za-z0-9]{10,30})(?:[?#]|$)`
);

const spotifyFrame = (type: string, id: string) =>
  frame(
    `https://open.spotify.com/embed/${type}/${id}`,
    "Spotify",
    // 高さは固定（曲とエピソードはコンパクトなプレーヤー）
    type === "track" || type === "episode" ? 152 : 352,
    "embed-frame",
    // 再生に DRM（EME）が必要
    "encrypted-media; fullscreen"
  );

export const spotify: Embed = {
  fromUrl: ({ hostname, pathname }) => {
    const [, type, id] = (hostname === "open.spotify.com" ? pagePath.exec(pathname) : null) ?? [];
    if (type && id) return spotifyFrame(type, id);
  },
  // `<iframe src="https://open.spotify.com/embed/<種類>/<ID>?utm_source=generator" allow="..." height="352">`
  // 作者の allow と高さは使わない
  fromEmbedCode: (nodes, index) => {
    const [, type, id] = embedSrc.exec(iframeSrc(nodes[index]) ?? "") ?? [];
    if (type && id) return { url: `https://open.spotify.com/${type}/${id}`, length: 1 };
  },
};
