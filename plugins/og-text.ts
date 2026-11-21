// OGP 画像に入れる文字列の処理

const grapheme = new Intl.Segmenter("ja", { granularity: "grapheme" });
const word = new Intl.Segmenter("ja", { granularity: "word" });

// アイコンの代わりに入れる頭文字（結合文字や ZWJ の絵文字を壊さないよう、書記素単位で 1 文字取る）
export const ogInitial = (name: string) => grapheme.segment(name)[Symbol.iterator]().next().value?.segment ?? "";

// 全角を 1、半角を 0.5 として幅を数える
const width = (text: string) =>
  Array.from(text).reduce((sum, ch) => sum + (ch.charCodeAt(0) < 0x100 || /[\uff61-\uff9f]/.test(ch) ? 0.5 : 1), 0);

const closing = /^[、。，．）」』】〕〉》！？!?,.)\]}]/;
const opening = /[（「『【〔〈《([{]$/;

const wrap = (text: string, max: number) => {
  const lines: string[] = [];
  let line = "";
  for (const { segment } of word.segment(text)) {
    if (line && width(line + segment) > max && !closing.test(segment)) {
      const open = opening.exec(line);
      if (open && line.length > 1) {
        lines.push(line.slice(0, -open[0].length));
        line = open[0] + segment;
      } else {
        lines.push(line);
        line = segment;
      }
    } else line += segment;
  }
  if (line) lines.push(line);
  return lines;
};

// 文を、語の区切りで max（全角の文字数）以内の行に分ける
// 閉じ括弧と句読点を行頭に、開き括弧を行末に置かない
// maxLines を渡すと、その行数に収まる範囲で、行の幅がなるべくそろう分け方にする
export const ogLines = (text: string, max: number, maxLines?: number) => {
  if (!maxLines) return wrap(text, max);
  for (let limit = Math.ceil(width(text) / maxLines); limit < max; limit++) {
    const lines = wrap(text, limit);
    if (lines.length <= maxLines) return lines;
  }
  return wrap(text, max);
};
