// HTML のタグを取り除く
// 取り除いた結果に新しいタグができても残らないよう、変化がなくなるまで繰り返す（1 回の置換だけでは、CodeQL が不完全なサニタイズとして指摘する）
export const stripTags = (value: string) => {
  let previous: string;
  let result = value;
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, "");
  } while (result !== previous);
  return result;
};
