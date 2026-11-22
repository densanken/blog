// 新しく公開された記事を、Discord に通知する（deploy ワークフローが、deploy ブランチの更新後に呼ぶ）
// 使い方: node scripts/notify-discord.ts <前回の feed.xml> <今回の feed.xml>
// シークレットを持つジョブで動かすため、依存のインストールを要さないよう、Node 組み込みの機能だけで書く
import { readFileSync } from "node:fs";

import { stripTags } from "../plugins/strip-tags.ts";

/* eslint-disable no-console -- ワークフローのログと注釈に出す */

export interface Entry {
  id: string;
  link: string;
  title: string;
  summary: string;
  author: string;
  authorUrl: string;
  authorIcon: string;
  published: string;
  image: string;
}
export interface Feed {
  title: string;
  entries: Entry[];
}
export interface Embed {
  title: string;
  url: string;
  description?: string;
  color: number;
  author?: { name: string; url?: string; icon_url?: string };
  footer?: { text: string };
  image?: { url: string };
}

// 一度に増えた記事がこの件数を超えたら、誤検知とみなして通知しない
export const maxNew = 10;
// Discord が 1 メッセージに許す embed の数
export const maxEmbeds = 10;
export const color = 0xee802f;
const descriptionLength = 200;

const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (text: string) =>
  text.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi, (_, dec?: string, hex?: string, name?: string) => {
    if (name) return entities[name.toLowerCase()]!;
    const code = dec ? Number(dec) : Number.parseInt(hex!, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
const unwrap = (text: string) => {
  const trimmed = text.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(trimmed);
  return cdata ? cdata[1]! : decode(trimmed);
};
const text = (block: string, tag: string) => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  return match ? unwrap(match[1]!) : "";
};
const attribute = (tag: string, name: string) => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? decode(match[1]!) : "";
};
// type="html" の文字列は、HTML として解釈されるため、タグを除いて文字参照を戻す
const plain = (html: string) => decode(stripTags(html)).replace(/\s+/g, " ").trim();

// feed.xml.ts が出力する Atom を読む
export const parseFeed = (xml: string): Feed => {
  const entries = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g)].map((match): Entry => {
    const block = match[1]!;
    const links = [...block.matchAll(/<link\s[^>]*>/g)].map((link) => link[0]);
    const alternate = links.find((link) => !attribute(link, "rel") || attribute(link, "rel") === "alternate");
    const enclosure = links.find(
      (link) => attribute(link, "rel") === "enclosure" && attribute(link, "type").startsWith("image/")
    );
    const author = /<author(?:\s[^>]*)?>([\s\S]*?)<\/author>/.exec(block);
    return {
      id: text(block, "id"),
      link: alternate ? attribute(alternate, "href") : "",
      title: plain(text(block, "title")),
      summary: plain(text(block, "summary")),
      author: author ? text(author[1]!, "name") : "",
      authorUrl: author ? text(author[1]!, "uri") : "",
      authorIcon: author ? attribute(/<media:thumbnail\s[^>]*>/.exec(author[1]!)?.[0] ?? "", "url") : "",
      published: text(block, "published"),
      image: enclosure ? attribute(enclosure, "href") : "",
    };
  });
  // entry の外にある title（サイト名）を取る
  return { title: plain(text(xml.replace(/<entry[\s\S]*?<\/entry>/g, ""), "title")), entries };
};

const key = (entry: Entry) => entry.id || entry.link;

// 前回になく、今回にある記事（guid か link で判定する）
export const findNew = (previous: Feed, current: Feed) => {
  const known = new Set(previous.entries.flatMap((entry) => [entry.id, entry.link].filter(Boolean)));
  return current.entries.filter((entry) => key(entry) && !known.has(entry.id) && !known.has(entry.link));
};

const truncate = (value: string, length: number) => {
  const chars = Array.from(
    new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(value),
    ({ segment }) => segment
  );
  return chars.length > length ? `${chars.slice(0, length - 1).join("")}…` : value;
};
const isHttp = (value: string) => /^https?:\/\//.test(value);

// embed の timestamp は時刻まで表示されるため、公開日は JST の日付として footer に書く
const publishedDate = (published: string) =>
  Number.isNaN(Date.parse(published))
    ? ""
    : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "long" }).format(new Date(published));

