import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  attachLocal,
  chunkEmbeds,
  embedSize,
  findNew,
  notify,
  parseFeed,
  send,
  toEmbed,
} from "../../../scripts/notify-discord.ts";

import type { Embed } from "../../../scripts/notify-discord.ts";

const entry = (slug: string, extra = "") => `
  <entry>
    <title type="html"><![CDATA[記事 ${slug} &amp; &lt;b&gt;]]></title>
    <id>https://example.com/${slug}/</id>
    <link href="https://example.com/${slug}/"/>
    ${extra}
    <summary type="html"><![CDATA[概要 ${slug}]]></summary>
    <author><name>著者</name><uri>https://example.com/@me/</uri><media:thumbnail url="https://example.com/me.webp"/></author>
    <published>2026-11-07T15:00:00.000Z</published>
  </entry>`;
const feed = (...slugs: string[]) =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>https://example.com/</id><title>サイト</title>${slugs.map((slug) => entry(slug)).join("")}</feed>`;
const ok = () => Promise.resolve(new Response("{}", { status: 200 }));
const ng = () => Promise.resolve(new Response("{}", { status: 500 }));

describe("notify discord", () => {
  it("parses entries", () => {
    const parsed = parseFeed(feed("a"));
    expect(parsed.title).toBe("サイト");
    expect(parsed.entries).toEqual([
      {
        id: "https://example.com/a/",
        link: "https://example.com/a/",
        title: "記事 a & <b>",
        summary: "概要 a",
        author: "著者",
        authorUrl: "https://example.com/@me/",
        authorIcon: "https://example.com/me.webp",
        published: "2026-11-07T15:00:00.000Z",
      },
    ]);
  });

  it("finds only new entries", () => {
    expect(findNew(parseFeed(feed("a", "b")), parseFeed(feed("c", "a", "b"))).map(({ link }) => link)).toEqual([
      "https://example.com/c/",
    ]);
  });

  it("builds an embed", () => {
    const [parsed] = parseFeed(feed("a")).entries;
    const embed = toEmbed({ ...parsed!, summary: "あ".repeat(300) }, "サイト");
    expect(embed).toMatchObject({
      title: "記事 a & <b>",
      url: "https://example.com/a/",
      color: 15630383,
      author: { name: "著者", url: "https://example.com/@me/", icon_url: "https://example.com/me.webp" },
      footer: { text: "サイト・2026年11月8日" },
    });
    expect(Array.from(embed.description!)).toHaveLength(200);
  });

  it("chunks embeds by ten", () => {
    const embeds = Array.from({ length: 23 }, () => ({ title: "t", url: "https://example.com", color: 0 }));
    expect(chunkEmbeds(embeds).map((part) => part.length)).toEqual([10, 10, 3]);
  });

  it("chunks embeds so that the total length stays within 6000", () => {
    const embed = { title: "a".repeat(256), description: "b".repeat(200), url: "https://example.com", color: 0 };
    const parts = chunkEmbeds(Array.from({ length: 10 }, () => embed));
    expect(parts.map((part) => part.length)).toEqual([10]);
    const big = { ...embed, author: { name: "c".repeat(256) }, footer: { text: "d".repeat(400) } };
    const split = chunkEmbeds(Array.from({ length: 10 }, () => big));
    expect(split.length).toBeGreaterThan(1);
    for (const part of split) expect(part.reduce((sum, e) => sum + embedSize(e), 0)).toBeLessThanOrEqual(6000);
    expect(split.flat()).toHaveLength(10);
  });

  it("skips without a previous feed, with no change, or with too many entries", async () => {
    const fetcher = vi.fn(ok);
    const env = { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/x" };
    expect(await notify(undefined, feed("a"), env, fetcher)).toMatch(/no previous/);
    expect(await notify(feed("a"), feed("a"), env, fetcher)).toMatch(/no new/);
    expect(
      await notify(feed("a"), feed("a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"), env, fetcher)
    ).toMatch(/too many/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("skips when not configured", async () => {
    const fetcher = vi.fn(ok);
    expect(await notify(feed("a"), feed("b", "a"), {}, fetcher)).toMatch(/not configured/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends with the bot and does not use the webhook on success", async () => {
    const fetcher = vi.fn(ok);
    const env = {
      DISCORD_BOT_TOKEN: "t",
      DISCORD_CHANNEL_ID: "123",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/x",
    };
    expect(await notify(feed("a"), feed("b", "a"), env, fetcher)).toBe("sent 1");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://discord.com/api/v10/channels/123/messages");
    expect((init.headers as Record<string, string>).authorization).toBe("Bot t");
    expect((JSON.parse(init.body as string) as { allowed_mentions: unknown }).allowed_mentions).toEqual({ parse: [] });
  });

  it("falls back to the webhook when the bot fails or is missing", async () => {
    const webhook = "https://discord.com/api/webhooks/1/x";
    const fetcher = vi.fn((url: string) => (url.includes("/channels/") ? ng() : ok()));
    const env = { DISCORD_BOT_TOKEN: "t", DISCORD_CHANNEL_ID: "123", DISCORD_WEBHOOK_URL: webhook };
    expect(await send([], env, fetcher as typeof fetch)).toBe(true);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://discord.com/api/v10/channels/123/messages`,
      webhook,
    ]);
    const only = vi.fn(ok);
    expect(await send([], { DISCORD_WEBHOOK_URL: webhook }, only)).toBe(true);
    expect(only).toHaveBeenCalledTimes(1);
  });

  it("returns a failure without throwing when every destination fails", async () => {
    const env = { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/x" };
    expect(await notify(feed("a"), feed("b", "a"), env, ng)).toMatch(/^failed/);
  });
  it("attaches icons found in the output and keeps the URL of the others", () => {
    const dir = mkdtempSync(join(tmpdir(), "notify-"));
    try {
      writeFileSync(join(dir, "me.webp"), "icon");
      const base = toEmbed(parseFeed(feed("a")).entries[0]!, "サイト");
      const withIcon = (icon_url: string): Embed => ({ ...base, author: { name: "著者", icon_url } });
      const { embeds, files } = attachLocal(
        [
          withIcon("https://example.com/me.webp"),
          withIcon("https://example.com/me.webp"),
          withIcon("https://other.example/me.webp"),
          withIcon("https://example.com/../etc/passwd"),
        ],
        dir
      );
      // 同じアイコンは 1 つのファイルを共有する
      expect(embeds.map((embed) => embed.author?.icon_url)).toEqual([
        "attachment://0.webp",
        "attachment://0.webp",
        "https://other.example/me.webp",
        "https://example.com/../etc/passwd",
      ]);
      expect(files.map((used) => used.map(({ name }) => name))).toEqual([["0.webp"], ["0.webp"], [], []]);
      expect(files[0]![0]).toBe(files[1]![0]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("splits messages by the number and the total size of attachments", () => {
    const base = toEmbed(parseFeed(feed("a")).entries[0]!, "サイト");
    const embeds = Array.from({ length: 6 }, () => base);
    const file = (name: string, size = 1) => ({ name, data: Buffer.alloc(size) });
    // 6 件それぞれが別の添付を 2 つ持つと、10 件までの添付に収まるよう 5 件ごとに分かれる
    const many = embeds.map((_, i) => [file(`${String(i)}a`), file(`${String(i)}b`)]);
    expect(chunkEmbeds(embeds, many).map((part) => part.length)).toEqual([5, 1]);
    // 共通の添付は 1 つと数える
    const shared = file("icon");
    expect(
      chunkEmbeds(
        embeds,
        embeds.map(() => [shared])
      ).map((part) => part.length)
    ).toEqual([6]);
    // 合計の大きさが上限を超える分は、次のメッセージに回る
    const big = embeds.map((_, i) => [file(String(i), 8 * 1024 * 1024)]);
    expect(chunkEmbeds(embeds, big).map((part) => part.length)).toEqual([2, 2, 2]);
  });

  it("sends multipart when files are attached", async () => {
    const fetcher = vi.fn(ok);
    const files = [{ name: "0.webp", data: Buffer.from("icon") }];
    expect(await send([], { DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/x" }, fetcher, files)).toBe(true);
    const [, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("files[0]")).toBeInstanceOf(Blob);
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });
});
