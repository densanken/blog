import "./mermaid.ts";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import { load } from "cheerio";
import { chromium } from "playwright";
import sharp from "sharp";

import { pinnedPostsLimit, relatedPostsLimit } from "../shared/utils/posts.ts";

const root = process.cwd();
const work = resolve(".cache/blog-test");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
for (const path of [
  "src",
  "plugins",
  "scripts",
  "public",
  "nuxt.config.ts",
  "content.config.ts",
  "package.json",
  "tsconfig.json",
  "eslint.config.mjs",
  "oxfmt.config.ts",
]) {
  cpSync(join(root, path), join(work, path), {
    recursive: true,
    filter: (source) => source !== join(root, "src/test"),
  });
}
cpSync(join(root, "src/test/fixtures/contents"), join(work, "contents"), { recursive: true });
writeFileSync(join(work, "contents/README.md"), "---\ntitle: Root decoy\ndate: 2020-01-01\n---\nRoot decoy\n");
mkdirSync(join(work, "contents/decoy"), { recursive: true });
writeFileSync(join(work, "contents/decoy/profile.yaml"), "name: Root decoy\n");
writeFileSync(join(work, "contents/decoy/post.md"), "---\ntitle: Root decoy\ndate: 2020-01-01\n---\nRoot decoy\n");
mkdirSync(join(work, "contents/authors/writer/assets"), { recursive: true });
mkdirSync(join(work, "contents/authors/other"), { recursive: true });
const image = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: "red" } })
  .png()
  .toBuffer();
writeFileSync(join(work, "contents/authors/writer/assets/valid.png"), image);
writeFileSync(join(work, "contents/authors/writer/assets/unused.png"), image);
mkdirSync(join(work, "contents/authors/other/assets"), { recursive: true });
const secret = await sharp({ create: { width: 31, height: 23, channels: 3, background: "#123456" } })
  .png()
  .toBuffer();
writeFileSync(join(work, "contents/authors/other/assets/secret.png"), secret);
writeFileSync(join(work, "contents/authors/writer/assets/x%2F..%2F..%2F..%2Fother%2Fassets%2Fsecret.png"), image);
const gif = await sharp(Buffer.concat([Buffer.alloc(4 * 4 * 3, 255), Buffer.alloc(4 * 4 * 3, 0)]), {
  raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
})
  .gif({ delay: [100, 200], loop: 0 })
  .toBuffer();
