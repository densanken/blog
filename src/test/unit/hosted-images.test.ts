import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { h } from "hastscript";
import remarkParse from "remark-parse";
import sharp from "sharp";
import { unified } from "unified";
import { VFile } from "vfile";
import { expect, it, vi } from "vitest";

import { child, isElement } from "../hast.ts";

import type { Root } from "hast";

it("validates remote images before saving WebP files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hosted-images-"));
  vi.resetModules();
  vi.doMock("../../../plugins/paths.ts", () => ({ cards: join(dir, ".data/cards") }));
  const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  const inputs: Record<string, Buffer> = {
    png,
    svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>'),
    html: Buffer.from("<html><body>image</body></html>"),
    oversized: Buffer.concat([png, Buffer.alloc(10_000_000)]),
  };
  vi.doMock("../../../plugins/safe-fetch.ts", () => ({
    safeFetch: vi.fn((url: string) => {
      const input = inputs[url.split("/").pop() ?? ""];
      assert.ok(input);
      return Promise.resolve(input);
    }),
  }));
  try {
    const { hostImage } = await import("../../../plugins/hosted-images.ts");
    for (const name of ["svg", "html", "oversized"]) {
      expect(await hostImage(`https://example.com/${name}`, { width: 100 })).toBeUndefined();
      expect(existsSync(join(dir, ".data/cards"))).toBe(false);
    }
    const result = await hostImage("https://example.com/png", { width: 100 });
    assert.ok(result);
    expect(result.src).toMatch(/^\/_cards\/[a-f0-9]+\.webp$/);
    expect(
      (await sharp(readFileSync(join(dir, ".data/cards", result.src.split("/").pop() ?? ""))).metadata()).format
    ).toBe("webp");
    expect(readdirSync(join(dir, ".data/cards"))).toHaveLength(1);
  } finally {
    vi.restoreAllMocks();
    vi.doUnmock("../../../plugins/safe-fetch.ts");
    vi.doUnmock("../../../plugins/paths.ts");
    rmSync(dir, { recursive: true, force: true });
  }
});

it("hosts link-card thumbnails and favicons as WebP", async () => {
  const dir = mkdtempSync(join(tmpdir(), "card-images-"));
  vi.resetModules();
  vi.doMock("../../../plugins/paths.ts", () => ({ cards: join(dir, ".data/cards") }));
  const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: "blue" } })
    .png()
    .toBuffer();
  const fetch = vi.fn((url: string) =>
    Promise.resolve(
      url === "https://card.example/"
        ? Buffer.from(
            '<meta property="og:title" content="Safe\u200bTitle"><meta property="og:description" content="Safe\u202eDescription"><meta property="og:image" content="https://images.example/thumb.png"><link rel="icon" href="https://images.example/icon.png">'
          )
        : png
    )
  );
  vi.doMock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: fetch }));
  try {
    const { default: embed } = await import("../../../plugins/rehype-embed.ts");
    const tree: Root = { type: "root", children: [h("p", [h("a", { href: "https://card.example/" }, "card")])] };
    await embed()(tree, new VFile({ path: "post.md" }));
    const card = child(tree, 0);
    expect(JSON.stringify(card)).toContain("SafeTitle");
    expect(JSON.stringify(card)).toContain("SafeDescription");
    expect(JSON.stringify(card)).not.toContain("\u200b");
    expect(JSON.stringify(card)).not.toContain("\u202e");
    const site = child(card, 0)
      .children.filter(isElement)
      .find((node) => Array.isArray(node.properties.className) && node.properties.className.includes("link-card-site"));
    const thumbnail = card.children
      .filter(isElement)
      .find(
        (node) => Array.isArray(node.properties.className) && node.properties.className.includes("link-card-image")
      );
    assert.ok(site && thumbnail);
    const favicon = child(site, 0);
    for (const image of [favicon, thumbnail]) {
      expect(image.tagName).toBe("img");
      expect(image.properties.src).toMatch(/^\/_cards\/[a-f0-9]+\.webp$/);
      const src = image.properties.src;
      assert.ok(typeof src === "string");
      const data = readFileSync(join(dir, ".data/cards", src.split("/").pop() ?? ""));
      expect((await sharp(data).metadata()).format).toBe("webp");
      await expect(sharp(data).raw().toBuffer()).resolves.toBeInstanceOf(Buffer);
    }
    expect(fetch).toHaveBeenCalledWith("https://images.example/thumb.png", expect.any(Object));
    expect(fetch).toHaveBeenCalledWith("https://images.example/icon.png", expect.any(Object));
  } finally {
    vi.restoreAllMocks();
    vi.doUnmock("../../../plugins/safe-fetch.ts");
    vi.doUnmock("../../../plugins/paths.ts");
    rmSync(dir, { recursive: true, force: true });
  }
});

