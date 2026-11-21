import { h } from "hastscript";
import { describe, expect, it, vi } from "vitest";

import { figma } from "../../../plugins/embeds/figma.ts";
import { googleMaps } from "../../../plugins/embeds/google-maps.ts";
import { miro } from "../../../plugins/embeds/miro.ts";

import type { Embed } from "../../../plugins/embeds/types.ts";

const reserve = vi.fn();
// 拒否するときは、要素ではなく undefined を返す（src のない要素を返すと、実際の変換では、その要素が使われる）
const rejected = async (embed: Embed, url: string) => {
  expect(await embed.fromUrl(new URL(url), reserve)).toBeUndefined();
};
const src = async (embed: Embed, url: string) => {
  const result = await embed.fromUrl(new URL(url), reserve);
  const iframe = result?.children[0];
  return iframe?.type === "element" ? iframe.properties.src : undefined;
};

describe("Google Maps", () => {
  it.each([
    [
      "https://www.google.com/maps/place/Tokyo+Station/data=abc",
      "https://www.google.com/maps?q=Tokyo+Station&output=embed",
    ],
    ["https://www.google.com/maps/search/Tokyo%20Station", "https://www.google.com/maps?q=Tokyo+Station&output=embed"],
    [
      "https://www.google.com/maps/search/?api=1&query=Tokyo+Station",
      "https://www.google.com/maps?q=Tokyo+Station&output=embed",
    ],
    [
      "https://www.google.com/maps/search/?api=1&query=35.1%2C139.2",
      "https://www.google.com/maps?q=35.1%2C139.2&output=embed",
    ],
    [
      "https://www.google.com/maps/place/Tokyo+Station/@35.1,139.2,15z",
      "https://www.google.com/maps?q=Tokyo+Station&output=embed",
    ],
    ["https://www.google.com/maps/@35.1,139.2,15z", "https://www.google.com/maps?q=35.1%2C139.2&output=embed"],
    ["https://www.google.com/maps/search/C%2B%2B", "https://www.google.com/maps?q=C%2B%2B&output=embed"],
    ["https://www.google.com/maps?q=Tokyo", "https://www.google.com/maps?q=Tokyo&output=embed"],
    ["https://www.google.com/maps/embed?pb=!1m1!1sabc", "https://www.google.com/maps/embed?pb=!1m1!1sabc"],
  ])("converts %s", async (input, output) => {
    expect(await src(googleMaps, input)).toBe(output);
  });
  it("accepts an iframe", () => {
    expect(googleMaps.fromEmbedCode([h("iframe", { src: "https://www.google.com/maps/embed?pb=abc" })], 0)?.url).toBe(
      "https://www.google.com/maps/embed?pb=abc"
    );
  });
  it.each([
    "https://maps.app.goo.gl/abc",
    "https://www.google.com.evil.test/maps?q=x",
    "https://www.google.com/maps/embed/v1/place?key=abc&q=x",
    "https://www.google.com/maps/embed?pb=abc&key=abc",
    "https://www.google.com/maps/search/?api=1&query=starbucks&query_place_id=ChIJsU30zM1qkFQRbnOm1_LBoG0",
    "https://www.google.com/maps/place/",
  ])("rejects %s", async (url) => {
    await rejected(googleMaps, url);
  });
});