writeFileSync(join(work, "contents/authors/writer/assets/animation.gif"), gif);
writeFileSync(join(work, "contents/authors/writer/assets/fake.png"), "<svg><script/></svg>");
writeFileSync(join(work, "contents/authors/writer/assets/html.png"), "<html>bad</html>");
symlinkSync(
  join(work, "contents/authors/writer/assets/valid.png"),
  join(work, "contents/authors/writer/assets/link.png")
);
const writerPins = [
  "hello",
  "post01",
  "bad-mermaid",
  ...Array.from({ length: pinnedPostsLimit }, (_, index) => `missing${String(index)}`),
];
const writerProfile = readFileSync(join(work, "contents/authors/writer/profile.yaml"), "utf8").replace(
  /pinned:[\s\S]*$/,
  `pinned: [${writerPins.slice(0, pinnedPostsLimit + 1).join(", ")}]\n`
);
writeFileSync(
  join(work, "contents/authors/writer/profile.yaml"),
  `${writerProfile}stem: other/profile\nicon: assets/valid.png\nwebsite: https://blog.densanken.com/_cards/bbbbbbbbbbbbbbbb.webp\n`
);
const otherPins = Array.from({ length: pinnedPostsLimit + 1 }, (_, index) => `post${String(11 + index)}`);
writeFileSync(
  join(work, "contents/authors/other/profile.yaml"),
  `name: Other Author\npinned: [${otherPins.join(", ")}]\n`
);
for (let i = 1; i <= 20; i++) {
  const author = i <= 10 ? "writer" : "other";
  const num = String(i).padStart(2, "0");
  writeFileSync(
    join(work, `contents/authors/${author}/post${num}.md`),
    `---\ntitle: "Post ${num} & <tag>"\ndescription: "Summary & <script>"\ndate: "2020-01-${num}"\nstem: ${author === "writer" ? "other" : "writer"}/post${num}\n---\n\nPost body ${num}\n`
  );
}
for (const slug of ["old1", "old2"]) {
  writeFileSync(
    join(work, `contents/authors/writer/${slug}.md`),
    `---\ntitle: ${slug}\ndate: "2019-01-01"\n---\nOld post\n`
  );
}
mkdirSync(join(work, "contents/authors/allpinned"), { recursive: true });
writeFileSync(join(work, "contents/authors/allpinned/profile.yaml"), "name: All pinned\npinned: [only]\n");
writeFileSync(
  join(work, "contents/authors/allpinned/only.md"),
  '---\ntitle: Only pinned\ndate: "2018-01-01"\n---\nOnly post\n'
);
for (const id of ["empty", "scheduledonly"]) {
  mkdirSync(join(work, `contents/authors/${id}`), { recursive: true });
  writeFileSync(join(work, `contents/authors/${id}/profile.yaml`), `name: ${id}\npinned: [future]\n`);
}
writeFileSync(
  join(work, "contents/authors/scheduledonly/future.md"),
  '---\ntitle: Scheduled only\ndate: "2999-01-01"\n---\nScheduled post\n'
);
writeFileSync(
  join(work, "contents/authors/writer/post03.md"),
  `---\ntitle: HTML-leading excerpt\ndate: "2020-01-03"\ncomputedExcerpt: hostile\narticleContext:\n  excerpt: hostile\n---\n\n<details><summary>Summary</summary>body</details>\n\nPersisted excerpt from body :icon{name="rocket" label="Lucideonlytoken"}\n`
);
writeFileSync(
  join(work, "contents/authors/writer/post02.md"),
  `---\ntitle: Computed excerpt\ndate: "2020-01-02"\n---\n\nExcerpt from body\n\n![local](./assets/valid.png)\n\nhttps://www.youtube.com/watch?v=SX_ViT4Ra7k\n\nhttps://x.com/example/status/123456789\n\n${"Distance before target.\n\n".repeat(600)}## GitHub\n\nFirst heading\n\n## GitHub\n\nSecond heading\n\n${"Extra content to allow scrolling.\n\n".repeat(50)}`
);
writeFileSync(
  join(work, "contents/authors/writer/broken.md"),
  "---\ntitle: [invalid\ndate: 2020-01-01\n---\nBroken Post Fixture\n"
);
writeFileSync(
  join(work, "contents/authors/writer/bad-mermaid.md"),
  `---\ntitle: Bad Mermaid\ndate: "2020-01-01"\n---\n\n\`\`\`mermaid\nnot a diagram\n\`\`\`\n`
);
const fixture = join(work, "contents/authors/writer/hello.md");
// 記事の書き方の例（コードブロックのプレビューとコピーを確認するための、細かい書式を含む）
const writingExample = [
  "<details>",
  "<summary>記事の書き方</summary>",
  "",
  "記事の先頭に `title` と `date` を指定してください。",
  "",
  "```markdown",
  "---",
  "title: はじめての記事",
  "date: 2026-01-01",
  "description: 記事の概要",
  "---",
  "",
  "本文を書いてください。",
  "```",
  "",
  "</details>",
].join("\n");
writeFileSync(
  fixture,
  `${readFileSync(fixture, "utf8")}\n\n${writingExample}\n\n\`\`\`md [empty-preview.md]\n---\ntitle: Empty\n---\n\`\`\`\n`
);
writeFileSync(
  fixture,
  `${readFileSync(fixture, "utf8")}\n\nExample: /_cards/aaaaaaaaaaaaaaaa.webp\n\n\`\`\`js [cached.js] href=https://blog.densanken.com/_cards/cccccccccccccccc.webp\ncode\n\`\`\`\n\n[external](https://example.com/_cards/aaaaaaaaaaaaaaaa.webp)\n\n[cached](/x/../_cards/aaaaaaaaaaaaaaaa.webp)\n\n![cached](/_cards/aaaaaaaaaaaaaaaa.webp)\n\n<picture><source srcset="data:image/svg+xml,unsafe"></picture>\n\n![traversal](./assets/x%2F..%2F..%2F..%2Fother%2Fassets%2Fsecret.png)\n\n![reference][photo]\n\n[photo]: ./assets/valid.png "Reference title"\n\n![local](./assets/valid.png)\n\n![fake](./assets/fake.png)\n\n![html](./assets/html.png)\n\n![link](./assets/link.png)\n\n![remote](https://images.example/ok.png)\n\n<img src="/contents/authors/writer/assets/animation.gif" alt="animated">\n\n<details><summary>[bad](javascript:alert(1)) **safe summary** ![summary-local](./assets/valid.png) ![secret](/contents/authors/other/assets/secret.png)</summary>Body</details>\n\n::evil-component{onclick=alert(1)}\nmalicious component\n::\n\n\`\`\`js [malicious.js] {href=javascript:alert(1)}\ncode\n\`\`\`\n\n\`\`\`mermaid\n%%%%{x}%%{init: {"themeCSS": ".auditMarker {fill: red;}"}}%%\ngraph TD; A-->B\n\`\`\`\n`
);
renameSync(fixture, join(work, "contents/authors/writer/Hello.md"));
symlinkSync(join(root, "node_modules"), join(work, "node_modules"), "dir");
writeFileSync(
  join(work, "src/server/routes/excerpt-test.json.ts"),
  `import { queryCollection } from "@nuxt/content/server";
export default defineEventHandler(async (event) => queryCollection(event, "posts").where("stem", "=", "writer/post03").select("excerpt").first());
`
);
writeFileSync(
  join(work, "src/server/routes/prerender-failure.ts"),
  'export default defineEventHandler(() => { throw createError({ statusCode: 500, statusMessage: "Fixture failure" }); });\n'
);
const feedRoute = join(work, "src/server/routes/feed.xml.ts");
writeFileSync(
  feedRoute,
  readFileSync(feedRoute, "utf8").replace(
    "const items = posts.slice(0, limit);",
    'const items = posts.slice(0, limit); for (const post of items) { if (post.stem === "writer/post10") { post.description = null; post.excerpt = null; } }'
  )
);
const config = join(work, "nuxt.config.ts");
const originalConfig = readFileSync(config, "utf8");
const patchedConfig = originalConfig
  .replace("export default defineNuxtConfig({", 'export default defineNuxtConfig({ buildDir: ".nuxt",')
  .replace("fonts: {", 'fonts: { provider: "local",')
  .replace(
    '"/feed.xml", "/api/intro-post.json"',
    '"/feed.xml", "/api/intro-post.json", "/excerpt-test.json", "/prerender-failure"'
  );
