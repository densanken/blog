import { isAbsolute, relative, sep } from "node:path";

/* eslint-disable no-console -- 無視した内容を、ビルドのログに残す */

// 無視した内容を、ビルドのログと、GitHub Actions の注釈（PR のチェックに表示される）に出す
// 作者が決められる文字列（ファイル名など）が入るため、ワークフローコマンドの書式（GitHub のエスケープの規則）に従ってエスケープし、ログの行からは制御文字を除く
// eslint-disable-next-line no-control-regex -- 制御文字を除くための正規表現
const controls = /[\u0000-\u001f\u007f]/g;
const data = (value: string) => value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const property = (value: string) => data(value).replace(/:/g, "%3A").replace(/,/g, "%2C");

const report = (message: string, file?: string) => {
  message = message.replaceAll(`${process.cwd()}${sep}`, "");
  const path = file && isAbsolute(file) ? relative(process.cwd(), file) : file;
  console.warn(`[content] ${path ? `${path.replace(controls, " ")}: ` : ""}${message.replace(controls, " ")}`);
  if (process.env.GITHUB_ACTIONS) console.log(`::warning${path ? ` file=${property(path)}` : ""}::${data(message)}`);
};

// 書き手が直せる不備の件数（厳格モード（CONTENT_STRICT=1）では、1 件でもあれば、プロセスの終了コードを非ゼロにする）
// ビルドは止めず、除外して続けることで、1 回のビルドですべての不備を報告する
export const stats = { defects: 0 };

// 不備以外の警告（リンク先の状態など、書き手が直せないもの）
export const warn = report;

// 不備の警告（書き手が直せるもの）
export const defect = (message: string, file?: string) => {
  report(message, file);
  stats.defects++;
  if (process.env.CONTENT_STRICT === "1") process.exitCode = 1;
};