describe("Figma and FigJam", () => {
  it.each(["design", "file", "proto", "board", "slides", "deck"])("converts %s", async (kind) => {
    expect(await src(figma, `https://www.figma.com/${kind}/Abc123/Name?node-id=1-2`)).toBe(
      `https://embed.figma.com/${kind === "file" ? "design" : kind}/Abc123?node-id=1-2&embed-host=densanken-blog`
    );
  });
  it("converts a deck iframe", () => {
    expect(
      figma.fromEmbedCode([h("iframe", { src: "https://embed.figma.com/deck/Abc123?embed-host=other" })], 0)?.url
    ).toBe("https://embed.figma.com/deck/Abc123?embed-host=densanken-blog");
  });
  it("converts an iframe of a FigJam board URL", () => {
    expect(
      figma.fromEmbedCode([h("iframe", { src: "https://www.figma.com/board/Abc123/Name?node-id=1-2" })], 0)?.url
    ).toBe("https://embed.figma.com/board/Abc123?node-id=1-2&embed-host=densanken-blog");
  });
  it.each([
    "https://embed.figma.com/design/Abc123?node-id=1-2&embed-host=other",
    "https://www.figma.com/embed?url=https%3A%2F%2Ffigma.com%2Fdesign%2FAbc123&node_id=1-2&embed_host=other",
    "https://www.figma.com/embed?embed_host=other&url=https%3A%2F%2Fwww.figma.com%2Fdesign%2FAbc123%3Fnode-id%3D1-2",
  ])("converts iframe %s", async (input) => {
    const result = figma.fromEmbedCode([h("iframe", { src: input })], 0);
    expect(await src(figma, result!.url)).toBe(
      "https://embed.figma.com/design/Abc123?node-id=1-2&embed-host=densanken-blog"
    );
  });
  it.each([
    "https://figma.com.evil.test/design/Abc123",
    "https://www.figma.com/design/a-b",
    "https://www.figma.com/embed?url=https%3A%2F%2Fwww.figma.com.evil.test%2Fdesign%2Fabc",
  ])("rejects %s", async (url) => {
    await rejected(figma, url);
    expect(figma.fromEmbedCode([h("iframe", { src: url })], 0)).toBeUndefined();
  });
});

it("converts the design and board examples", async () => {
  for (const [embed, url] of [
    [figma, "https://www.figma.com/design/nrPSsILSYjesyc5UHjYYa4/"],
    [figma, "https://www.figma.com/proto/nrPSsILSYjesyc5UHjYYa4/?node-id=5-3&starting-point-node-id=5%3A3"],
    [figma, "https://www.figma.com/board/BAZsTPbh6W1r66Bdo/Example-FigJam-board"],
    [miro, "https://miro.com/app/board/o9J_kkQxX78=/"],
  ] as const) {
    expect(await src(embed, url)).toBeDefined();
  }
  for (const [embed, url] of [
    [figma, "https://embed.figma.com/design/nrPSsILSYjesyc5UHjYYa4?embed-host=figma-embed-docs"],
    [
      figma,
      "https://embed.figma.com/proto/nrPSsILSYjesyc5UHjYYa4?node-id=5-3&starting-point-node-id=5%3A3&embed-host=figma-embed-docs",
    ],
    [figma, "https://embed.figma.com/board/HJZTHA0uFiFUC76W2dv7vn/JSON-mapper"],
    [miro, "https://miro.com/app/live-embed/o9J_kkQxX78=/?moveToViewport=-1000,-1000,2000,2000"],
  ] as const) {
    expect(embed.fromEmbedCode([h("iframe", { src: url })], 0)).toBeDefined();
  }
});

describe("Miro", () => {
  it("converts a board and preserves its query", async () => {
    expect(await src(miro, "https://miro.com/app/board/uXj123=/?moveToWidget=1")).toBe(
      "https://miro.com/app/live-embed/uXj123=/?moveToWidget=1&embedMode=view_only_without_ui"
    );
  });
  it("overrides the iframe mode", async () => {
    const result = miro.fromEmbedCode(
      [h("iframe", { src: "https://miro.com/app/live-embed/uXj123=/?embedMode=edit" })],
      0
    );
    expect(await src(miro, result!.url)).toBe(
      "https://miro.com/app/live-embed/uXj123=/?embedMode=view_only_without_ui"
    );
  });
  it.each([
    "https://miro.com.evil.test/app/board/uXj123=/",
    "https://miro.com/app/board/bad/",
    "https://miro.com/app/board/a%2Fb=/",
  ])("rejects %s", async (url) => {
    await rejected(miro, url);
  });
});