it("decodes PNG and 32-bit BMP ICO entries and rejects malformed icons", async () => {
  const { decodeIcon } = await import("../../../plugins/hosted-images.ts");
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } })
    .png()
    .toBuffer();
  const ico = (data: Buffer) => {
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header[6] = 2;
    header[7] = 2;
    header.writeUInt32LE(data.length, 14);
    header.writeUInt32LE(22, 18);
    return Buffer.concat([header, data]);
  };
  expect(decodeIcon(ico(png)).data).toEqual(png);
  const directory = Buffer.alloc(38);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(2, 4);
  directory[6] = 32;
  directory[7] = 32;
  directory.writeUInt32LE(40, 14);
  directory.writeUInt32LE(38, 18);
  directory[22] = 2;
  directory[23] = 2;
  directory.writeUInt32LE(png.length, 30);
  directory.writeUInt32LE(78, 34);
  const unsupported = Buffer.alloc(40);
  unsupported.writeUInt32LE(40, 0);
  unsupported.writeUInt16LE(24, 14);
  expect(decodeIcon(Buffer.concat([directory, unsupported, png])).data).toEqual(png);
  const bmp = Buffer.alloc(56);
  bmp.writeUInt32LE(40, 0);
  bmp.writeInt32LE(2, 4);
  bmp.writeInt32LE(4, 8);
  bmp.writeUInt16LE(1, 12);
  bmp.writeUInt16LE(32, 14);
  for (let i = 40; i < 56; i += 4) {
    bmp[i + 2] = 255;
    bmp[i + 3] = 255;
  }
  const decoded = decodeIcon(ico(bmp));
  expect(decoded.raw).toEqual({ width: 2, height: 2, channels: 4 });
  expect([...decoded.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  await expect(sharp(decoded.data, { raw: decoded.raw }).webp().toBuffer()).resolves.toBeInstanceOf(Buffer);
  const masked = Buffer.concat([Buffer.from(bmp), Buffer.alloc(8)]);
  for (let i = 43; i < 56; i += 4) masked[i] = 0;
  masked[60] = 0x80;
  expect([...decodeIcon(ico(masked)).data.subarray(0, 8)]).toEqual([255, 0, 0, 0, 255, 0, 0, 255]);
  expect(() => decodeIcon(ico(masked.subarray(0, 56)))).toThrow();
  expect(() => decodeIcon(ico(bmp).subarray(0, 30))).toThrow();
  const palette = Buffer.from(bmp);
  palette.writeUInt32LE(1, 32);
  expect(() => decodeIcon(ico(palette))).toThrow();
  const oversized = Buffer.from(bmp);
  oversized.writeInt32LE(100000, 4);
  expect(() => decodeIcon(ico(oversized))).toThrow();
  expect(() => decodeIcon(Buffer.alloc(6))).toThrow();
});

