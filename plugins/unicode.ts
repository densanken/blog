import { parseDocument, visit } from "yaml";

import { unicodeTables } from "./unicode-tables.ts";

const variation = (cp: number) => (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);
const tag = (cp: number) => cp >= 0xe0000 && cp <= 0xe007f;
const invisible = (cp: number) =>
  (cp >= 0 && cp <= 8) ||
  (cp >= 11 && cp <= 12) ||
  (cp >= 14 && cp <= 31) ||
  (cp >= 0x7f && cp <= 0x9f) ||
  [0x61c, 0x200e, 0x200f, 0x200b, 0x2060, 0xfeff, 0x180e, 0xad, 0x115f, 0x1160, 0x3164, 0xffa0, 0x2800].includes(cp) ||
  cp === 0x034f ||
  (cp >= 0x2061 && cp <= 0x2064) ||
  (cp >= 0x206a && cp <= 0x206f) ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069);
const joiningScripts = [
  /\p{Script=Arabic}/u,
  /\p{Script=Syriac}/u,
  /\p{Script=Devanagari}/u,
  /\p{Script=Bengali}/u,
  /\p{Script=Gurmukhi}/u,
  /\p{Script=Gujarati}/u,
  /\p{Script=Oriya}/u,
  /\p{Script=Tamil}/u,
  /\p{Script=Telugu}/u,
  /\p{Script=Kannada}/u,
  /\p{Script=Malayalam}/u,
  /\p{Script=Sinhala}/u,
  /\p{Script=Myanmar}/u,
];
const emoji = /\p{Extended_Pictographic}/u;
const base = /[\p{Script=Han}\p{Extended_Pictographic}\p{Script=Hiragana}\p{Script=Katakana}0-9#*]/u;

const cleanCharacters = (chars: string[], code = false) => {
  const kept = Array<boolean>(chars.length).fill(true);
  let changed = false;
  let output = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const cp = ch.codePointAt(0)!;
    if (cp === 0x1f3f4) {
      let end = i + 1;
      while (end < chars.length && chars[end]!.codePointAt(0)! >= 0xe0020 && chars[end]!.codePointAt(0)! <= 0xe007e)
        end++;
      const sequence = chars
        .slice(i + 1, end)
        .map((value) => String.fromCodePoint(value.codePointAt(0)! - 0xe0000))
        .join("");
      if (["gbeng", "gbsct", "gbwls"].includes(sequence) && chars[end]?.codePointAt(0) === 0xe007f) {
        output += chars.slice(i, end + 1).join("");
        i = end;
        continue;
      }
    }
    let bad = invisible(cp) || tag(cp);
    if (cp === 0x200c || cp === 0x200d) {
      const next = chars[i + 1] ?? "";
      let preceding = i - 1;
      while (preceding >= 0 && (/\p{M}/u.test(chars[preceding]!) || /[\u{1f3fb}-\u{1f3ff}]/u.test(chars[preceding]!)))
        preceding--;
      const prior = chars[preceding] ?? "";
      const sameScript = joiningScripts.some((script) => script.test(prior) && script.test(next));
      const chillu = cp === 0x200d && chars[i - 1] === "\u0d4d" && /\p{Script=Malayalam}/u.test(prior);
      bad = code || !((cp === 0x200d && emoji.test(prior) && emoji.test(next)) || sameScript || chillu);
    }
    if (variation(cp)) {
      const prev = chars[i - 1] ?? "";
      bad = variation(prev.codePointAt(0) ?? 0) || !base.test(prev);
    }
    if (bad) {
      changed = true;
      kept[i] = false;
      if (code) output += `⟨U+${cp.toString(16).toUpperCase().padStart(4, "0")}⟩`;
    } else output += ch;
  }
  return { value: output, changed, kept };
};

export const cleanUnicode = (input: string, code = false) => {
  const result = cleanCharacters(Array.from(input), code);
  return { value: result.value, changed: result.changed };
};

export const cleanUrlUnicode = (input: string) => {
  const units: { value: string; raw: string }[] = [];
  for (let i = 0; i < input.length;) {
    const first = input[i] === "%" ? /^%([\da-f]{2})/i.exec(input.slice(i, i + 3)) : null;
    if (first) {
      const byte = Number.parseInt(first[1]!, 16);
      const size =
        byte < 0x80
          ? 1
          : byte >= 0xc2 && byte <= 0xdf
            ? 2
            : byte >= 0xe0 && byte <= 0xef
              ? 3
              : byte >= 0xf0 && byte <= 0xf4
                ? 4
                : 0;
      const raw = input.slice(i, i + size * 3);
      if (size && raw.length === size * 3 && /^(?:%[\da-f]{2})+$/i.test(raw)) {
        try {
          units.push({ value: decodeURIComponent(raw), raw });
          i += raw.length;
          continue;
        } catch {
          // 不正な符号化は元の表記を保持する
        }
      }
    }
    const value = String.fromCodePoint(input.codePointAt(i)!);
    units.push({ value, raw: value });
    i += value.length;
  }
  const result = cleanCharacters(units.map(({ value }) => value));
  return {
    value: units
      .filter((_, index) => result.kept[index])
      .map(({ raw }) => raw)
      .join(""),
    changed: result.changed,
  };
};

export const cleanTextUnicode = (value: string) => {
  const entities = value.replace(
    /&#(?:x([\da-f]+)|(\d+));/gi,
    (entity, hex: string | undefined, decimal: string | undefined) => {
      const cp = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      if (!Number.isFinite(cp) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return entity;
      if (cp === 0x200c || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0000 && cp <= 0xe01ef))
        return entity;
      const character = String.fromCodePoint(cp);
      return cleanUnicode(character).changed ? "" : entity;
    }
  );
  let result = "";
  let offset = 0;
  let changed = entities !== value;
  for (const match of entities.matchAll(/https?:[^\s<>"']+/gi)) {
    const text = cleanUnicode(entities.slice(offset, match.index));
    const url = cleanUrlUnicode(match[0]);
    result += text.value + url.value;
    changed ||= text.changed || url.changed;
    offset = match.index + match[0].length;
  }
  const tail = cleanUnicode(entities.slice(offset));
  return { value: result + tail.value, changed: changed || tail.changed };
};

export const cleanYamlSource = (source: string) => {
  try {
    const document = parseDocument(source, { uniqueKeys: true });
    if (document.errors.length) return { value: source, changed: false };
    const state = { changed: false };
    visit(document, {
      Scalar(_key, node) {
        if (typeof node.value !== "string") return;
        const cleaned = cleanTextUnicode(node.value);
        if (cleaned.changed) {
          node.value = cleaned.value;
          state.changed = true;
        }
      },
    });
    return { value: state.changed ? String(document) : source, changed: state.changed };
  } catch {
    return { value: source, changed: false };
  }
};

export const skeleton = (value: string) =>
  Array.from(value.normalize("NFD"), (ch) => unicodeTables().confusables[ch.codePointAt(0)!.toString(16)] ?? ch)
    .join("")
    .normalize("NFD");
