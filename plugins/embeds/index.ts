import { appleMusic } from "./apple-music.ts";
import { canva } from "./canva.ts";
import { codepen } from "./codepen.ts";
import { codesandbox } from "./codesandbox.ts";
import { docswell } from "./docswell.ts";
import { figma } from "./figma.ts";
import { gist } from "./gist.ts";
import { github } from "./github.ts";
import { googleMaps } from "./google-maps.ts";
import { googleSlides } from "./google-slides.ts";
import { miro } from "./miro.ts";
import { speakerdeck } from "./speakerdeck.ts";
import { spotify } from "./spotify.ts";
import { twitch } from "./twitch.ts";
import { twitter } from "./twitter.ts";
import { youtube } from "./youtube.ts";

import type { Embed } from "./types.ts";

// URL の形式ごとの埋め込み（サービスの追加と削除は、ファイル 1 つと、この配列の 1 行）
// 外部のサービスは、作者が指定した URL から決まった形式の URL だけを組み立て、そのサービスの URL にしか接続しない
export const embeds: Embed[] = [
  youtube,
  twitter,
  googleSlides,
  googleMaps,
  figma,
  miro,
  canva,
  codepen,
  codesandbox,
  spotify,
  appleMusic,
  github,
  gist,
  twitch,
  speakerdeck,
  docswell,
];
