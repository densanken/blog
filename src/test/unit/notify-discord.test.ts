import { describe, expect, it, vi } from "vitest";

import { chunk, findNew, notify, parseFeed, send, toEmbed } from "../../../scripts/notify-discord.ts";

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
        image: "",
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
    const embed = toEmbed({ ...parsed!, summary: "あ".repeat(300), image: "https://example.com/i.png" }, "サイト");
    expect(embed).toMatchObject({
      title: "記事 a & <b>",
      url: "https://example.com/a/",
      color: 15630383,
      author: { name: "著者", url: "https://example.com/@me/", icon_url: "https://example.com/me.webp" },
      footer: { text: "サイト・2026年11月8日" },
      image: { url: "https://example.com/i.png" },
    });
    expect(Array.from(embed.description!)).toHaveLength(200);
  });

  it("chunks embeds by ten", () => {
    expect(
      chunk(
        Array.from({ length: 23 }, (_, i) => i),
        10
      ).map((part) => part.length)
    ).toEqual([10, 10, 3]);
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
});
