#!/usr/bin/env bash
# ビルド済みの出力（.output/public）を使って、Discord への通知をローカルで試す
# 使い方: DISCORD_WEBHOOK_URL=... scripts/notify-discord-local.sh [新着として扱う件数（既定は 1）]
# 今回の feed から先頭の記事を除いたものを「前回の feed」とみなし、その記事を新着として送る
set -euo pipefail
cd "$(dirname "$0")/.."
count="${1:-1}"
site=.output/public
if [ ! -f "$site/feed.xml" ]; then
  echo "$site/feed.xml がありません。先に pnpm build を実行してください。" >&2
  exit 1
fi
previous="$(mktemp)"
trap 'rm -f "$previous"' EXIT
node -e '
const fs = require("node:fs");
const [feed, out, count] = process.argv.slice(1);
let xml = fs.readFileSync(feed, "utf8");
for (let i = 0; i < Number(count); i++) xml = xml.replace(/<entry[\s\S]*?<\/entry>/, "");
fs.writeFileSync(out, xml);
' "$site/feed.xml" "$previous" "$count"
node scripts/notify-discord.ts "$previous" "$site/feed.xml"
