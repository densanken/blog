import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import sharp from "sharp";

import { checkImage, readLocalImage } from "./image-check.ts";
import { cards as dir } from "./paths.ts";
import { safeFetch } from "./safe-fetch.ts";

import type { Raw } from "sharp";

// 外部の画像（リンクカードのサムネイルとファビコン、記事に書かれた外部の画像）を、ビルド時に取得して、このサイトから配信する
// 取得は safeFetch（同時接続数と 1 回の取得時間の上限つき）、検査は image-check.ts で行い、WebP に変換し直す
// ファイル名は、変換後の内容のハッシュ（`/_cards/<ハッシュ>.webp`）にするため、同じ内容の画像は、URL や記事が違っても 1 つのファイルになる
// 同じ key（既定は URL と変換条件、ファビコンはホスト名）の画像は、ビルドの間に 1 度だけ取得する
// 保存先は、記事の解析結果のキャッシュと同じ .data/ にする（キャッシュが残る間は、画像も残る）
// nuxt.config.ts が /_cards/ で配信する
// 取得できない、または検査に通らない画像は undefined を返す（外部のサイトのリンク切れは、よくあるため、警告しない）
const cache = new Map<string, Promise<{ src: string; width: number; height: number } | undefined>>();
// 1 つの記事に使える本文の画像の数の上限
export const maxPerOwner = 100;