export const toEmbed = (entry: Entry, siteName: string): Embed => {
  const footer = [siteName, publishedDate(entry.published)].filter(Boolean).join("・");
  return {
    title: truncate(entry.title || entry.link, 256),
    url: entry.link,
    ...(entry.summary && { description: truncate(entry.summary, descriptionLength) }),
    color,
    ...(entry.author && {
      author: {
        name: truncate(entry.author, 256),
        ...(isHttp(entry.authorUrl) && { url: entry.authorUrl }),
        ...(isHttp(entry.authorIcon) && { icon_url: entry.authorIcon }),
      },
    }),
    ...(footer && { footer: { text: truncate(footer, 2048) } }),
    ...(isHttp(entry.image) && { image: { url: entry.image } }),
  };
};

// Discord は 1 メッセージの embed 全体で、title・description・author.name・footer.text の合計を 6000 文字以下に制限する
export const maxEmbedTotal = 6000;
export const embedSize = (embed: Embed) =>
  embed.title.length +
  (embed.description?.length ?? 0) +
  (embed.author?.name.length ?? 0) +
  (embed.footer?.text.length ?? 0);

// 件数（maxEmbeds）と文字数（maxEmbedTotal）の両方が上限に収まるように分割する
export const chunkEmbeds = (embeds: Embed[]) => {
  const parts: Embed[][] = [];
  let total = 0;
  for (const embed of embeds) {
    const size = embedSize(embed);
    const last = parts.at(-1);
    if (last && last.length < maxEmbeds && total + size <= maxEmbedTotal) {
      last.push(embed);
      total += size;
    } else {
      parts.push([embed]);
      total = size;
    }
  }
  return parts;
};

export type Env = Record<string, string | undefined>;

const post = async (url: string, headers: Record<string, string>, embeds: Embed[], fetcher: typeof fetch) => {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    // 記事のタイトルなどにメンションが含まれても、誰にも通知しない
    body: JSON.stringify({ embeds, allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
};

// Bot で送り、失敗したとき（未設定を含む）だけ Webhook で送る、どちらも使えなければ false
export const send = async (embeds: Embed[], env: Env, fetcher: typeof fetch = fetch) => {
  const { DISCORD_BOT_TOKEN: token, DISCORD_CHANNEL_ID: channel, DISCORD_WEBHOOK_URL: webhook } = env;
  if (token && channel && /^\d+$/.test(channel)) {
    try {
      await post(
        `https://discord.com/api/v10/channels/${channel}/messages`,
        { authorization: `Bot ${token}` },
        embeds,
        fetcher
      );
      return true;
    } catch (error) {
      console.warn(`::warning::Discord の Bot での送信に失敗しました（${(error as Error).message}）。`);
    }
  }
  if (webhook) {
    try {
      await post(webhook, {}, embeds, fetcher);
      return true;
    } catch (error) {
      console.warn(`::warning::Discord の Webhook での送信に失敗しました（${(error as Error).message}）。`);
    }
  }
  return false;
};

// 通知の失敗はデプロイの失敗にしない、例外は投げず、結果を文字列で返す
export const notify = async (
  previousXml: string | undefined,
  currentXml: string,
  env: Env,
  fetcher: typeof fetch = fetch
) => {
  if (previousXml === undefined || previousXml.trim() === "") return "skipped: no previous feed";
  const current = parseFeed(currentXml);
  const added = findNew(parseFeed(previousXml), current);
  if (added.length === 0) return "skipped: no new entries";
  if (added.length > maxNew) {
    console.warn(
      `::warning::新しい記事が ${String(added.length)} 件あるため、誤検知とみなして Discord への通知をスキップします。`
    );
    return "skipped: too many new entries";
  }
  const token = env.DISCORD_BOT_TOKEN && env.DISCORD_CHANNEL_ID;
  if (!token && !env.DISCORD_WEBHOOK_URL) return "skipped: Discord is not configured";
  // 古い記事から順に送る
  const embeds = added.reverse().map((entry) => toEmbed(entry, current.title));
  let sent = 0;
  for (const part of chunkEmbeds(embeds)) {
    if (!(await send(part, env, fetcher))) return `failed: sent ${String(sent)} of ${String(embeds.length)}`;
    sent += part.length;
  }
  return `sent ${String(sent)}`;
};

if (import.meta.main) {
  try {
    const [previous, current] = process.argv.slice(2);
    const read = (path?: string) => {
      try {
        return path ? readFileSync(path, "utf8") : undefined;
      } catch {
        return undefined;
      }
    };
    const currentXml = read(current);
    console.log(
      currentXml === undefined ? "skipped: no current feed" : await notify(read(previous), currentXml, process.env)
    );
  } catch (error) {
    console.warn(`::warning::Discord への通知に失敗しました（${(error as Error).message}）。`);
  }
}
