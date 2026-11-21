import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import probe from "probe-image-size";
import sharp from "sharp";

// ビルドに入るすべての画像（記事とプロフィールの画像、外部から取得したアイコン）を、ここで検査する
// 1. 先頭のバイト列が、許可する画像（PNG、JPEG、GIF、WebP、AVIF）で、ローカルのファイルでは拡張子とも一致する（SVG や HTML などは拒否する）
// 2. ファイルの大きさと、画像の縦横の画素数に上限がある（ヘッダーだけで調べ、展開する前に、巨大な画像を拒否する）
// 3. sharp で実際に展開できる（画素数の上限つき）
const maxBytes = 10_000_000;
const maxPixels = 50_000_000;
const extensions: Record<string, string> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  gif: "gif",
  webp: "webp",
  avif: "avif",
};

const detect = (b: Buffer) => {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 6 && ["GIF87a", "GIF89a"].includes(b.toString("latin1", 0, 6))) return "gif";
  if (b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (
    b.length > 12 &&
    b.toString("latin1", 4, 8) === "ftyp" &&
    ["avif", "avis"].includes(b.toString("latin1", 8, 12))
  ) {
    return "avif";
  }
};

// 画像を検査して、種類と大きさを返す（拒否する場合は、理由を Error にして投げる）
// extension（先頭の `.` なし）は、ローカルのファイルの拡張子
export const checkImage = async (buffer: Buffer, extension?: string) => {
  if (buffer.length > maxBytes) throw new Error(`ファイルが大きすぎます（${String(maxBytes)} バイトまで）`);
  const type = detect(buffer);
  if (!type) throw new Error("PNG、JPEG、GIF、WebP、AVIF の画像ではありません");
  if (extension !== undefined && extensions[extension.toLowerCase()] !== type) {
    throw new Error(`拡張子（${extension}）と、画像の種類（${type}）が一致しません`);
  }
  const size = probe.sync(buffer);
  if (!size || size.width * size.height > maxPixels)
    throw new Error(`画素数が多すぎます（${String(maxPixels)} 画素まで）`);
  const metadata = await sharp(buffer, { limitInputPixels: false, animated: true }).metadata();
  const pages = metadata.pages ?? 1;
  if (pages > 200 || metadata.width * (metadata.pageHeight ?? metadata.height) * pages > maxPixels) {
    throw new Error("画像のフレーム数または画素数が多すぎます");
  }
  try {
    await sharp(buffer, { limitInputPixels: maxPixels, animated: true }).toBuffer();
  } catch {
    throw new Error("画像を展開できません");
  }
  return { type, width: size.width, height: size.height };
};

// root（著者の assets ディレクトリ）の中にある、通常のファイル（シンボリックリンクを除く）を、大きさの上限つきで読む
export const readLocalImage = (root: string, path: string) => {
  root = resolve(root);
  path = resolve(path);
  const inside = relative(root, path);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`)) throw new Error("assets の外にあるファイルです");
  if (lstatSync(dirname(root)).isSymbolicLink()) throw new Error("シンボリックリンクは使えません");
  let component = root;
  for (const part of ["", ...inside.split(sep)]) {
    component = join(component, part);
    if (lstatSync(component, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error("シンボリックリンクは使えません");
    }
  }
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) throw new Error("ファイルが見つかりません");
  if (!stat.isFile()) throw new Error("通常のファイルではありません");
  if (stat.size > maxBytes) throw new Error(`ファイルが大きすぎます（${String(maxBytes)} バイトまで）`);
  if (!realpathSync(path).startsWith(`${realpathSync(root)}${sep}`)) throw new Error("assets の外にあるファイルです");
  return readFileSync(path);
};
