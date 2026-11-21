import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { parseDocument } from "yaml";

import { allowedExtensions, extensionOf } from "./allowed-files.ts";
import { authorsPath } from "./content-paths.ts";
import { duplicateOf, validIdentifier } from "./identifiers.ts";
import { postDate, today } from "./jst.ts";
import { cleanTextUnicode, cleanUnicode, cleanYamlSource, skeleton } from "./unicode.ts";
import { validatePinned } from "./validate-content.ts";
import { defect } from "./warn.ts";

// ビルドに含めないファイルを、contents/ からの相対パス（glob）で求める（content.config.ts の source.exclude に渡す）
// - シンボリックリンク（@nuxt/content と nitro は、シンボリックリンクのディレクトリをたどり、ビルド環境の任意のファイルを読めるため）
// - プロフィール（profile.yaml）がない、または name が不正な著者の、記事とプロフィール
// - 著者 ID に使えない文字（URL の `?` や `#`、空白など）を含むディレクトリ
// - frontmatter や profile.yaml の YAML が不正（構文エラー、キーの重複）な記事とプロフィール（MDC と同じように、ファイル全体を読む）
// - 公開日（date）が日本時間の今日より後の予約投稿（開発サーバーでは除外しない）
// - パスに `.` を含む記事（スラッグが静的ファイルの URL として扱われ、プリレンダリングされないため）
// - `*/page/**`（著者ページのページ送り `/@<著者ID>/page/<番号>` と衝突する）
// また、許可されていない拡張子のファイル（allowed-files.ts）は、警告する（読み込まず、公開もしない）
const maxTextSize = 2 * 1024 * 1024;
const escape = (path: string) => path.replace(/[[\]{}()*?!]/g, "\\$&");

// 通常のファイルだけを、大きさの上限つきで読む（それ以外は null）
export const readText = (path: string) => {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > maxTextSize) return null;
    const text = readFileSync(path, "utf8");
    // BOM は除く
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  } catch {
    return null;
  }
};

// YAML を、構文エラーとキーの重複がなければオブジェクトにする（不正なら null）
const parseYaml = (text: string): Record<string, unknown> | null => {
  try {
    const document = parseDocument(text, { uniqueKeys: true });
    if (document.errors.length) return null;
    const value: unknown = document.toJSON();
    return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
  } catch {
    return null;
  }
};

const profileOf = (dir: string) => {
  for (const file of ["profile.yaml", "profile.yml"]) {
    const path = join(dir, file);
    if (existsSync(path)) {
      const text = readText(path);
      if (text === null) return null;
      const cleanText = cleanTextUnicode(text);
      const cleaned = cleanYamlSource(cleanText.value);
      if (cleanText.changed || cleaned.changed) defect("プロフィールの不可視文字を取り除きました", path);
      return parseYaml(cleaned.value);
    }
  }
  return null;
};

export const validAuthor = (contents: string, name: string) => {
  if (!validIdentifier(name)) return false;
  try {
    if (!lstatSync(join(contents, name)).isDirectory()) return false;
    const profile = profileOf(join(contents, name));
    return typeof profile?.name === "string" && profile.name.length >= 1 && profile.name.length <= 100;
  } catch {
    return false;
  }
};