// 画像を検査して WebP に変換し直し、内容のハッシュのファイル名で保存する（animated が true なら、アニメーションを残す）
const encodeImage = async (
  source: Buffer,
  { width, animated = false, raw, square = false }: { width: number; animated?: boolean; raw?: Raw; square?: boolean }
) => {
  const { data, info } = await sharp(source, { limitInputPixels: 50_000_000, animated, raw })
    .autoOrient()
    .resize({
      width,
      height: square ? width : undefined,
      fit: square ? "cover" : "inside",
      withoutEnlargement: !square,
    })
    .webp({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  const name = `${createHash("sha256").update(data).digest("hex").slice(0, 16)}.webp`;
  mkdirSync(dir, { recursive: true });
  if (!existsSync(join(dir, name))) writeFileSync(join(dir, name), data);
  // アニメーションの画像の height は、全フレームを縦に並べた値なので、1 フレームの高さにする
  return { src: `/_cards/${name}`, width: info.width, height: info.pageHeight ?? info.height };
};

export const saveImage = async (source: Buffer, options: { width: number; animated?: boolean; raw?: Raw }) => {
  if (!options.raw) await checkImage(source);
  return await encodeImage(source, options);
};

// プロフィール画像は元画像を一度検査し、正方形の 2 種類を保存する
export const saveAuthorIcon = async (source: Buffer, extension?: string) => {
  await checkImage(source, extension);
  const small = await encodeImage(source, { width: 48, square: true });
  const large = await encodeImage(source, { width: 240, square: true });
  return `${small.src},${large.src}`;
};

// ローカル画像も同じ検査と変換を通し、本文用の 2 種類を保存する
const localCache = new Map<string, Promise<Awaited<ReturnType<typeof convertLocalImage>>>>();

const convertLocalImage = async (buffer: Buffer, path: string) => {
  const size = await checkImage(buffer, extname(path).slice(1));
  const animated = size.type === "gif";
  const small = await encodeImage(buffer, { width: 800, animated });
  const large = await encodeImage(buffer, { width: 1600, animated });
  const dimensions = (await sharp(buffer).metadata()).autoOrient;
  return { ...size, ...dimensions, src: small.src, large: large.src };
};

export const localImage = (assets: string, path: string) => {
  const buffer = readLocalImage(assets, path);
  const key = `${extname(path).toLowerCase()}:${createHash("sha256").update(buffer).digest("hex")}`;
  if (!localCache.has(key)) {
    const result = convertLocalImage(buffer, path).catch((error: unknown) => {
      localCache.delete(key);
      throw error;
    });
    localCache.set(key, result);
  }
  return localCache.get(key)!;
};

// ICO は PNG または 32 ビット BMP のエントリだけを扱う
export const decodeIcon = (buffer: Buffer, target = 32) => {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) throw new Error("invalid ICO");
  const count = buffer.readUInt16LE(4);
  if (!count || count > 256 || buffer.length < 6 + count * 16) throw new Error("invalid ICO directory");
  const entries = Array.from({ length: count }, (_, i) => {
    const pos = 6 + i * 16;
    return {
      width: (buffer[pos] ?? 0) || 256,
      height: (buffer[pos + 1] ?? 0) || 256,
      size: buffer.readUInt32LE(pos + 8),
      offset: buffer.readUInt32LE(pos + 12),
    };
  });
  const supported = entries.filter(({ size, offset }) => {
    if (!size || offset < 6 + count * 16 || offset + size > buffer.length) return false;
    const entry = buffer.subarray(offset, offset + size);
    return (
      entry.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      (entry.length >= 40 && entry.readUInt32LE(0) === 40 && entry.readUInt16LE(14) === 32)
    );
  });
  supported.sort((a, b) => Math.abs(a.width - target) - Math.abs(b.width - target));
  if (!supported[0]) throw new Error("unsupported ICO");
  const { width, height, size, offset } = supported[0];
  const data = buffer.subarray(offset, offset + size);
  if (data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return { data, dimensions: { width, height } };
  if (
    data.length < 40 ||
    data.readUInt32LE(0) !== 40 ||
    data.readInt32LE(4) !== width ||
    data.readInt32LE(8) !== height * 2 ||
    data.readUInt16LE(12) !== 1 ||
    data.readUInt16LE(14) !== 32 ||
    data.readUInt32LE(16) !== 0 ||
    data.readUInt32LE(32) !== 0 ||
    data.length < 40 + width * height * 4
  )
    throw new Error("invalid ICO bitmap");
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = 40 + ((height - 1 - y) * width + x) * 4;
      const to = (y * width + x) * 4;
      pixels[to] = data[from + 2] ?? 0;
      pixels[to + 1] = data[from + 1] ?? 0;
      pixels[to + 2] = data[from] ?? 0;
      pixels[to + 3] = data[from + 3] ?? 0;
    }
  }
  if (!pixels.some((value, i) => i % 4 === 3 && value !== 0)) {
    const stride = Math.ceil(width / 32) * 4;
    const mask = 40 + width * height * 4;
    if (data.length < mask + stride * height) throw new Error("invalid ICO mask");
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        pixels[(y * width + x) * 4 + 3] =
          (data[mask + (height - 1 - y) * stride + (x >> 3)] ?? 0) & (0x80 >> (x % 8)) ? 0 : 255;
      }
    }
  }
  return { data: pixels, raw: { width, height, channels: 4 as const } };
};

const host = async (urls: string[], { width, maxBytes, icon }: { width: number; maxBytes: number; icon: boolean }) => {
  for (const url of urls) {
    try {
      let data: Buffer = await safeFetch(url, { maxBytes });
      let raw;
      if (icon && data.length >= 4 && data.readUInt32LE(0) === 0x00010000) {
        const decoded = decodeIcon(data, width);
        ({ data, raw } = decoded);
        if (decoded.dimensions) {
          const size = await checkImage(data);
          if (
            size.type !== "png" ||
            size.width !== decoded.dimensions.width ||
            size.height !== decoded.dimensions.height
          )
            throw new Error("invalid ICO dimensions");
          return await encodeImage(data, { width });
        }
      }
      return await saveImage(data, { width, raw });
    } catch {
      // 次の候補を試す
    }
  }
};

export const hostImage = (
  url: string | string[],
  {
    width,
    maxBytes = 2_000_000,
    key = `${String(url)}:${String(width)}:${String(maxBytes)}`,
    icon = false,
  }: { width: number; maxBytes?: number; key?: string; icon?: boolean }
) => {
  if (!cache.has(key)) cache.set(key, host(Array.isArray(url) ? url : [url], { width, maxBytes, icon }));
  return cache.get(key);
};
