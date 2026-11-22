// 縦横比（幅 / 高さ）は、数値として検証できたときだけ使う
// 埋め込みコードから求めた値は、URL の hash（`#ratio=1.7778`）で fromUrl に渡す
const hash = /^#ratio=(\d{1,2}(?:\.\d{1,6})?)$/;

const valid = (value: number) => Number.isFinite(value) && value >= 0.2 && value <= 5;

// 属性の文字列を、縦横比（幅 / 高さ）として検証する（inverse が true なら、高さ / 幅の値）
export const parseRatio = (value: string | undefined, inverse = false) => {
  if (!value || !/^\d{1,3}(?:\.\d{1,20})?$/.test(value)) return;
  const number = inverse ? 1 / Number(value) : Number(value);
  return valid(number) ? number : undefined;
};

export const withRatio = (url: string, ratio: number | undefined) =>
  ratio === undefined ? url : `${url}#ratio=${String(Number(ratio.toFixed(4)))}`;

export const ratioOf = ({ hash: value }: URL, fallback: string) => {
  const number = hash.exec(value)?.[1];
  return number !== undefined && valid(Number(number)) ? `${number} / 1` : fallback;
};