export const excludedFiles = (contents: string, { scheduled = true }: { scheduled?: boolean } = {}) => {
  const posts = ["*/page/**"];
  const profiles: string[] = [];
  const limit = today();
  // contents/ がない場合（記事を取得していない環境）は、何も除外しない
  const entries = existsSync(contents) ? readdirSync(contents, { withFileTypes: true }) : [];
  const authorIds = new Map<string, string>();
  const authorNames = new Map<string, string>();
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const name = entry.name;
    if (name.startsWith(".")) continue;
    const exclude = (reason: string) => {
      for (const list of [posts, profiles]) list.push(escape(name), `${escape(name)}/**`);
      defect(`${reason}ため、この著者のディレクトリは使いません: ${name}`, `${authorsPath}/${name}`);
    };
    if (entry.isSymbolicLink()) {
      exclude("シンボリックリンクの");
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (!validIdentifier(name)) {
      exclude("著者 ID に使えない文字を含む");
      continue;
    }
    const previousAuthor = duplicateOf(authorIds, name);
    if (previousAuthor !== undefined) {
      exclude(`著者 ID が ${previousAuthor} と重複する`);
      continue;
    }
    const profile = profileOf(join(contents, name));
    if (typeof profile?.name === "string") {
      const shape = skeleton(cleanUnicode(profile.name).value);
      const previous = authorNames.get(shape);
      if (previous !== undefined)
        defect(`表示名が ${previous} と紛らわしいため、確認してください`, `${authorsPath}/${name}/profile.yaml`);
      else authorNames.set(shape, name);
    }
    const dir = join(contents, name);
    const files: string[] = [];
    const scan = (folder: string) => {
      let entries;
      try {
        entries = readdirSync(folder, { withFileTypes: true });
      } catch (error) {
        const path = relative(contents, folder);
        posts.push(escape(path), `${escape(path)}/**`);
        profiles.push(escape(path), `${escape(path)}/**`);
        defect(
          `ディレクトリを読めません: ${path}（${error instanceof Error ? error.message : String(error)}）`,
          `${authorsPath}/${path}`
        );
        return;
      }
      for (const item of entries) {
        if (item.name.startsWith(".")) continue;
        const full = join(folder, item.name);
        const path = relative(dir, full);
        if (cleanUnicode(item.name).changed) {
          posts.push(`${escape(name)}/${escape(path)}`, `${escape(name)}/${escape(path)}/**`);
          profiles.push(`${escape(name)}/${escape(path)}`, `${escape(name)}/${escape(path)}/**`);
          defect(`名前に不可視文字を含むため、使いません: ${name}/${path}`, `${authorsPath}/${name}/${path}`);
          continue;
        }
        if (item.isSymbolicLink()) {
          posts.push(`${escape(name)}/${escape(path)}`, `${escape(name)}/${escape(path)}/**`);
          defect(`シンボリックリンクは使いません: ${name}/${path}`, `${authorsPath}/${name}/${path}`);
        } else if (item.isDirectory()) {
          scan(full);
        } else if (item.isFile()) {
          if (allowedExtensions.has(extensionOf(path))) files.push(path);
          else defect(`許可されていない拡張子のため、無視します: ${name}/${path}`, `${authorsPath}/${name}/${path}`);
        }
      }
    };
    scan(dir);
    const markdown = files.filter((path) => extensionOf(path) === ".md");
    const slugs = new Map<string, string>();
    const duplicates = new Set<string>();
    for (const path of markdown.slice().sort()) {
      const slug = path.slice(0, -extensionOf(path).length);
      if (!slug.split(/[\\/]/).every(validIdentifier)) continue;
      const previous = duplicateOf(slugs, slug, path);
      if (previous !== undefined) {
        duplicates.add(path);
        posts.push(`${escape(name)}/${escape(path)}`);
        defect(
          `記事のパスが ${name}/${previous} と重複するため、公開しません: ${name}/${path}`,
          `${authorsPath}/${name}/${path}`
        );
      }
    }
    if (!validAuthor(contents, name)) {
      posts.push(`${escape(name)}/**`);
      for (const file of ["profile.yaml", "profile.yml"]) profiles.push(`${escape(name)}/${file}`);
      // プロフィールも記事もないディレクトリでは、警告しない
      if (markdown.length || existsSync(join(dir, "profile.yaml")) || existsSync(join(dir, "profile.yml"))) {
        defect(
          `プロフィール（profile.yaml）がない、YAML が不正、または name が不正なため、この著者の記事は公開しません: ${name}`,
          `${authorsPath}/${name}/profile.yaml`
        );
      }
      continue;
    }
    for (const file of ["profile.yaml", "profile.yml"]) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      const text = readText(path);
      if (text === null || parseYaml(text) === null) {
        profiles.push(`${escape(name)}/${file}`);
        defect(`プロフィールの YAML が不正なため、使いません: ${name}/${file}`, `${authorsPath}/${name}/${file}`);
      }
    }
    if (existsSync(join(dir, "profile.yaml")) && existsSync(join(dir, "profile.yml"))) {
      const alternate = `${escape(name)}/profile.yml`;
      if (!profiles.includes(alternate)) profiles.push(alternate);
    }
    for (const path of markdown.sort()) {
      const exclude = (message: string) => {
        posts.push(`${escape(name)}/${escape(path)}`);
        defect(`${message}: ${name}/${path}`, `${authorsPath}/${name}/${path}`);
      };
      if (duplicates.has(path)) continue;
      if (!path.endsWith(".md")) {
        exclude("拡張子は小文字の .md を使ってください");
        continue;
      }
      const slug = path.slice(0, -extensionOf(path).length);
      if (slug.split(/[\\/]/)[0]?.toLowerCase() === "page") {
        exclude("著者ページのページ送りと衝突するため、公開しません");
        continue;
      }
      if (!slug.split(/[\\/]/).every(validIdentifier)) {
        exclude("記事のパスに使えない文字を含むため、公開しません");
        continue;
      }
      const text = readText(join(dir, path));
      if (text === null) {
        exclude("通常のファイルではない、または大きすぎるため、公開しません");
        continue;
      }
      const end = text.startsWith("---") ? text.indexOf("\n---") : -1;
      const frontmatter = end === -1 ? "" : text.slice(4, end - (text[end - 1] === "\r" ? 1 : 0));
      const cleanText = cleanTextUnicode(frontmatter);
      const cleaned = cleanYamlSource(cleanText.value);
      if (cleanText.changed || cleaned.changed)
        defect("frontmatter の不可視文字を取り除きました", `${authorsPath}/${name}/${path}`);
      const data = parseYaml(cleaned.value);
      if (data === null) {
        exclude("frontmatter の YAML が不正なため、公開しません");
        continue;
      }
      if (text.length > 500_000) {
        exclude("記事が大きすぎるため、公開しません");
        continue;
      }
      if (data.date !== undefined && !postDate(data.date)) {
        exclude("date が不正なため、公開しません");
        continue;
      }
      // 予約投稿は、意図した除外なので、警告しない
      if (scheduled && postDate(data.date) > limit) {
        posts.push(`${escape(name)}/${escape(path)}`);
        continue;
      }
    }
    validatePinned(
      profile?.pinned,
      undefined,
      `${authorsPath}/${name}/${existsSync(join(dir, "profile.yaml")) ? "profile.yaml" : "profile.yml"}`
    );
  }
  return { posts, profiles };
};