assert.ok(patchedConfig.includes('buildDir: ".nuxt"'));
assert.ok(patchedConfig.includes('fonts: { provider: "local",'));
assert.ok(patchedConfig.includes('"/feed.xml", "/api/intro-post.json", "/excerpt-test.json", "/prerender-failure"'));
writeFileSync(config, patchedConfig);
writeFileSync(
  join(work, "plugins/safe-fetch.ts"),
  `import { readFileSync } from "node:fs";\nexport const safeFetch = async (url) => { if (url === "https://images.example/ok.png") return readFileSync(${JSON.stringify(join(work, "contents/authors/writer/assets/valid.png"))}); if (url.startsWith("https://www.plantuml.com/plantuml/svg/")) return Buffer.from('<svg viewBox="0 0 240 100" width="240" height="100"><rect x="5" y="5" width="230" height="90" style="fill:#fff;stroke:#333"/><text x="30" y="55" style="fill:#000;font-size:18px">Alice → Bob: Hello</text></svg>'); if (url === "https://raw.githubusercontent.com/writer/project/main/example.ts") return Buffer.from('const example = true;\\n'); if (url === "https://api.github.com/gists/abcdef") return Buffer.from(JSON.stringify({ files: { "gist.md": { content: "# Gist preview\\n\\n**Gist bold**\\n\\n> [!NOTE]\\n> Alert NOTE\\n\\n> [!TIP]\\n> Alert TIP\\n\\n> [!IMPORTANT]\\n> Alert IMPORTANT\\n\\n> [!WARNING]\\n> Alert WARNING\\n\\n> [!CAUTION]\\n> Alert CAUTION\\n\\n> [!UNKNOWN]\\n> Alert UNKNOWN\\n" }, "gist.txt": { content: "plain gist\\n" } } })); throw new Error("offline fixture"); };\n`
);
writeFileSync(
  join(work, "plugins/git-updated.ts"),
  'export const lastCommitDate = (_contents, path) => path.endsWith("/post20.md") ? "2020-02-01" : undefined;\n'
);
const run = (command: string, args: string[]) =>
  execFileSync(join(root, "node_modules/.bin", command), args, {
    cwd: work,
    stdio: "inherit",
    env: { ...process.env, CI: "true" },
  });
mkdirSync(join(work, ".output/public"), { recursive: true });
execFileSync(process.execPath, ["scripts/prune-cards.ts"], { cwd: work, stdio: "inherit" });
mkdirSync(join(work, ".data/cards"), { recursive: true });
for (const name of ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"])
  writeFileSync(join(work, `.data/cards/${name}.webp`), "stale");
const siteSettings = join(work, "src/shared/utils/site.ts");
const settings = readFileSync(siteSettings, "utf8");
const settingPattern = /export const introPostStem = [^;]*;/;
assert.match(settings, settingPattern);
for (const stem of ["", "writer/future", "writer/missing"]) {
  writeFileSync(
    siteSettings,
    settings.replace(settingPattern, `export const introPostStem = ${JSON.stringify(stem)};`)
  );
  rmSync(join(work, ".output"), { recursive: true, force: true });
  const generation = spawnSync(join(root, "node_modules/.bin/nuxt"), ["generate"], {
    cwd: work,
    encoding: "utf8",
    env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true" },
  });
  assert.equal(generation.status, 0, `intro generation failed for ${stem}: ${generation.stderr}`);
  if (writerPins.indexOf("bad-mermaid") < pinnedPostsLimit)
    assert.match(
      generation.stdout + generation.stderr,
      /::warning file=contents\/authors\/writer\/profile.yaml::pinned .*bad-mermaid/
    );
  const homePath = join(work, ".output/public/index.html");
  assert.ok(existsSync(homePath), `intro home generation failed for ${stem}: ${generation.stderr}`);
  const page = load(readFileSync(homePath, "utf8"));
  assert.equal(page(".page-heading .site-intro > span").length, 2);
  assert.equal(page(".site-footer .site-intro > span").length, 2);
  assert.equal(page(".site-intro a").length, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(work, ".output/public/api/intro-post.json"), "utf8")), { post: null });
}
writeFileSync(siteSettings, settings.replace(settingPattern, 'export const introPostStem = "writer/HeLLo";'));
rmSync(join(work, ".output"), { recursive: true, force: true });
const generated = spawnSync(join(root, "node_modules/.bin/nuxt"), ["generate"], {
  cwd: work,
  encoding: "utf8",
  env: { ...process.env, CI: "true", GITHUB_ACTIONS: "true" },
});
process.stdout.write(generated.stdout);
process.stderr.write(generated.stderr);
assert.equal(generated.status, 0, "fixture generation failed");
assert.match(
  generated.stdout + generated.stderr,
  /::warning file=contents\/authors\/writer\/bad-mermaid\.md::.*Mermaid/
);
if (writerPins.indexOf("bad-mermaid") < pinnedPostsLimit)
  assert.match(
    generated.stdout + generated.stderr,
    /::warning file=contents\/authors\/writer\/profile.yaml::pinned .*bad-mermaid/
  );
