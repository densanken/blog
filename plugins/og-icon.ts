import { readFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

import { authorsPath } from "./content-paths.ts";
import { validIdentifier } from "./identifiers.ts";
import { warn } from "./warn.ts";

// OGP 画像に入れる著者のアイコンを、検査して小さな PNG に変換し直した data URI にする（OGP の生成が、外部や自サイトから画像を取得しないようにする）
// icon は変換済みの `/_cards/` の画像を含む値
const size = 256;

export const ogIcon = async (authorId: string, icon: string, { cards }: { cards: string }) => {
  try {
    if (!validIdentifier(authorId)) throw new Error("著者 ID が不正です");
    const name = icon.split(",")[1];
    if (!name || !/^\/_cards\/[a-f\d]{16}\.webp$/.test(name)) throw new Error("アイコンのパスが不正です");
    const source = readFileSync(join(cards, name.slice("/_cards/".length)));
    const png = await sharp(source, { limitInputPixels: 50_000_000 })
      .autoOrient()
      .resize(size, size, { fit: "cover" })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch (error) {
    warn(
      `OGP 画像にアイコンを入れられません: ${authorId}（${error instanceof Error ? error.message : String(error)}）`,
      `${authorsPath}/${authorId}/profile.yaml`
    );
  }
};

// OGP 画像に入れるサイトのロゴ（ccsko.png）を、小さな PNG の data URI にする
// バンドル後は import.meta.url からたどれないため、パスは runtimeConfig で受け取る
const logoSize = 340;
let logo: Promise<string> | undefined;

export const ogLogo = (path: string) =>
  (logo ??= sharp(path)
    .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
    .then((png) => `data:image/png;base64,${png.toString("base64")}`));