it("validates and saves PNG and BMP ICOs through hostImage", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hosted-ico-"));
  vi.resetModules();
  vi.doMock("../../../plugins/paths.ts", () => ({ cards: join(dir, ".data/cards") }));
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } })
    .png()
    .toBuffer();
  const bmp = Buffer.alloc(56);
  bmp.writeUInt32LE(40, 0);
  bmp.writeInt32LE(2, 4);
  bmp.writeInt32LE(4, 8);
  bmp.writeUInt16LE(1, 12);
  bmp.writeUInt16LE(32, 14);
  for (let i = 40; i < 56; i += 4) {
    bmp[i] = 255;
    bmp[i + 3] = 255;
  }
  const ico = (data: Buffer, width = 2) => {
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header[6] = width;
    header[7] = 2;
    header.writeUInt32LE(data.length, 14);
    header.writeUInt32LE(22, 18);
    return Buffer.concat([header, data]);
  };
  const inputs: Record<string, Buffer> = {
    png: ico(png),
    bmp: ico(bmp),
    mismatch: ico(png, 3),
    truncated: ico(bmp.subarray(0, 55)),
  };
  vi.doMock("../../../plugins/safe-fetch.ts", () => ({
    safeFetch: vi.fn((url: string) => {
      const input = inputs[url.split("/").pop() ?? ""];
      assert.ok(input);
      return Promise.resolve(input);
    }),
  }));
  const imageCheck = await import("../../../plugins/image-check.ts");
  const check = vi.spyOn(imageCheck, "checkImage");
  try {
    const { hostImage } = await import("../../../plugins/hosted-images.ts");
    for (const name of ["mismatch", "truncated"]) {
      expect(await hostImage(`https://example.com/${name}`, { width: 32, icon: true })).toBeUndefined();
      expect(existsSync(join(dir, ".data/cards"))).toBe(false);
    }
    check.mockClear();
    for (const name of ["png", "bmp"]) {
      const result = await hostImage(`https://example.com/${name}`, { width: 32, icon: true });
      assert.ok(result);
      expect(check).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ width: 2, height: 2 });
      const data = readFileSync(join(dir, ".data/cards", result.src.split("/").pop() ?? ""));
      expect((await sharp(data).metadata()).format).toBe("webp");
      expect(await sharp(data).raw().toBuffer()).toHaveLength(12);
    }
  } finally {
    vi.restoreAllMocks();
    vi.doUnmock("../../../plugins/safe-fetch.ts");
    vi.doUnmock("../../../plugins/paths.ts");
    rmSync(dir, { recursive: true, force: true });
  }
});

it("prefers raster candidates, skips SVG and uses Google as the last fallback", async () => {
  const dir = mkdtempSync(join(tmpdir(), "favicon-"));
  vi.resetModules();
  vi.doMock("../../../plugins/paths.ts", () => ({ cards: join(dir, ".data/cards") }));
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } })
    .png()
    .toBuffer();
  const fetch = vi.fn((url: string) => {
    if (url === "https://one.example/")
      return Promise.resolve(
        Buffer.from(
          '<link rel="icon" href="/icon.ico"><link rel="apple-touch-icon" href="/bad.png"><link rel="shortcut icon" href="/good.png">'
        )
      );
    if (url.startsWith("https://two.example/"))
      return Promise.resolve(Buffer.from('<link rel="icon" type="image/svg+xml" href="/icon.svg">'));
    if (url === "https://three.example/") return Promise.resolve(Buffer.from("<title>Fallback</title>"));
    if (url.endsWith("/bad.png")) throw new Error("bad");
    return Promise.resolve(png);
  });
  vi.doMock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: fetch }));
  try {
    const { default: embed } = await import("../../../plugins/rehype-embed.ts");
    const tree: Root = {
      type: "root",
      children: ["one.example/", "two.example/", "three.example/", "two.example/another"].map((host) =>
        h("p", [h("a", { href: `https://${host}` }, "card")])
      ),
    };
    await embed()(tree, new VFile({ path: "post.md" }));
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls.indexOf("https://one.example/bad.png")).toBeLessThan(urls.indexOf("https://one.example/good.png"));
    expect(urls).not.toContain("https://one.example/icon.ico");
    expect(urls).not.toContain("https://www.google.com/s2/favicons?domain=one.example&sz=64");
    expect(urls).not.toContain("https://two.example/icon.svg");
    expect(urls).not.toContain("https://two.example/favicon.ico");
    expect(urls).toContain("https://www.google.com/s2/favicons?domain=two.example&sz=64");
    expect(urls.filter((url) => url === "https://www.google.com/s2/favicons?domain=two.example&sz=64")).toHaveLength(1);
    expect(JSON.stringify(tree.children[1])).toContain("/_cards/");
    expect(JSON.stringify(tree.children[3])).toContain("/_cards/");
    expect(urls).toContain("https://three.example/favicon.ico");
    expect(urls).not.toContain("https://www.google.com/s2/favicons?domain=three.example&sz=64");
  } finally {
    vi.restoreAllMocks();
    vi.doUnmock("../../../plugins/safe-fetch.ts");
    vi.doUnmock("../../../plugins/paths.ts");
    rmSync(dir, { recursive: true, force: true });
  }
});