assert.match(generated.stdout + generated.stderr, new RegExp(`pinned の ${String(pinnedPostsLimit)} 件を超える`));
assert.match(generated.stdout + generated.stderr, /プリレンダリングできません: \/prerender-failure.*Fixture failure/);
execFileSync(process.execPath, ["scripts/prune-cards.ts"], { cwd: work, stdio: "inherit" });
run("pagefind", ["--site", ".output/public"]);
execFileSync(process.execPath, [join(root, "src/test/size.ts")], { cwd: work, stdio: "inherit" });
const output = join(work, ".output/public");
for (const name of ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"])
  assert.equal(existsSync(join(output, `_cards/${name}.webp`)), false);
const read = (path: string) => readFileSync(join(output, path), "utf8");
for (const id of ["empty", "scheduledonly"]) {
  const author = JSON.parse(read(`api/author/${id}`)) as { name: string; pinnedStems: string[] };
  assert.equal(author.name, id);
  assert.deepEqual(author.pinnedStems, []);
  const page = load(read(`@${id}/index.html`));
  assert.equal(page("h1").text().trim(), id);
  assert.match(page("main").text(), /記事はまだありません。/);
  assert.equal(existsSync(join(output, `@${id}/future/index.html`)), false);
}
assert.deepEqual(JSON.parse(read("api/intro-post.json")), { post: { title: "Fixture Article", stem: "writer/hello" } });
assert.equal(existsSync(join(output, "prerender-failure/index.html")), false);
const html = read("@writer/hello/index.html");
assert.doesNotMatch(read("@writer/hello/_payload.json"), /console\.log|Footnote explanation/);
assert.doesNotMatch(read("@writer/hello/_payload.json"), /pinned-writer|related-writer/);
const validOtherPins = otherPins.slice(0, pinnedPostsLimit).filter((slug) => Number(slug.slice(4)) <= 20);
const otherRelatedPins = validOtherPins.filter((slug) => slug !== "post20");
const otherRelated = load(read("@other/post20/index.html"));
assert.deepEqual(
  otherRelated(".related-posts li h2 a")
    .toArray()
    .map((link) => link.attribs.href),
  [...otherRelatedPins, ...Array.from({ length: 9 }, (_, index) => `post${String(19 - index)}`)]
    .filter((slug, index, slugs) => slugs.indexOf(slug) === index)
    .slice(0, relatedPostsLimit)
    .map((slug) => `/@other/${slug}/`)
);
assert.equal(
  otherRelated(".related-posts [data-pagefind-ignore]").length,
  Math.min(otherRelatedPins.length, relatedPostsLimit)
);
assert.doesNotMatch(read("@other/post20/_payload.json"), /pinned-other|related-other/);
assert.ok(
  readdirSync(join(output, "__nuxt_island")).some((file) => file.startsWith("PostBody_") && file.endsWith(".json"))
);
const feed = read("feed.xml");
const siteDescription = "CCS（千葉大学電子計算機研究会）のメンバーなどが自由気ままに書くブログです。";
const home = load(read("index.html"));
assert.equal(home('meta[name="description"]').attr("content"), siteDescription);
assert.equal(home('meta[property="og:description"]').attr("content"), siteDescription);
assert.equal(load(feed, { xmlMode: true })("feed > subtitle").text(), siteDescription);
const excerptResult: unknown = JSON.parse(read("excerpt-test.json"));
assert.ok(excerptResult && typeof excerptResult === "object" && "excerpt" in excerptResult);
assert.equal(excerptResult.excerpt, "Persisted excerpt from body");
const post03 = load(read("@writer/post03/index.html"));
assert.equal(post03('meta[property="og:description"]').attr("content"), "Persisted excerpt from body");
const sitemap = read("sitemap.xml");
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
const generatedFiles = files(output);
const katexStyles = generatedFiles.filter(
  (path) => path.endsWith(".css") && readFileSync(path, "utf8").includes("KaTeX_Main")
);
assert.ok(katexStyles.length > 0);
let katexFonts = 0;
for (const path of katexStyles) {
  const css = readFileSync(path, "utf8");
  for (const match of css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)) {
    const url = match[1]!;
    if (!url.includes("KaTeX_")) continue;
    const file = url.startsWith("/") ? join(output, url) : resolve(path, "..", url);
    assert.ok(existsSync(file), url);
    katexFonts++;
  }
}
assert.ok(katexFonts > 0);
const routes = new Map(
  generatedFiles
    .filter((path) => path.endsWith("/index.html"))
    .map((path) => {
      const route = path.slice(output.length, -"index.html".length);
      return [route.toLowerCase(), route];
    })
);
for (const file of generatedFiles) {
  if (file.endsWith("/index.html")) continue;
  const path = file.slice(output.length);
  routes.set(path.toLowerCase(), path);
}
const invalidFixtureLinks = new Set([
  "/x/../_cards/aaaaaaaaaaaaaaaa.webp",
  "https://blog.densanken.com/_cards/bbbbbbbbbbbbbbbb.webp",
  "https://blog.densanken.com/_cards/cccccccccccccccc.webp",
]);
const canonicalLink = (link: string, file: string, allowFixture = false) => {
  if (allowFixture && invalidFixtureLinks.has(link)) return;
  const path = file.startsWith(output) ? file.slice(output.length).replace(/index\.html$/, "") : "/";
  const url = URL.parse(link, `https://blog.densanken.com${path}`);
  if (!url) {
    assert.ok(
      /^[a-z][a-z0-9+.-]*:/i.test(link) && !/^https?:\/\/blog\.densanken\.com(?:[/:?#]|$)/i.test(link),
      `${file}: invalid URL ${link}`
    );
    return;
  }
  if (url.hostname !== "blog.densanken.com") return;
  assert.equal(url.origin, "https://blog.densanken.com", `${file}: noncanonical origin ${link}`);
  const decoded = decodeURIComponent(url.pathname);
  const canonical = routes.get(decoded.toLowerCase());
  assert.equal(decoded, canonical, `${file}: noncanonical or missing URL ${link}`);
  assert.equal(url.pathname, canonical, `${file}: encoded noncanonical URL ${link}`);
  const rawPath = /^https?:\/\//i.test(link) ? /^https?:\/\/[^/]+([^?#]*)/i.exec(link)?.[1] : link.split(/[?#]/)[0];
  if (rawPath)
    assert.doesNotMatch(rawPath, /(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i, `${file}: noncanonical URL ${link}`);
};
for (const file of generatedFiles.filter((path) => path.endsWith(".html"))) {
  const $ = load(readFileSync(file, "utf8"));
  $("[href]").each((_, element) => {
    const link = $(element).attr("href")!;
    const helloFixture =
      file.endsWith("/@writer/hello/index.html") &&
      (link === "/x/../_cards/aaaaaaaaaaaaaaaa.webp" ||
        link === "https://blog.densanken.com/_cards/cccccccccccccccc.webp");
    const profileFixture =
      file.includes("/@writer/") &&
      $(element).closest(".profile-links").length > 0 &&
      link === "https://blog.densanken.com/_cards/bbbbbbbbbbbbbbbb.webp";
    canonicalLink(link, file, element.tagName === "a" && (helloFixture || profileFixture));
  });
  $("[src]").each((_, element) => {
    canonicalLink($(element).attr("src")!, file);
  });
  $("[srcset]").each((_, element) => {
    const srcset = $(element).attr("srcset")!;
    let index = 0;
    while (index < srcset.length) {
      while (index < srcset.length && /[\s,]/.test(srcset[index]!)) index++;
      const start = index;
      while (index < srcset.length && !/\s/.test(srcset[index]!)) index++;
      let url = srcset.slice(start, index);
      const hasTrailingComma = url.endsWith(",");
      if (hasTrailingComma) url = url.replace(/,+$/, "");
      else while (index < srcset.length && srcset[index] !== ",") index++;
      if (url) canonicalLink(url, file);
    }
  });
  $('meta[property="og:url"], meta[property="og:image"]').each((_, element) => {
    const content = $(element).attr("content");
    if (content) canonicalLink(content, file);
  });
}
for (const [file, data] of [
  ["feed.xml", feed],
  ["sitemap.xml", sitemap],
] as const) {
  const $ = load(data, { xmlMode: true });
  $("[href]").each((_, element) => {
    canonicalLink($(element).attr("href")!, file);
  });
  $("loc, entry > id").each((_, element) => {
    canonicalLink($(element).text(), file);
  });
}
for (const file of generatedFiles.filter((path) => path.endsWith(".js") && path.includes("/_nuxt/"))) {
  const script = readFileSync(file, "utf8");
  assert.ok(!script.includes('"1d6c2":'), `confusables table included in client JS: ${file}`);
  assert.ok(!script.includes('"Old_Uyghur"'), `Unicode script table included in client JS: ${file}`);
}

assert.match(html, /Fixture Article/);
assert.match(html, /<div class="mermaid-canvas"><svg[^>]*class="flowchart"/);
assert.equal([...html.matchAll(/<div class="mermaid-canvas">/g)].length, 2);
assert.match(html, /auditMarker/);
for (const [svg] of html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)) assert.doesNotMatch(svg, /auditMarker/);
assert.match(html, /rel="canonical" href="https:\/\/blog\.densanken\.com\/@writer\/hello\/"/);
const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
assert.ok(policy);
const directives = new Map(
  policy.split("; ").map((directive) => {
    const [name = "", ...values] = directive.split(" ");
    return [name, values];
  })
);
assert.deepEqual(directives.get("default-src"), ["'self'"]);
assert.deepEqual(directives.get("object-src"), ["'none'"]);
assert.deepEqual(directives.get("base-uri"), ["'self'"]);
assert.deepEqual(directives.get("form-action"), ["'none'"]);
assert.deepEqual(directives.get("img-src"), [
  "'self'",
  "data:",
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://www.googletagmanager.com",
]);
const hash = (value: string) => `'sha256-${createHash("sha256").update(value).digest("base64")}'`;
const scripts = [
  ...html.matchAll(/<script(?![^>]*\ssrc=)(?![^>]*type="application\/(?:ld\+)?json")[^>]*>([\s\S]*?)<\/script>/g),
].map((match) => hash(match[1] ?? ""));
assert.deepEqual(
  (directives.get("script-src") ?? []).filter((value) => value.startsWith("'sha256-")),
  scripts
);
assert.deepEqual(
  (directives.get("script-src") ?? []).filter((value) => !value.startsWith("'sha256-")),
  ["'self'", "'wasm-unsafe-eval'", "https://platform.twitter.com", "https://www.googletagmanager.com"]
);
assert.deepEqual(directives.get("connect-src"), [
  "'self'",
  "https://*.twitter.com",
  "https://*.twimg.com",
  "https://www.google-analytics.com",
  "https://*.google-analytics.com",
  "https://www.googletagmanager.com",
]);
assert.deepEqual(directives.get("frame-src"), [
  "https://www.youtube-nocookie.com",
  "https://platform.twitter.com",
  "https://syndication.twitter.com",
  "https://speakerdeck.com",
  "https://www.docswell.com",
  "https://docs.google.com",
  "https://www.google.com",
  "https://embed.figma.com",
  "https://www.figma.com",
  "https://miro.com",
  "https://www.canva.com",
  "https://codepen.io",
  "https://codesandbox.io",
  "https://open.spotify.com",
  "https://embed.music.apple.com",
  "https://clips.twitch.tv",
]);
const main = /<main[\s\S]*?<\/main>/.exec(html)?.[0];
assert.ok(main);
assert.doesNotMatch(main, /<script|<source|<picture|data:image\/svg\+xml|src="[^"]*_cards\/aaaaaaaaaaaaaaaa\.webp/i);
assert.doesNotMatch(html, /<(?:img|source)\b[^>]*\b(?:src|srcset|data-src)\s*=\s*["'][^"']*https?:\/\//i);
assert.doesNotMatch(html, /url\(\s*["']?https?:\/\//i);
assert.match(read(".htaccess"), /Header always set X-Content-Type-Options "nosniff"/);
assert.equal(existsSync(join(output, "_headers")), false);
assert.equal(existsSync(join(output, "_og-static-fonts")), false);
assert.equal(existsSync(join(output, "contents")), false);
assert.equal(existsSync(join(output, "@decoy")), false);
assert.equal(existsSync(join(output, "_ipx")), false);
assert.match(html, /_cards\//);
assert.match(html, /href="[^"]*_cards\/aaaaaaaaaaaaaaaa\.webp/);
assert.match(html, /href="[^"]*_cards\/cccccccccccccccc\.webp/);
assert.match(read("@writer/index.html"), /href="[^"]*_cards\/bbbbbbbbbbbbbbbb\.webp/);
const secretHashes = new Set(
  [secret, await sharp(secret).webp({ quality: 80 }).toBuffer()].map((data) =>
    createHash("sha256").update(data).digest("hex")
  )
);
const scan = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path);
    else assert.equal(secretHashes.has(createHash("sha256").update(readFileSync(path)).digest("hex")), false, path);
  }
};
scan(output);
assert.doesNotMatch(html, /(?:fake|html|link)\.png/);
assert.match(html, /srcset=/);
for (const path of [
  "@writer/future/index.html",
  "@invalid/post/index.html",
  "@writer/broken/index.html",
  "@writer/bad-mermaid/index.html",
])
  assert.equal(existsSync(join(output, path)), false);
for (const value of [
  "Scheduled Secret Fixture",
  "Reserved Page Fixture",
  "Invalid Author Fixture",
  "Broken Post Fixture",
]) {
  for (const text of [read("index.html"), html, feed, sitemap]) assert.equal(text.includes(value), false);
}
assert.match(feed, /Fixture Article/);
assert.match(sitemap, /@writer\/hello/);
assert.match(sitemap, /blog\.densanken\.com\/privacy\//);
assert.doesNotMatch(feed, /blog\.densanken\.com\/privacy/);
assert.doesNotMatch(html, /googletagmanager\.com\/gtag\/js/);
const browser = await chromium.launch({ chromiumSandbox: true });
try {
  const page = await browser.newPage();
  const images = await page.evaluate(
    (markup) =>
      [
        ...new DOMParser()
          .parseFromString(markup, "text/html")
          .querySelectorAll<HTMLImageElement>(
            'img[alt="local"], img[alt="remote"], img[alt="animated"], img[alt="reference"]'
          ),
      ].map((image) => ({
        alt: image.alt,
        src: image.getAttribute("src"),
        srcset: image.getAttribute("srcset"),
        zoom: image.getAttribute("data-zoom-src"),
      })),
    html
  );
  assert.equal(images.length, 4);
  const animated = images.find(({ alt }) => alt === "animated");
  assert.ok(animated?.src);
  assert.ok(animated.src.startsWith("/_cards/"));
  const metadata = await sharp(join(output, animated.src.slice(1)), { animated: true }).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.pages, 2);
  assert.deepEqual(metadata.delay, [100, 200]);
  const localImage = images.find(({ alt }) => alt === "local");
  assert.ok(localImage);
  assert.ok(localImage.src);
  assert.ok(localImage.srcset);
  assert.ok(localImage.zoom);
  assert.equal(localImage.srcset, `${localImage.src} 1x, ${localImage.zoom} 2x`);
  assert.notEqual(localImage.src, localImage.zoom);
  assert.equal((await sharp(join(output, localImage.src.slice(1))).metadata()).width, 800);
  assert.equal((await sharp(join(output, localImage.zoom.slice(1))).metadata()).width, 1600);
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(og);
  const ogPath = new URL(og, "https://blog.densanken.com").pathname;
  const ogMetadata = await sharp(join(output, decodeURIComponent(ogPath.slice(1)))).metadata();
  assert.equal(ogMetadata.width, 1200);
  assert.equal(ogMetadata.height, 630);
  const pixels = await sharp(join(output, decodeURIComponent(ogPath.slice(1))))
    .removeAlpha()
    .raw()
    .toBuffer();
  let red = 0;
  for (let y = 480; y < 560; y++)
    for (let x = 70; x < 150; x++) {
      const offset = (y * 1200 + x) * 3;
      if (pixels[offset]! > 200 && pixels[offset + 1]! < 60 && pixels[offset + 2]! < 60) red++;
    }
  assert.ok(red > 500, `OG author icon red pixels: ${String(red)}`);
  for (const image of images) {
    assert.ok(image.src, `${image.alt} has no src`);
    for (const url of [
      image.src,
      image.zoom,
      ...(image.srcset?.split(",").map((part) => part.trim().split(" ")[0]) ?? []),
    ].filter((url): url is string => Boolean(url))) {
      assert.ok(url.startsWith("/_cards/"), url);
      assert.ok(existsSync(join(output, decodeURIComponent(url.slice(1)))), url);
    }
  }
  assert.doesNotMatch(main, /javascript:|evil-component|onclick=|secret.png/i);
  assert.match(feed, /Excerpt from body/);
  assert.match(read("@writer/post02/index.html"), /Excerpt from body/);
  assert.match(main, /safe summary/);
  assert.match(main, /<summary[^>]*>.*?<img[^>]*src="\/_cards\/[^>]*alt="summary-local"/s);
  const entries = await page.evaluate((xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const ns = "http://www.w3.org/2005/Atom";
    return [...doc.getElementsByTagNameNS(ns, "entry")].map((entry) =>
      Object.fromEntries(
        ["id", "title", "summary", "published", "updated"].map((key) => [
          key,
          entry.getElementsByTagNameNS(ns, key)[0]?.textContent,
        ])
      )
    );
  }, feed);
  assert.equal(entries.length, 20);
  assert.equal(entries.find(({ id }) => id?.endsWith("/@writer/post03/"))?.summary, "Persisted excerpt from body");
  const emptySummary = entries.find(({ id }) => id?.endsWith("/@writer/post10/"));
  assert.ok(emptySummary);
  assert.equal(emptySummary.summary, undefined);
  assert.deepEqual(
    entries.map(({ id }) => id),
    [
      ...Array.from({ length: 10 }, (_, index) => `https://blog.densanken.com/@other/post${String(20 - index)}/`),
      ...Array.from(
        { length: 9 },
        (_, index) => `https://blog.densanken.com/@writer/post${String(10 - index).padStart(2, "0")}/`
      ),
      "https://blog.densanken.com/@writer/hello/",
    ]
  );
  assert.equal(entries[0]!.title, "Post 20 &amp; &lt;tag&gt;");
  assert.equal(entries[0]!.summary, "Summary &amp; &lt;script&gt;");
  assert.equal(entries[0]!.id, "https://blog.densanken.com/@other/post20/");
  assert.equal(entries.at(-1)!.id, "https://blog.densanken.com/@writer/hello/");
  assert.equal(entries[0]!.published, "2020-01-19T15:00:00.000Z");
  assert.equal(entries[0]!.updated, "2020-01-31T15:00:00.000Z");
  const locations = await page.evaluate(
    (xml) =>
      [...new DOMParser().parseFromString(xml, "application/xml").getElementsByTagName("url")].map((node) => ({
        loc: node.getElementsByTagName("loc")[0]?.textContent,
        lastmod: node.getElementsByTagName("lastmod")[0]?.textContent,
      })),
    sitemap
  );
  for (const path of ["/page/2/", "/page/3/", "/@writer/page/2/", "/@writer/hello/"])
    assert.ok(locations.some(({ loc }) => loc === `https://blog.densanken.com${path}`));
  assert.ok(!locations.some(({ loc }) => loc?.endsWith("/@other/page/2/")));
  assert.match(locations.find(({ loc }) => loc?.endsWith("/@writer/hello/"))?.lastmod ?? "", /^2020-01-01/);
  assert.match(locations.find(({ loc }) => loc?.endsWith("/@other/post20/"))?.lastmod ?? "", /^2020-02-01/);
  const expectedLocations = [
    "/",
    "/privacy/",
    "/page/2/",
    "/page/3/",
    "/@writer/",
    "/@writer/page/2/",
    "/@other/",
    "/@allpinned/",
    "/@allpinned/only/",
    "/@empty/",
    "/@scheduledonly/",
    "/@writer/old1/",
    "/@writer/old2/",
    "/@writer/hello/",
    ...Array.from(
      { length: 20 },
      (_, index) => `/@${index < 10 ? "writer" : "other"}/post${String(index + 1).padStart(2, "0")}/`
    ),
  ]
    .map((path) => `https://blog.densanken.com${path}`)
    .sort();
  assert.deepEqual(locations.map(({ loc }) => loc).sort(), expectedLocations);
  const listLinks = (path: string) =>
    load(read(path))(".post-list h2 a")
      .toArray()
      .map((link) => link.attribs.href);
  const numbered = (author: string, from: number, to: number) =>
    Array.from({ length: from - to + 1 }, (_, i) => `/@${author}/post${String(from - i).padStart(2, "0")}/`);
  assert.deepEqual(listLinks("index.html"), numbered("other", 20, 11));
  assert.deepEqual(listLinks("page/2/index.html"), [...numbered("writer", 10, 2), "/@writer/hello/"]);
  assert.deepEqual(listLinks("page/3/index.html"), [
    "/@writer/post01/",
    "/@writer/old1/",
    "/@writer/old2/",
    "/@allpinned/only/",
  ]);
  assert.deepEqual(listLinks("@writer/index.html"), [
    ...["/@writer/hello/", "/@writer/post01/"].slice(0, pinnedPostsLimit),
    ...numbered("writer", 10, 2),
    "/@writer/old1/",
  ]);
  assert.deepEqual(listLinks("@writer/page/2/index.html"), ["/@writer/old2/"]);
  assert.deepEqual(listLinks("@other/index.html"), [
    ...validOtherPins.map((slug) => `/@other/${slug}/`),
    ...numbered("other", 20, 11).filter((path) => !validOtherPins.some((slug) => path.endsWith(`/${slug}/`))),
  ]);
  assert.deepEqual(listLinks("@allpinned/index.html"), ["/@allpinned/only/"]);
  assert.doesNotMatch(read("@allpinned/index.html"), /記事はまだありません。|\/@allpinned\/page\/2\//);
  for (const path of ["page/1", "page/4", "page/02", "@writer/page/1", "@writer/page/3", "@other/page/2"])
    assert.equal(existsSync(join(output, path, "index.html")), false);
  assert.match(read("page/2/index.html"), /href="\/page\/3\/"/);
  assert.match(read("@writer/index.html"), /href="\/@writer\/page\/2\/"/);
  for (const xml of [feed, sitemap]) {
    assert.equal(
      await page.evaluate(
        (value) => new DOMParser().parseFromString(value, "application/xml").querySelector("parsererror") === null,
        xml
      ),
      true
    );
  }
} finally {
  await browser.close();
}
process.stdout.write(`Fixture build assertions passed: ${output}\n`);
