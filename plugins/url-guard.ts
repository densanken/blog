import { domainToUnicode } from "node:url";

import { siteUrl } from "./site.ts";
import { unicodeTables } from "./unicode-tables.ts";
import { skeleton } from "./unicode.ts";

const japanese = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ーa-z0-9-]+$/iu;
const scriptOf = (character: string) => {
  const { scripts } = unicodeTables();
  const cp = character.codePointAt(0)!;
  let low = 0;
  let high = scripts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const [start, end, script] = scripts[middle]!;
    if (cp < start) high = middle - 1;
    else if (cp > end) low = middle + 1;
    else return ["Han", "Hiragana", "Katakana"].includes(script) ? "Japanese" : script;
  }
};

export const knownDomains = [
  "google.com",
  "github.com",
  "microsoft.com",
  "apple.com",
  "amazon.com",
  "facebook.com",
  "youtube.com",
  "paypal.com",
  "openai.com",
];

export const inspectUrl = (href: string, label = "") => {
  const url = URL.parse(href, siteUrl);
  if (!url || !/^https?:$/.test(url.protocol)) return;
  const ascii = url.hostname;
  // eslint-disable-next-line no-control-regex -- URL と同じ前処理で ASCII の制御文字を扱う
  const input = href.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "").replace(/[\x09\x0a\x0d]/g, "");
  const hasAuthority = /^(?:https?:)?[\\/]{2}/i.test(input) || url.origin !== new URL(siteUrl).origin;
  const authority = hasAuthority ? (/^(?:https?:)?[\\/]*([^\\/?#]*)/i.exec(input)?.[1]?.split("@").at(-1) ?? "") : "";
  let rawHost = authority.replace(/:\d+$/, "");
  try {
    rawHost = decodeURIComponent(rawHost);
  } catch {
    // 不正なエスケープを含む場合は、URL が解釈したホスト名を使う
    rawHost = ascii;
  }
  const variantLatin = Array.from(rawHost).some(
    (character) => !/^[\p{ASCII}]$/u.test(character) && /[a-z]/i.test(character.normalize("NFKC"))
  );
  const unicode = domainToUnicode(ascii);
  const hostWithoutRoot = unicode.endsWith(".") ? unicode.slice(0, -1) : unicode;
  const idn = ascii.split(".").some((part) => part.startsWith("xn--")) || /[^\p{ASCII}]/u.test(rawHost);
  const japaneseDomain = idn && !variantLatin && hostWithoutRoot.split(".").every((part) => japanese.test(part));
  const mixed =
    variantLatin ||
    hostWithoutRoot.split(".").some((part) => {
      const scriptsInLabel = new Set(Array.from(part, scriptOf).filter((script) => script !== undefined));
      return scriptsInLabel.size > 1 && !japanese.test(part);
    });
  const confusable = knownDomains.some((domain) => {
    const suffix = hostWithoutRoot.split(".").slice(-domain.split(".").length).join(".");
    return suffix !== domain && skeleton(suffix) === skeleton(domain);
  });
  const visible = label.trim().split(/\s/u)[0] ?? "";
  const candidate = /^(?:https?:\/\/|(?:(?:\/\/)?[^\s/:?#]+[.。．｡][^\s/:?#]+(?:[/:?#]|$)))/iu.test(visible)
    ? URL.parse(/^(?:https?:)?\/\//i.test(visible) ? visible : `https://${visible}`, siteUrl)
    : null;
  const mismatch = !!candidate && candidate.hostname.replace(/\.$/, "") !== ascii.replace(/\.$/, "");
  return { ascii, display: japaneseDomain ? unicode : ascii, idn, mixed, mismatch, confusable };
};

export const inspectTextUrls = (value: string) => {
  const candidates = new Set<string>();
  for (const [url] of value.matchAll(/https?:[^\s<>"']+?(?=https?:|[\s<>"']|$)/gi)) {
    candidates.add(url);
    // 末尾の記号（強調の * や _、コードの `、括弧、句読点など）を除いた候補も検査する
    candidates.add(url.replace(/[\p{P}\p{S}]+$/u, ""));
  }
  const seen = new Set<string>();
  return [...candidates].flatMap((candidate) => {
    const info = inspectUrl(candidate);
    if (!info || seen.has(info.ascii)) return [];
    seen.add(info.ascii);
    return [info];
  });
};
