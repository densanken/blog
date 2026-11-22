# blog

Nuxt Content で構築した [CCSブログ](https://blog.densanken.com) です。\
コンテンツは [densanken/blog-contents](https://github.com/densanken/blog-contents) で管理しています。

> [!NOTE]
> コンテンツ側の仕様は [densanken/blog-contents](https://github.com/densanken/blog-contents) の README 等を参照してください。

## 目次

- [クイックスタート（ローカル開発）](#クイックスタート)
- [ディレクトリ構成](#ディレクトリ構成)
- [contents サブモジュールの操作](#contents-サブモジュールの操作)
- [コマンド一覧（開発・テスト・ビルド）](#コマンド一覧開発テストビルド)
- [コンテンツ処理とビルド仕様](#コンテンツ処理とビルド仕様)
- [Markdown 拡張記法・埋め込み仕様](#markdown-拡張記法埋め込み仕様)
- [セキュリティアーキテクチャ](#セキュリティアーキテクチャ)
- [CI/CD とデプロイ運用](#cicd-とデプロイ運用)
- [環境変数](#環境変数)

## クイックスタート

Node.js と pnpm が必要です。\
バージョン管理ツール [mise](https://mise.jdx.dev/) を使うと、指定バージョンの Node.js と pnpm をまとめて導入できます。

```bash
mise trust   # 初回のみ：このリポジトリの設定を信頼する
mise install # .nvmrc と package.json に基づいてツールを導入
```

```bash
# 1. サブモジュール（記事データ）の取得
git submodule update --init --recursive

# 2. 依存パッケージと Playwright Chromium（Mermaid の SVG 変換に必須）の導入
pnpm install
pnpm exec playwright install chromium

# 3. 開発サーバーの起動（http://localhost:3000）
pnpm dev
```

> [!TIP]
>
> - **キャッシュのクリア**: `@nuxt/content` は解析結果を `.data/` にキャッシュします。コミット後の更新日反映や画像の差し替えが反映されない場合は `.data/` を削除してください。
> - **外部アイコンの確認**: `profile.yml` で `https://` 指定されたアイコンは、事前に `pnpm fetch-icons` を実行して `.cache/icons/` に保存しないと `pnpm dev` 上で表示されません。

## ディレクトリ構成

| パス                | 役割                                                                                          |
| :------------------ | :-------------------------------------------------------------------------------------------- |
| `src/`              | ページ、コンポーネント、スタイル（`src/assets/css/main.css`）などのアプリケーション本体       |
| `src/server/`       | フィード生成（`feed.xml.ts`）、サイトマップ API、CSP 注入、プレビュー用バナー処理など         |
| `src/test/`         | テストコード                                                                                  |
| `plugins/`          | Markdown 変換用の remark / rehype プラグイン群、ビルド時通信（`safe-fetch.ts`）、画像検査など |
| `public/`           | 静的配信ファイル（ファビコン、全ページ共通ヘッダー・キャッシュ設定用の `.htaccess` など）     |
| `content.config.ts` | 記事・著者プロフィールの読み込み設定およびスキーマ定義                                        |
| `nuxt.config.ts`    | Nuxt 設定                                                                                     |

## contents サブモジュールの操作

`contents/` は独立した Git リポジトリです。

### `.gitmodules` の変更を同期する

更新を取り込む際は以下を実行してください。

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

## コマンド一覧（開発・テスト・ビルド）

### 開発・プレビュー・ビルド

| コマンド           | 動作内容                                                                                                       |
| :----------------- | :------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`         | 開発サーバー起動（予約投稿も除外せず表示します。Pagefind 検索インデックスはメモリ上に動的生成されます。）      |
| `pnpm build`       | `pnpm fetch-icons` → `pnpm build:site`（SSG + Pagefind 検索インデックス生成）を実行し `.output/public/` に出力 |
| `pnpm generate`    | `nuxt generate` による静的サイト生成（`pnpm build:site` と同等）                                               |
| `pnpm preview`     | ビルド済み静的サイト（`.output/public/`）のローカルプレビュー                                                  |
| `pnpm fetch-icons` | プロフィール `icon` の `https://` 画像を `.cache/icons/` に事前取得                                            |

### 品質チェック・テスト

| コマンド                      | 動作内容                                                    |
| :---------------------------- | :---------------------------------------------------------- |
| `pnpm check`                  | TypeScript 型検査・ESLint・Oxfmt フォーマット検証を一括実行 |
| `pnpm lint`                   | TypeScript 検証 + ESLint 自動修正 + Oxfmt 自動整形          |
| `pnpm lint:check`             | TypeScript 検証 + ESLint 検証                               |
| `pnpm fmt` / `pnpm fmt:check` | Oxfmt によるコード整形 / 検証                               |
| `pnpm typecheck`              | TypeScript の型検証                                         |
| `pnpm test`                   | 単体テスト実行                                              |
| `pnpm test:build`             | ビルド成果物の結合テスト                                    |
| `pnpm test:e2e`               | E2E テスト                                                  |

## コンテンツ処理とビルド仕様

ブログは `contents/authors/<著者ID>/hello.md` を `/@<著者ID>/hello/` として生成します（`contents/README.md` と `meta.yaml` は無視します）。

### 1. ルーティング・予約投稿・更新日

- **URL と大文字小文字**: 著者 ID は大文字小文字を維持し、記事パスは小文字に正規化します。小文字化で重複した場合はコードポイント順で先頭のものを採用し、残りは警告して除外します（先頭が後続検査で落ちても復活しません）。
- **公開判定と予約投稿**: `date`（日本時間）がビルド日より未来の記事は、本番ビルド時に全出力（一覧・フィード・サイトマップ・検索・画像）から除外されます。公開日に反映するには定期再ビルドが必要です。
- **除外されるコンテンツ**:
  - `profile.yaml`（または `.yml`）がない、または `name` が不正な著者の全記事
  - 記事を 1 件も持たない著者の著者ページ
  - 著者ディレクトリ直下の `page/` 配下の Markdown（`/@<著者ID>/page/<番号>` と衝突するため）
  - パスに `.` を含む Markdown（`v1.2.md` など、静的ファイル扱いになりプリレンダリングされないため）
  - 50 万文字を超える記事、不正な YAML / Markdown、シンボリックリンク
- **更新日の算出**: frontmatter に `updated` は使用せず、`contents/` の `git log` から最終コミット日（日本時間）を取得します。`date` より後の場合のみ更新日として画面・OGP・JSON-LD・フィード・サイトマップに反映します。そのため CI では必ず `fetch-depth: 0` と `submodules: true` で取得してください。

### 2. プロフィールとピン留め（`pinned`）

- `content.config.ts` と `plugins/validate-content.ts` で検証します。`name` 不備は著者ごと除外、それ以外の不正フィールドは無視して非表示にします。
- `pinned` は `/@<著者ID>/` 以降のパスを最大 3 件指定可能です（大小文字区別なし）。著者ページ 1 ページ目の先頭、および記事末尾「他の記事」（最大 5 件）で優先表示されます。
- 外部 URL（`https://`）の `icon` は `pnpm fetch-icons` で事前保存したものを検査・WebP 変換して自サイトから配信します。

### 3. 画像パイプライン（`plugins/image-check.ts` / `hosted-images.ts`）

`contents/authors/*/assets/` の原本は公開せず（Exif 等のメタデータ除去のため）、記事から参照されたものだけを検査・変換して `/_cards/<ハッシュ>.webp` から配信します。

- **対応形式**: `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`（SVG / HTML / シンボリックリンクは不可）
- **検査上限**: 10MB 以下、全フレーム合計 5,000 万画素以下、200 フレーム以下、マジックバイトと拡張子の一致、`sharp` での展開成功
- **変換仕様**:
  - 静止画（PNG/JPEG/WebP/AVIF）: 幅 `800px`（1x）と `1600px`（2x）の WebP に再エンコードし、`width` / `height` 属性を自動付与。
  - GIF: 自サイト `assets/` 内の GIF はアニメーション WebP、外部画像の GIF は静止画 WebP に変換。
- **外部画像・リンクカード画像の取得**:
  - 1 記事あたりの本文画像（ローカル画像と外部画像の合計）は 100 件まで。超えた記事は不備として厳格モードで失敗します。
  - 変換幅：本文画像 1600px / サムネイル 480px / ファビコン 32px（ファビコンはラスター → ICO → Google ファビコンサービスの順で取得）

### 4. 文字検査・IDN ガード（`plugins/unicode-data.ts` / `url-guard.ts`）

- **不可視文字の除去・可視化**: 本文・プロフィールの双方向制御文字、ゼロ幅文字、ソフトハイフン等は除去して警告します（絵文字結合の ZWJ や適切な異体字セレクタ等は保持）。コードブロック内の不可視文字は `⟨U+202E⟩` のように可視化して警告します（外部 GitHub / Gist 埋め込みは対象外）。
- **Unicode 辞書キャッシュ**: ビルド時に `confusables.txt` と `Scripts.txt` を取得し、`node_modules/.cache/unicode/<日付>/` に日単位でキャッシュします（取得失敗時は古いキャッシュへフォールバック）。テスト時は `UNICODE_DATA_DIR` を参照します。
- **IDN 警告**: 国際化ドメインのリンクには接続先ホスト名を表示し、`plugins/url-guard.ts` の `knownDomains` との類似や文字体系の混在を検出すると警告を出します。

## Markdown 拡張記法・埋め込み仕様

GFM に加え、以下の独自拡張・プラグイン処理が有効です（記述例は `/@densanken/markdown-syntax-sample` を参照）。

### 独自記法・UI 機能

- **数式**: `$...$` / `$$...$$`（KaTeX でビルド時 HTML 変換）
- **Mermaid**: `mermaid` ブロックを Playwright Chromium で SVG 変換（1 記事 50 件・1 万文字まで。ズーム・ドラッグ・全画面対応）
- **PlantUML**: `plantuml` ブロックを公式サーバーへ送信して SVG 取得・キャッシュ（1 記事 50 件・1 万文字まで。`!` 指示行や外部リンクは禁止）
- **GitHub Alerts**: `> [!NOTE]` 等を `rehype-callouts` で表示
- **絵文字・Lucide アイコン**: `:smile:`（emojilib 2.4.0 準拠）および `:icon{name="rocket" size="base" label="..."}`
- **コードブロック拡張**: Shiki ハイライト、ファイル名 ` ```ts [src/a.ts] `、行強調 `{1,3-4}`、行番号 `showLineNumbers=10`、差分・フォーカスコメント（`// [!code ++]`, `--`, `focus`）、タブグループ化 `tab`
- **インライン色見本**: `#0969DA`、`rgb(...)`、`hsl(...)` のインラインコードにカラーチップを自動付与
- **その他**: h2/h3 からの自動目次（進捗レール付き）、各種 SNS 共有ボタン、「GitHub で編集」リンク、ポップオーバー脚注、読了時間算出（500 文字/分）

### 外部 URL 埋め込みと埋め込みコード変換

- **自動埋め込み**: リンク単独の段落は埋め込みプレーヤー・カードへ置換し、文中の外部リンクを含む段落（本文直下・`details`・引用直下）は段落の直後に埋め込みを追加します（1 記事あたり外部通信を伴う取得は 50 件まで）。
- **埋め込み HTML コードの安全化（`plugins/rehype-embed-code.ts`）**: 各サービス公式の埋め込みコード（`<iframe>` や `<script>` を含むスニペット）をそのまま貼り付けた場合、sanitize 前に ID と縦横比のみを抽出し、サイト独自の安全な `<iframe>` へ再構築します。

<details>
<summary><strong>対応サービス一覧（URL 埋め込み / 埋め込みコード貼付）</strong></summary>

| サービス                                     | URL からの埋め込み | 公式埋め込みコード貼付 | 備考                                             |
| :------------------------------------------- | :----------------: | :--------------------: | :----------------------------------------------- |
| **YouTube** (`watch`, `youtu.be`, `shorts`)  |         ○          |           ○            | `youtube-nocookie.com` を使用                    |
| **X (Twitter)** (`x.com/<user>/status/<id>`) |         ○          |           ○            | 投稿のあるページのみ `widgets.js` 読込           |
| **GitHub ファイル / Gist**                   |         ○          |           ×            | コミット SHA 付きパーマリンク（`#L10-L20` 対応） |
| **Twitch Clips**                             |         ○          |           ×            | `clips.twitch.tv` / `twitch.tv/.../clip/...`     |
| **Speaker Deck / Docswell**                  |         ○          |           ○            | URL 指定時は oEmbed、コード貼付時は直接 iframe   |
| **Google スライド / Google マップ**          |         ○          |           ○            | マップの短縮 URL はリンクのまま表示              |
| **Figma / FigJam / Miro / Canva**            |         ○          |           ○            | Miro は公開ボードのみ表示可                      |
| **CodePen / CodeSandbox**                    |         ○          |           ○            | 高さ 400px 固定                                  |
| **Spotify / Apple Music**                    |         ○          |           ○            | `allow="encrypted-media; fullscreen"` を付与     |
| **上記以外の http(s) URL**                   |         ○          |           -            | OGP タイトル・説明・画像を用いたリンクカード     |

※ サービスの追加・削除は `plugins/embeds/` に `fromUrl` と `fromEmbedCode` を実装したファイルを追加し、`plugins/embeds/index.ts` に登録するだけで完結します。
</details>

## セキュリティアーキテクチャ

`contents/` を信頼しない入力として扱ってください。

- **サニタイズ（`plugins/rehype-sanitize.ts`）**: GitHub 許可リスト + `mark`, `small`, `u`, `abbr`, `figure`, `figcaption`, `a[name]`, `img[width|height]` のみを許可し、`script` / `style` / `iframe` / イベント属性 / `mailto:` 等を除去します（信頼できる独自プラグインは sanitize 後に実行）。HTML の `id` には `user-content-` プレフィックスを付与します。
- **SSRF 対策通信（`plugins/safe-fetch.ts`）**: ビルド時の外部通信は `http(s)` の 80/443 番ポートに限定し、名前解決直前にプライベート・ループバック・リンクローカル IP をブロックします。同時接続 4 件、タイムアウト 15 秒、リダイレクト最大 3 回、種別ごとのレスポンス上限（HTML 1MB、外部画像 5MB、GitHub ファイル 200KB 等）を強制します。
- **シンボリックリンク排除**: CI ビルド前の削除処理に加え、`plugins/content-filter.ts` および `content-hook.ts` の多段階でシンボリックリンクを遮断します。
- **サンドボックス実行**:
  - Mermaid 変換用 Chromium はネットワーク遮断 + サンドボックス有効で起動（`%%{` 指示や frontmatter を含む図はコード表示にフォールバック）。
  - 埋め込み `<iframe>` には `sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"` と `referrerpolicy="strict-origin-when-cross-origin"` を付与。
- **CSP と HTTP ヘッダー**: `src/server/plugins/csp.ts` がページごとのインラインスクリプトハッシュを含む CSP を `<meta>` に注入（`<main>` 内の `script` はビルド失敗扱い）。`public/.htaccess` でも `frame-ancestors 'none'`、`X-Content-Type-Options: nosniff`、`Referrer-Policy` を全応答に付与します。

## CI/CD とデプロイ運用

ビルド手順は `.github/actions/build`（composite action）に集約されており、本リポジトリの `ci.yml` / `deploy.yml` および `blog-contents` の PR チェックから共通利用されます。

### 1. 本番デプロイフロー（`.github/workflows/deploy.yml`）

1. **トリガー**: `main` への push による CI 成功時、または手動実行（`workflow_dispatch` ※予約投稿公開用の定期 cron 等から呼び出し）。
2. **ビルドジョブ（権限: `contents: read` のみ）**: シークレットを一切渡さずにビルドを実行し、成果物（`.output/public`）をアーティファクト化。必須ファイル（`index.html`, `404.html`, `.htaccess`, `robots.txt`, `sitemap.xml`）の欠損や容量超過（**750MB 超で警告、1GB 超で中断**）を検査します。
3. **デプロイジョブ**: GitHub App の短命トークンを用い、`deploy-staging` 経由で GitHub API から**署名付き（Verified）の孤立コミット**を作成して `deploy` ブランチを force 更新します（履歴肥大化防止のため単一コミットで上書き）。ホスティング（Apache）側がこの `deploy` ブランチを自動デプロイします。
4. **Discord 通知（`scripts/notify-discord.ts`）**: 更新前後の `feed.xml` の差分から新規記事を検出し、Discord Bot（または Webhook）で通知します（初回や一度に 10 件超の増加時は誤検知防止のためスキップ）。

<details>
<summary><strong>GitHub リポジトリ / App / Ruleset の初期セットアップ手順</strong></summary>

1. **GitHub App 作成**: Repository permissions に `Contents: Read and write` のみを付与（Webhook 無効）し、本リポジトリにインストール。
2. **Environment 設定 (`production`)**:
   - デプロイ対象ブランチを `main` に制限
   - 変数: `DEPLOY_APP_CLIENT_ID`
   - シークレット: `DEPLOY_APP_PRIVATE_KEY`、および通知用の `DISCORD_BOT_TOKEN` / `DISCORD_CHANNEL_ID`（任意） / `DISCORD_WEBHOOK_URL`（任意）
3. **Ruleset 設定**: `deploy` と `deploy-staging` ブランチに対し、作成・更新・削除・force push の制限を有効化し、Bypass に上記 GitHub App のみを `Always` で追加します（※`deploy-staging` には署名なしコミットを push するため `Require signed commits` は設定しないでください）。
4. **ホスティング連携**: `deploy` ワークフローを 1 回実行してブランチを作成後、デプロイ対象を `deploy` ブランチに設定します。

**公開前の確認チェックリスト（`curl -I` 等で要検証）**

- force 更新後の `.htaccess` 反映と削除ファイルの 404 応答
- 存在しない URL での `404.html`（ステータス 404）返却と `Cache-Control` 挙動
- 末尾スラッシュなし URL から `https://` かつスラッシュ付き URL への 301 リダイレクト
- `index.html` のないディレクトリ（`/page/`, `/_nuxt/`）でファイル一覧（Indexes）が表示されないこと

</details>

### 2. ウイルススキャン（ClamAV）と厳格モード

- **ClamAV スキャン**: 日次キャッシュしたシグネチャを用い、`contents/` → `.cache/icons/` → `.output/public/` の順でスキャンします。通常時は検出ファイルを削除して警告続行、`strict: "true"`（`blog-contents` PR 時）では検出・スキャンエラーともにビルド失敗とします。
- **厳格モード（`CONTENT_STRICT=1`）**: `plugins/warn.ts` の `defect()`（執筆者が修正可能な不備）が 1 件でも呼ばれると、全不備を報告したうえで終了コード非ゼロで失敗します。外部リンク切れ等の `warn()` のみの場合は成功扱いとなります。

### 3. `blog-contents` CI からの呼び出し（プレビュー・検証）

`blog-contents` の PR ワークフローからは、以下のように `.github/actions/build` を呼び出します。`PREVIEW=1` 指定時は予約投稿を含め、全ページに `noindex` とプレビューバナーを挿入し、Cloudflare Workers 用の `_headers` を出力します（`.htaccess` は除外）。

```yaml
- uses: actions/checkout@v4
  with:
    repository: densanken/blog
    ref: main
    fetch-depth: 0
- uses: actions/checkout@v4
  with:
    path: contents
    fetch-depth: 0
- uses: densanken/blog/.github/actions/build@main
  with:
    strict: "true"
    preview: "true"
    site-url: https://pr-12-blog.example.workers.dev
    preview-pr: "12"
- uses: actions/upload-artifact@v4
  with:
    name: preview-site
    path: .output/public
```

## 環境変数

| 変数名                            |  必須  | 説明                                                                                              |
| :-------------------------------- | :----: | :------------------------------------------------------------------------------------------------ |
| `NUXT_PUBLIC_GOOGLE_ANALYTICS_ID` |  任意  | GA4 測定 ID（`G-` 始まり）。未設定時およびプレビュービルド時はタグを出力しません                  |
| `SITE_URL`                        | 条件付 | サイトの正規 URL（既定: `https://blog.densanken.com`）。`PREVIEW=1` の場合は**必須**              |
| `PREVIEW`                         |  任意  | `1` でプレビュービルドを有効化（予約投稿表示・`noindex`・バナー表示・Workers 用 `_headers` 出力） |
| `PREVIEW_PR`                      |  任意  | プレビューバナーに表示する PR 番号（例: `12`）                                                    |
| `CONTENT_STRICT`                  |  任意  | `1` で厳格モードを有効化（書き手起因の不備警告が 1 件でもあると終了コード非ゼロ）                 |
| `UNICODE_DATA_DIR`                |  任意  | Unicode 辞書（`confusables.txt`, `Scripts.txt`）のローカル参照先ディレクトリ（テスト用）          |