it("orients JPEG pixels and dimensions before resizing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "oriented-image-"));
  vi.resetModules();
  vi.doMock("../../../plugins/paths.ts", () => ({ cards: join(dir, "cards") }));
  try {
    const pixels = Buffer.alloc(80 * 40 * 3);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 80; x++) pixels[(y * 80 + x) * 3 + (x < 40 ? 0 : 2)] = 255;
    }
    const jpeg = await sharp(pixels, { raw: { width: 80, height: 40, channels: 3 } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const assets = join(dir, "writer/assets");
    mkdirSync(assets, { recursive: true });
    const path = join(assets, "oriented.jpg");
    writeFileSync(path, jpeg);
    const { localImage, saveImage } = await import("../../../plugins/hosted-images.ts");
    const local = await localImage(assets, path);
    expect(local).toMatchObject({ width: 40, height: 80 });
    const { default: assetImages } = await import("../../../plugins/remark-asset-images.ts");
    const processor = unified().use(remarkParse).use(assetImages, { contents: dir });
    const tree = processor.parse("![oriented](./assets/oriented.jpg)");
    const paragraph = tree.children[0];
    assert.ok(paragraph?.type === "paragraph");
    const image = paragraph.children[0];
    assert.ok(image?.type === "image");
    Object.assign(image, { attributes: { width: 20 } });
    await processor.run(tree, new VFile({ path: join(dir, "writer/post.md") }));
    expect(image).toMatchObject({ attributes: { width: 20, height: 40 } });
    const result = await saveImage(jpeg, { width: 20 });
    expect(result).toMatchObject({ width: 20, height: 40 });
    const output = await sharp(join(dir, "cards", result.src.split("/").pop() ?? ""))
      .raw()
      .toBuffer();
    expect(output[0]).toBeGreaterThan(output[2] ?? 0);
    expect(output[39 * 20 * 3 + 2]).toBeGreaterThan(output[39 * 20 * 3] ?? 0);
  } finally {
    vi.doUnmock("../../../plugins/paths.ts");
    rmSync(dir, { recursive: true, force: true });
  }
});

it("shares local image conversion by content across files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "local-cache-"));
  vi.resetModules();
  vi.doMock("../../../plugins/paths.ts", () => ({ cards: join(dir, "cards") }));
  const check = vi.spyOn(await import("../../../plugins/image-check.ts"), "checkImage");
  try {
    const assets = join(dir, "writer/assets");
    mkdirSync(assets, { recursive: true });
    const png = await sharp({ create: { width: 2, height: 3, channels: 3, background: "blue" } })
      .png()
      .toBuffer();
    writeFileSync(join(assets, "a.png"), png);
    writeFileSync(join(assets, "b.png"), png);
    const { localImage } = await import("../../../plugins/hosted-images.ts");
    const [first, second] = await Promise.all([
      localImage(assets, join(assets, "a.png")),
      localImage(assets, join(assets, "b.png")),
    ]);
    expect(first).toEqual(second);
    expect(check).toHaveBeenCalledTimes(1);
  } finally {
    vi.restoreAllMocks();
    vi.doUnmock("../../../plugins/paths.ts");
    rmSync(dir, { recursive: true, force: true });
  }
});
