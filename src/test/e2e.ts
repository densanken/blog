import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";

import { chromium } from "playwright";

import { pinnedPostsLimit, relatedPostsLimit } from "../shared/utils/posts.ts";

import type { IncomingMessage, ServerResponse } from "node:http";

const root = resolve(".cache/blog-test/.output/public");
const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".webp": "image/webp",
  ".xml": "application/xml",
};
const serve = async (req: IncomingMessage, res: ServerResponse) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;
    const path = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (path !== root && !path.startsWith(`${root}${sep}`)) throw new Error("invalid path");
    let current = root;
    for (const part of path.slice(root.length).split(sep).filter(Boolean)) {
      if (!(await readdir(current)).includes(part)) throw new Error("path case mismatch");
      current = join(current, part);
    }
    // 配信する Apache と同じく、ディレクトリの URL は、末尾のスラッシュつきへリダイレクトする
    const directory = (await stat(path)).isDirectory();
    if (directory && !pathname.endsWith("/")) {
      res.writeHead(301, { location: `${pathname}/${url.search}` }).end();
      return;
    }
    const file = directory ? join(path, "index.html") : path;
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "content-type": "text/html" }).end(await readFile(join(root, "404.html")));
  }
};
const server = createServer((req, res) => {
  void serve(req, res);
});
const deadline = setTimeout(() => {
  process.stderr.write("Browser test deadline exceeded\n");
  process.exit(1);
}, 120_000);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const origin = `http://127.0.0.1:${String(address.port)}`;
const redirect = await fetch(`${origin}/privacy?x=1`, { redirect: "manual" });
assert.equal(redirect.status, 301);
assert.equal(redirect.headers.get("location"), "/privacy/?x=1");
assert.equal((await fetch(`${origin}/@WRITER/hello/`)).status, 404);
assert.equal((await fetch(`${origin}/@writer/HELLO/`)).status, 404);
const writerAuthor = (await (await fetch(`${origin}/api/author/writer`)).json()) as { pinnedStems: string[] };
assert.deepEqual(writerAuthor.pinnedStems, ["writer/hello", "writer/post01"]);
const allPinnedAuthor = (await (await fetch(`${origin}/api/author/allpinned`)).json()) as { pinnedStems: string[] };
assert.deepEqual(allPinnedAuthor.pinnedStems, ["allpinned/only"]);
const twitterMock =
  'document.querySelectorAll("blockquote.twitter-tweet").forEach((quote) => { quote.closest(".twitter-embed").dataset.autoScanned = "true"; }); window.twttr = { widgets: { load: (root) => { const embeds = root.matches?.(".twitter-embed") ? [root] : root.querySelectorAll(".twitter-embed"); for (const element of embeds) { if (!element.querySelector("blockquote.twitter-tweet")) continue; element.dataset.twitterAttempts = String(Number(element.dataset.twitterAttempts || 0) + 1); if (!element.closest("details:not([open])")) element.dataset.twitterLoaded = "true"; } } } };';
let browser;
try {
  browser = await chromium.launch({ chromiumSandbox: true });
  const notFoundPage = await browser.newPage();
  const notFoundResponse = await notFoundPage.goto(`${origin}/missing-page`);
  assert.equal(notFoundResponse?.status(), 404);
  const introLink = notFoundPage.locator('.site-footer .site-intro a[href="/@writer/hello/"]');
  await introLink.waitFor({ state: "visible" });
  assert.equal(await introLink.textContent(), "Fixture Article");
  assert.equal(await notFoundPage.locator('.footer-links a[href="/"]').count(), 0);
  await notFoundPage.close();
  const navigation = await browser.newPage();
  await navigation.goto(`${origin}/`);
  await navigation.evaluate(() => {
    document.documentElement.dataset.spaCheck = "yes";
  });
  await navigation.locator('main a.author-link[href="/@other/"]').first().click();
  await navigation.waitForURL(/\/@other\/$/);
  await navigation.locator('.suggested-posts a[href="/@other/post11/"]').waitFor();
  assert.equal(await navigation.evaluate(() => document.documentElement.dataset.spaCheck), "yes");
  assert.equal(await navigation.locator('main a[href="/@other/post11/"]').count(), 1);
  await navigation.close();
  const fallback = await browser.newPage();
  await fallback.goto(`${origin}/privacy/`);
  await fallback.waitForFunction(() => "__vue_app__" in document.querySelector("#__nuxt")!);
  let authorRequested = false;
  fallback.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/author/other") authorRequested = true;
  });
  await fallback.evaluate(() => {
    const app = document.querySelector<
      HTMLElement & {
        __vue_app__: {
          config: {
            globalProperties: { $router: { push: (url: string) => void } };
          };
        };
      }
    >("#__nuxt")!.__vue_app__;
    app.config.globalProperties.$router.push("/@other/page/2/");
  });
  await fallback.getByRole("heading", { name: "ページが見つかりません" }).waitFor();
  assert.equal(authorRequested, true);
  const errorMessage = await fallback.evaluate(() => {
    const app = document.querySelector<
      HTMLElement & {
        __vue_app__: {
          config: {
            globalProperties: {
              $nuxt: { payload: { error: { statusText: string } } };
            };
          };
        };
      }
    >("#__nuxt")!.__vue_app__;
    return app.config.globalProperties.$nuxt.payload.error.statusText;
  });
  assert.equal(errorMessage, "Page not found");
  await fallback.close();
  for (const id of ["empty", "scheduledonly"]) {
    const page = await browser.newPage();
    const direct = await page.goto(`${origin}/@${id}/`);
    assert.equal(direct?.status(), 200);
    await page.getByRole("heading", { name: id }).waitFor();
    assert.equal(await page.getByText("記事はまだありません。").count(), 1);
    await page.goto(`${origin}/privacy/`);
    await page.waitForFunction(() => "__vue_app__" in document.querySelector("#__nuxt")!);
    await page.route("**/_payload.json*", (route) => route.fulfill({ status: 404, body: "" }));
    let apiRequested = false;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === `/api/author/${id}`) apiRequested = true;
    });
    await page.evaluate((target) => {
      document.documentElement.dataset.spaCheck = "yes";
      const app = document.querySelector<
        HTMLElement & {
          __vue_app__: {
            config: {
              globalProperties: { $router: { push: (url: string) => void } };
            };
          };
        }
      >("#__nuxt")!.__vue_app__;
      app.config.globalProperties.$router.push(`/@${target}`);
    }, id);
    await page.getByRole("heading", { name: id }).waitFor();
    assert.equal(await page.getByText("記事はまだありません。").count(), 1);
    assert.equal(apiRequested, true);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.spaCheck), "yes");
    await page.close();
  }
  await mkdir(".cache/screenshots", { recursive: true });
  for (const width of [1440, 375]) {
    for (const theme of ["light", "dark"] as const) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        reducedMotion: "reduce",
      });
      // 実際の X のウィジェットが埋め込みの blockquote を置き換えないようにする
      await context.route(/^https:\/\/platform\.(?:twitter|x)\.com\//, (route) => route.abort());
      const page = await context.newPage();
      await page.goto(`${origin}/@writer/`);
      assert.deepEqual(
        await page.locator(".post-list").first().locator("h2 a").allTextContents(),
        ["Fixture Article", "Post 01 & <tag>"].slice(0, pinnedPostsLimit)
      );
      assert.equal(
        await page.locator(".post-list").first().getByText("ピン留め").count(),
        Math.min(pinnedPostsLimit, 2)
      );
      assert.equal(await page.locator(".post-list").nth(1).getByText("ピン留め").count(), 0);
      assert.equal(await page.locator(".post-list").nth(1).locator('a[href="/@writer/hello/"]').count(), 0);
      const pinnedDate = await page.locator(".post-list").first().locator("time").first().boundingBox();
      const regularDate = await page.locator(".post-list").nth(1).locator("time").first().boundingBox();
      const label = await page.locator(".post-label").first().boundingBox();
      assert.ok(
        pinnedDate &&
          regularDate &&
          label &&
          Math.abs(pinnedDate.x - regularDate.x) < 1 &&
          label.y + label.height <= pinnedDate.y
      );
      await page.locator("main").screenshot({
        path: `.cache/screenshots/pinned-author-${String(width)}-${theme}.png`,
      });
      if (width === 1440 && theme === "light") {
        await page.evaluate(() => {
          document.documentElement.dataset.spaCheck = "yes";
        });
        await page.locator('a[href="/@writer/page/2/"]').first().click();
        await page.waitForURL(/\/@writer\/page\/2\/$/);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.spaCheck), "yes");
        assert.deepEqual(await page.locator("main .post-list h2 a").allTextContents(), ["old2"]);
        await page.goBack();
        await page.waitForURL(/\/@writer\/$/);
        await page.locator('main a[href="/@writer/hello/"]').waitFor();
        assert.equal(await page.locator('main a[href="/@writer/hello/"]').count(), 1);
        assert.equal(await page.locator('main a[href="/@writer/post01/"]').count(), 1);
        await page.locator(".suggested-posts a").first().click();
        await page.waitForURL(/\/@writer\/hello\/$/);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.spaCheck), "yes");
      }
      await page.goto(`${origin}/@writer/page/2/`);
      assert.equal(await page.getByText("ピン留め").count(), 0);
      assert.equal(await page.locator('main a[href="/@writer/hello/"], main a[href="/@writer/post01/"]').count(), 0);
      await page.goto(`${origin}/@writer/hello/`);
      const related = page.locator(".related-posts");
      const relatedLabel = await related.locator(".post-label").first().boundingBox();
      const relatedPinnedDate = await related.locator("li").first().locator("time").boundingBox();
      const relatedDate = await related.locator("li").nth(1).locator("time").boundingBox();
      assert.ok(
        relatedLabel &&
          relatedPinnedDate &&
          relatedDate &&
          relatedLabel.y + relatedLabel.height <= relatedPinnedDate.y &&
          Math.abs(relatedPinnedDate.x - relatedDate.x) < 1
      );
      assert.equal(
        await related.getByText("ピン留め").count(),
        Math.min(Math.max(pinnedPostsLimit - 1, 0), relatedPostsLimit, 1)
      );
      assert.deepEqual(
        await related.locator("li h2 a").evaluateAll((links) => links.map((link) => link.getAttribute("href"))),
        [
          ...["/@writer/post01/"].slice(0, Math.max(pinnedPostsLimit - 1, 0)),
          ...Array.from({ length: 10 }, (_, index) => `/@writer/post${String(10 - index).padStart(2, "0")}/`),
        ]
          .filter((path, index, paths) => paths.indexOf(path) === index)
          .slice(0, relatedPostsLimit)
      );
      const headingLayout = await related.locator(".related-heading").evaluate((element) => {
        const heading = element.querySelector("h2")!.getBoundingClientRect();
        const link = element.querySelector("a")!.getBoundingClientRect();
        return {
          sameRow: heading.top < link.bottom && link.top < heading.bottom,
          ordered: heading.right <= link.left,
        };
      });
      assert.ok(headingLayout.sameRow && headingLayout.ordered);
      assert.equal(await related.getByRole("link", { name: "記事一覧" }).getAttribute("href"), "/");
      const footer = page.locator(".site-footer .site-intro");
      const footerLayout = await footer.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const parentElement = element.parentElement!;
        const parent = parentElement.getBoundingClientRect();
        const style = getComputedStyle(parentElement);
        const center =
          (parent.left + Number.parseFloat(style.paddingLeft) + parent.right - Number.parseFloat(style.paddingRight)) /
          2;
        return {
          align: getComputedStyle(element).textAlign,
          offset: Math.abs((rect.left + rect.right) / 2 - center),
        };
      });
      assert.equal(footerLayout.align, "left");
      assert.ok(footerLayout.offset < 1);
      const github = page.locator(".code-block").filter({ hasText: "writer/project/example.ts" });
      assert.equal(await github.locator(".github-embed-icon[aria-hidden=true]").count(), 1);
      assert.equal(
        await page.locator(".code-block").filter({ hasText: "fake.ts" }).locator(".github-embed-icon").count(),
        0
      );
      const gist = page.locator(".code-block").filter({ hasText: "gist.md" });
      for (const block of [github, gist]) {
        const alignment = await block.locator(".github-embed-icon").evaluate((icon) => {
          const text = icon.parentElement!.querySelector(".code-filename-text")!;
          const iconRect = icon.getBoundingClientRect();
          const textRect = text.getBoundingClientRect();
          return {
            delta: Math.abs((iconRect.top + iconRect.bottom - textRect.top - textRect.bottom) / 2),
            left: iconRect.right <= textRect.left,
          };
        });
        assert.ok(alignment.left && alignment.delta < 2);
      }
      // 長い接続先と警告が折り返す場合もロゴはファイル名の行に残る
      const wrappedAlignment = await github.locator(".code-filename").evaluate((original) => {
        const clone = original.cloneNode(true) as HTMLElement;
        clone.style.width = "180px";
        const link = clone.querySelector("a")!;
        const host = document.createElement("span");
        host.className = "url-host";
        host.textContent = " (a-very-long-host.example)";
        const warning = document.createElement("strong");
        warning.className = "url-warning";
        warning.textContent = " ⚠ 接続先に注意";
        link.append(host, warning);
        original.after(clone);
        const icon = clone.querySelector(".github-embed-icon")!.getBoundingClientRect();
        const name = clone.querySelector(".code-filename-text")!.getBoundingClientRect();
        const wrapped = warning.getBoundingClientRect().top > name.top;
        clone.remove();
        return {
          delta: Math.abs((icon.top + icon.bottom - name.top - name.bottom) / 2),
          wrapped,
        };
      });
      assert.ok(wrappedAlignment.wrapped && wrappedAlignment.delta < 2);
      const iconSizes = page
        .locator(".prose")
        .locator("p")
        .filter({ hasText: /^Icon (xs|sm|base|lg|xl|2xl):/ });
      assert.equal(await iconSizes.count(), 6);
      for (const icon of await iconSizes.locator(".lucide-inline").all()) {
        const delta = await icon.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element.previousSibling!);
          const text = range.getBoundingClientRect();
          const box = element.getBoundingClientRect();
          return Math.abs((box.top + box.bottom - text.top - text.bottom) / 2);
        });
        assert.ok(delta < 3, `icon center differs by ${String(delta)}px`);
      }
      const plant = page.locator('.mermaid:has(svg[id^="mermaid-plantuml"])');
      assert.equal(await plant.count(), 1);
      assert.equal(await page.locator('.twitter-embed a[href="https://twitter.com/user/status/555"]').count(), 1);
      for (const [name, target] of [
        ["github", github],
        ["gist", gist],
        ["icons", page.locator(".prose").locator("p").filter({ hasText: "Icon 2xl:" })],
        ["plantuml", plant],
        ["footer", page.locator(".site-footer")],
      ] as const) {
        await target.evaluate((element) => {
          element.scrollIntoView({ behavior: "instant", block: "center" });
        });
        await target.screenshot({
          path: `.cache/screenshots/${name}-${String(width)}-${theme}.png`,
          animations: "disabled",
        });
      }
      const icon = page.locator(".prose p").filter({ hasText: "Icon fixture" }).locator("svg").first();
      assert.equal(await icon.isVisible(), true);
      const dimensions = await icon.evaluate((element) => ({
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
        fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        stroke: getComputedStyle(element).stroke,
        color: getComputedStyle(element).color,
      }));
      assert.ok(Math.abs(dimensions.width - dimensions.fontSize) < 0.1);
      assert.ok(Math.abs(dimensions.height - dimensions.fontSize) < 0.1);
      assert.equal(dimensions.stroke, dimensions.color);
      assert.equal(await page.locator("#icon-heading .lucide-inline").count(), 1);
      if (width === 1440) {
        const link = page.locator('.toc-panel a[href="#icon-heading"]');
        assert.equal((await link.innerText()).trim(), "Icon heading");
        assert.equal(await link.locator('svg[aria-hidden="true"]').count(), 1);
      }
      await related.evaluate((element) => {
        window.scrollTo({
          top: element.getBoundingClientRect().top + window.scrollY - 120,
          behavior: "instant",
        });
      });
      await page.waitForTimeout(500);
      await related.screenshot({
        path: `.cache/screenshots/pinned-related-${String(width)}-${theme}.png`,
      });
      await context.close();
    }
  }
  for (const scale of [1, 2, 3]) {
    const imageContext = await browser.newContext({ deviceScaleFactor: scale });
    const imagePage = await imageContext.newPage();
    await imagePage.goto(origin);
    const image = imagePage.locator(".site-title img");
    assert.equal(
      await image.evaluate((element) => {
        const img = element as HTMLImageElement;
        return img.complete && img.naturalWidth > 0;
      }),
      true
    );
    assert.equal(
      await image.evaluate((element) => (element as HTMLImageElement).currentSrc),
      `${origin}/ccsko-${String(32 * scale)}.webp`
    );
    await imageContext.close();
  }
  const intro = "CCS のメンバーなどが自由気ままに書くブログです。投稿はメンバーと OB/OG に限ります。";
  for (const width of [1440, 375]) {
    const headerContext = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const headerPage = await headerContext.newPage();
    for (const path of ["/", "/@writer/hello/"]) {
      await headerPage.goto(`${origin}${path}`);
      const title = headerPage.getByRole("link", {
        name: "CCSブログ",
        exact: true,
      });
      const logo = title.locator("img");
      assert.equal(await logo.getAttribute("alt"), "");
      assert.equal(
        await logo.evaluate((element) => {
          const img = element as HTMLImageElement;
          return img.complete && img.naturalWidth > 0;
        }),
        true
      );
      assert.deepEqual(
        await logo.evaluate((img) => {
          const { width, height } = img.getBoundingClientRect();
          return { width, height };
        }),
        { width: 32, height: 32 }
      );
      assert.equal(await headerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      if (path === "/") {
        assert.equal(await headerPage.locator("main h1").count(), 0);
        for (const section of [".page-heading", ".site-footer"]) {
          const introBlock = headerPage.locator(`${section} .site-intro`);
          assert.equal((await introBlock.locator(":scope > span").allTextContents()).slice(0, 2).join(""), intro);
          assert.equal(await introBlock.locator(":scope > span").count(), 3);
          assert.deepEqual(
            await introBlock
              .locator(":scope > span")
              .evaluateAll((spans) => spans.map((span) => getComputedStyle(span).display)),
            ["block", "block", "block"]
          );
          assert.equal(await introBlock.locator("a").getAttribute("href"), "/@writer/hello/");
          assert.equal(await introBlock.locator("a").textContent(), "Fixture Article");
        }
      } else {
        await headerPage.evaluate(() => {
          window.scrollTo(0, 1000);
        });
        await headerPage.locator(".site-title.is-sub").waitFor({ state: "attached" });
        assert.equal(await title.isVisible(), width > 520);
        if (width > 520) assert.equal(await logo.isVisible(), true);
      }
    }
    await headerContext.close();
  }
  const motionContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "no-preference",
  });
  await motionContext.route("**/*", (route) => {
    if (route.request().url() === "https://platform.twitter.com/widgets.js") {
      return route.fulfill({
        contentType: "text/javascript",
        body: 'window.twttr = { widgets: { load: (element) => { setTimeout(() => { element.style.height = "1100px"; element.dataset.expanded = "true"; }, 1200); } } }; document.querySelectorAll(".twitter-embed").forEach(window.twttr.widgets.load);',
      });
    }
    return route.request().url().startsWith(origin) ? route.continue() : route.abort();
  });
  const motionPage = await motionContext.newPage();
  const assertExpandedPosition = async () => {
    const atHeading = () => {
      const heading = document.getElementById("github-1")!;
      return Math.abs(heading.getBoundingClientRect().top - parseFloat(getComputedStyle(heading).scrollMarginTop)) < 3;
    };
    await motionPage.waitForFunction(atHeading);
    assert.equal(await motionPage.locator('.twitter-embed[data-expanded="true"]').count(), 0);
    await motionPage.locator('.twitter-embed[data-expanded="true"]').waitFor();
    await motionPage.waitForFunction(atHeading);
  };
  await motionPage.goto(`${origin}/@writer/post02/#github-1`);
  await assertExpandedPosition();
  await motionPage.reload();
  await assertExpandedPosition();
  await motionPage.goto(`${origin}/@writer/hello/`);
  await motionPage.locator('.prose a[href="/@writer/post02/#github-1"]').click();
  await motionPage.waitForURL(`${origin}/@writer/post02/#github-1`);
  await assertExpandedPosition();
  await motionPage.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    const positions: number[] = [];
    Reflect.set(window, "scrollPositions", positions);
    window.addEventListener("scroll", () => (Reflect.get(window, "scrollPositions") as number[]).push(window.scrollY));
  });
  await motionPage.locator('.toc-panel a[href="#github"]').click();
  await motionPage.waitForFunction(() => {
    const heading = document.getElementById("github")!;
    return Math.abs(heading.getBoundingClientRect().top - parseFloat(getComputedStyle(heading).scrollMarginTop)) < 3;
  });
  assert.ok((await motionPage.evaluate(() => new Set(Reflect.get(window, "scrollPositions") as number[]).size)) > 2);
  await motionPage.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    Reflect.set(window, "scrollPositions", []);
    const link = document.createElement("a");
    link.href = "/@writer/post02/#github-1";
    document.querySelector(".prose")!.append(link);
    link.click();
  });
  await motionPage.waitForFunction(() => {
    const heading = document.getElementById("github-1")!;
    return Math.abs(heading.getBoundingClientRect().top - parseFloat(getComputedStyle(heading).scrollMarginTop)) < 3;
  });
  assert.ok((await motionPage.evaluate(() => new Set(Reflect.get(window, "scrollPositions") as number[]).size)) > 2);
  await motionPage.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/@writer/hello/";
    document.querySelector(".prose")!.append(link);
    link.click();
  });
  await motionPage.waitForURL(`${origin}/@writer/hello/`);
  assert.equal(await motionPage.evaluate(() => document.documentElement.classList.contains("smooth-anchor")), true);
  await motionPage.locator('.prose a[href="/@writer/post02/#github-1"]').click();
  await motionPage.waitForURL(`${origin}/@writer/post02/#github-1`);
  await assertExpandedPosition();
  await motionPage.goto(`${origin}/@writer/post02/`);
  await motionPage.locator('.twitter-embed[data-expanded="true"]').waitFor();
  await motionPage.evaluate(() => {
    window.scrollTo({ top: 850, behavior: "instant" });
  });
  await motionPage.locator('.toc-panel a[href="#github"]').click();
  await motionPage.waitForFunction(() => {
    const heading = document.getElementById("github")!;
    return Math.abs(heading.getBoundingClientRect().top - parseFloat(getComputedStyle(heading).scrollMarginTop)) < 3;
  });
  await motionPage.goBack();
  await motionPage.waitForURL(`${origin}/@writer/post02/`);
  await motionPage.waitForFunction(() => Math.abs(window.scrollY - 850) < 3);
  await motionContext.close();
  let releaseWidgets!: () => void;
  const widgetsGate = new Promise<void>((resolve) => {
    releaseWidgets = resolve;
  });
  const delayedContext = await browser.newContext();
  await delayedContext.route("**/*", async (route) => {
    if (route.request().url() === "https://platform.twitter.com/widgets.js") {
      await widgetsGate;
      return route.fulfill({
        contentType: "text/javascript",
        body: twitterMock,
      });
    }
    return route.request().url().startsWith(origin) ? route.continue() : route.abort();
  });
  const delayedPage = await delayedContext.newPage();
  await delayedPage.goto(`${origin}/@writer/hello/`, {
    waitUntil: "domcontentloaded",
  });
  await delayedPage.locator('script[src="https://platform.twitter.com/widgets.js"]').waitFor({ state: "attached" });
  await delayedPage.locator('.prose a[href="/privacy/"]').click();
  await delayedPage.waitForURL(`${origin}/privacy/`, { waitUntil: "commit" });
  await delayedPage.goBack({ waitUntil: "domcontentloaded" });
  await delayedPage.waitForURL(`${origin}/@writer/hello/`, {
    waitUntil: "commit",
  });
  const delayedDetails = delayedPage.getByText("Closed X URL", { exact: true }).locator("..");
  await delayedDetails.locator(":scope > summary").click();
  releaseWidgets();
  await delayedDetails.locator('.twitter-embed[data-twitter-loaded="true"]').waitFor();
  await delayedContext.close();
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
    reducedMotion: "reduce",
  });
  context.setDefaultTimeout(15_000);
  context.setDefaultNavigationTimeout(20_000);
  await context.route("**/*", (route) => {
    if (route.request().url() === "https://www.youtube-nocookie.com/embed/abc_123") {
      return route.fulfill({
        contentType: "text/html",
        body: "<p>Fixture video loaded</p>",
      });
    }
    if (route.request().url() === "https://platform.twitter.com/widgets.js") {
      return route.fulfill({
        contentType: "text/javascript",
        body: twitterMock,
      });
    }
    return route.request().url().startsWith(origin) ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const previewImageRequests: string[] = [];
  page.on("request", (request) => {
    if (/preview-image\.invalid|preview-local-image\.png/.test(request.url())) previewImageRequests.push(request.url());
  });
  const errors: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  const assertHashPosition = async (id: string) => {
    await page.waitForFunction((id) => {
      const element = document.getElementById(id);
      if (!element) return false;
      const top = element.getBoundingClientRect().top;
      const margin = parseFloat(getComputedStyle(element).scrollMarginTop);
      return Math.abs(top - margin) < 3;
    }, id);
  };
  // スラッシュなしの URL は、クエリとハッシュを保ったまま、スラッシュつきへリダイレクトする
  await page.goto(`${origin}/@writer/post02?test=1#github-1`);
  assert.equal(page.url(), `${origin}/@writer/post02/?test=1#github-1`);
  await page.waitForLoadState("networkidle");
  await assertHashPosition("github-1");
  await page.evaluate(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.reload();
  await assertHashPosition("github-1");
  await page.goto(`${origin}/@writer/hello/`);
  await page.locator('.prose a[href="/@writer/post02/#github-1"]').click();
  await page.waitForURL(`${origin}/@writer/post02/#github-1`);
  await assertHashPosition("github-1");
  await page.locator('.toc-panel a[href="#github"]').click();
  await assertHashPosition("github");
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), "auto");
  await page.goBack();
  await assertHashPosition("github-1");
  await page.goForward();
  await assertHashPosition("github");
  // 見出しの位置とは別の位置まで読み進めてから、別のページへ移動し、戻る
  await page.evaluate(() => {
    window.scrollTo({ top: 300, behavior: "instant" });
  });
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/@writer/hello/";
    link.textContent = "Return to article";
    document.querySelector(".prose")!.append(link);
    // 要素のクリックでは、スクロールが動くため、DOM のクリックで移動する
    link.click();
  });
  await page.waitForURL(`${origin}/@writer/hello/`);
  await page.goBack();
  // 戻るときは、ハッシュの見出しではなく、離れたときの位置に戻る
  await page.waitForFunction(() => Math.abs(window.scrollY - 300) < 3);
  await page.goto(`${origin}/@writer/post02/#missing`);
  await page.waitForLoadState("networkidle");
  await page.goto(`${origin}/@writer/hello/`);
  await page.waitForFunction(
    () =>
      document.querySelector<
        HTMLElement & {
          __vue_app__?: {
            config: {
              globalProperties: { $router: { push: (url: string) => void } };
            };
          };
        }
      >("#__nuxt")?.__vue_app__
  );
  await page.evaluate(() => Reflect.set(window, "linkNavigationTest", true));
  await page.locator('.prose a[href="/privacy/"]').click();
  await page.waitForURL(`${origin}/privacy/`);
  assert.equal(await page.evaluate(() => Reflect.get(window, "linkNavigationTest") === true), true);
  await page.goBack();
  await page.waitForURL(/\/@writer\/hello\/$/);
  const [feedResponse] = await Promise.all([
    page.waitForResponse((response) => response.url() === `${origin}/feed.xml`),
    page.locator('.prose a[href="/feed.xml"]').click(),
  ]);
  assert.equal(feedResponse.status(), 200);
  assert.match(await feedResponse.text(), /<feed\b/);
  await page.goBack();
  await page.waitForURL(/\/@writer\/hello\/$/);
  const localImage = page.locator('main img[alt="local"]');
  await localImage.click();
  const zoomed = page.locator(".medium-zoom-image--opened:not([srcset])");
  await zoomed.waitFor();
  assert.equal(await zoomed.getAttribute("src"), await localImage.getAttribute("data-zoom-src"));
  await page.keyboard.press("Escape");
  await zoomed.waitFor({ state: "detached" });
  await page.locator('.toc-panel a[href="#second-section"]').click();
  await page.waitForFunction(() => location.hash === "#second-section");
  await page.waitForSelector('.toc-panel a[href="#second-section"][aria-current="location"]');
  await page.getByRole("button", { name: "コードをコピー" }).first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'console.log("hello");\n');
  for (const block of [
    page.locator(".code-block").first(),
    page.locator(".code-block").filter({ hasText: "named.js" }),
    page.locator('.code-group [role="tabpanel"]:visible .code-block').first(),
  ]) {
    assert.equal(await block.locator("pre").evaluate((pre) => getComputedStyle(pre).paddingTop), "15px");
    assert.equal(
      await block.locator("pre").evaluate((pre) => {
        const line = pre.querySelector(".line");
        return line ? Math.round(line.getBoundingClientRect().top - pre.getBoundingClientRect().top) : 16;
      }),
      16
    );
    assert.equal(await block.locator("pre").evaluate((pre) => getComputedStyle(pre).paddingBottom), "15px");
    assert.equal(
      await block.locator("pre").evaluate((pre) => {
        const style = getComputedStyle(pre);
        return Math.round((parseFloat(style.lineHeight) / parseFloat(style.fontSize)) * 100);
      }),
      155
    );
    const button = await block.locator(".code-copy").boundingBox();
    const code = await block.locator("pre").boundingBox();
    assert.ok(
      button &&
        code &&
        button.y >= code.y &&
        button.y + button.height <= code.y + code.height &&
        button.x + button.width <= code.x + code.width
    );
  }
  for (const block of [
    page.locator(".code-block").first(),
    page.locator(".code-block").filter({ hasText: "named.js" }),
    page.locator('.code-group [role="tabpanel"]:visible .code-block').first(),
  ]) {
    for (const selector of [".code-copy", ".code-wrap"]) {
      const button = block.locator(selector);
      await button.hover();
      assert.equal(
        await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const tooltip = getComputedStyle(element, "::after");
          const body = element.closest<HTMLElement>(".code-body")!;
          const x =
            rect.right -
            parseFloat(tooltip.right) -
            parseFloat(tooltip.width) -
            parseFloat(tooltip.paddingLeft) -
            parseFloat(tooltip.paddingRight) -
            parseFloat(tooltip.borderLeftWidth) -
            parseFloat(tooltip.borderRightWidth);
          return (
            tooltip.display === "block" &&
            parseFloat(tooltip.top) >= rect.height &&
            x >= body.getBoundingClientRect().left &&
            getComputedStyle(body).zIndex === "1"
          );
        }),
        true
      );
    }
  }
  const copyTooltip = page.locator(".code-block").first().locator(".code-copy");
  await copyTooltip.hover();
  assert.equal(await copyTooltip.evaluate((button) => getComputedStyle(button, "::after").display), "block");
  const adjacentWrap = page.locator(".code-block").first().locator(".code-wrap");
  assert.equal(
    await adjacentWrap.evaluate((button) => {
      const rect = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }),
    true
  );
  await copyTooltip.click();
  assert.equal(await copyTooltip.evaluate((button) => getComputedStyle(button, "::after").content), '"コピーしました"');
  await page.waitForTimeout(2100);
  assert.equal(await copyTooltip.evaluate((button) => getComputedStyle(button, "::after").content), '"コードをコピー"');
  await page.keyboard.press("Tab");
  await copyTooltip.focus();
  assert.equal(await copyTooltip.evaluate((button) => getComputedStyle(button, "::after").display), "block");
  const namedBlock = page.locator(".code-block").filter({ hasText: "named.js" });
  assert.equal(await namedBlock.locator(".line.highlight").count(), 1);
  for (const selector of [".code-copy", ".code-wrap"]) {
    assert.equal(
      await namedBlock.locator(selector).evaluate((button) => {
        const rect = button.getBoundingClientRect();
        return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }),
      true
    );
  }
  const wrap = namedBlock.locator(".code-wrap");
  assert.equal(await wrap.getAttribute("aria-label"), "コードを折り返す");
  assert.equal(await wrap.locator(".lucide-wrap-text").isVisible(), true);
  await wrap.hover();
  assert.equal(await wrap.evaluate((button) => getComputedStyle(button, "::after").content), '"コードを折り返す"');
  assert.equal(await wrap.evaluate((button) => getComputedStyle(button, "::after").display), "block");
  await wrap.click();
  assert.equal(
    await wrap.evaluate((button) => getComputedStyle(button, "::after").content),
    '"折り返しをやめて横スクロールにする"'
  );
  assert.equal(await wrap.getAttribute("aria-label"), "折り返しをやめて横スクロールにする");
  assert.equal(await wrap.locator(".lucide-move-horizontal").isVisible(), true);
  assert.equal(await wrap.getAttribute("aria-pressed"), "true");
  assert.equal(await namedBlock.locator("pre").evaluate((pre) => getComputedStyle(pre).whiteSpace), "pre-wrap");
  await wrap.click();
  assert.equal(await wrap.getAttribute("aria-pressed"), "false");
  assert.equal(await wrap.getAttribute("aria-label"), "コードを折り返す");
  assert.equal(await wrap.evaluate((button) => getComputedStyle(button, "::after").content), '"コードを折り返す"');
  assert.equal(await wrap.locator(".lucide-wrap-text").isVisible(), true);
  const longLine = page.locator(".code-block").first();
  assert.equal(
    await longLine.locator("pre").evaluate((pre) => {
      const line = pre.querySelector(".line")!;
      line.textContent = "x".repeat(500);
      pre.scrollLeft = pre.scrollWidth;
      const range = document.createRange();
      range.selectNodeContents(line.firstChild!);
      range.setStart(line.firstChild!, 499);
      const button = pre.parentElement!.querySelector(".code-wrap")!.getBoundingClientRect();
      return range.getBoundingClientRect().right <= button.left;
    }),
    true
  );
  await longLine.locator(".code-wrap").click();
  assert.equal(
    await longLine.locator("pre").evaluate((pre) => {
      const line = pre.querySelector(".line")!;
      const range = document.createRange();
      range.selectNodeContents(line.firstChild!);
      return [...range.getClientRects()].every((rect) => rect.right <= pre.getBoundingClientRect().right - 78);
    }),
    true
  );
  await page.setViewportSize({ width: 340, height: 844 });
  for (const className of ["highlight", "diff add"]) {
    await namedBlock.locator("pre").evaluate((pre, className) => {
      const line = pre.querySelector(".line")!;
      line.setAttribute("class", `line ${className}`);
      line.textContent = "x".repeat(500);
      pre.scrollLeft = pre.scrollWidth;
    }, className);
    assert.equal(
      await namedBlock.locator("pre").evaluate((pre) => {
        const text = pre.querySelector(".line")!.firstChild!;
        const range = document.createRange();
        range.setStart(text, 499);
        range.setEnd(text, 500);
        return (
          range.getBoundingClientRect().right <=
          pre.parentElement!.querySelector(".code-wrap")!.getBoundingClientRect().left
        );
      }),
      true
    );
    await wrap.click();
    assert.equal(
      await namedBlock.locator("pre").evaluate((pre) => {
        const range = document.createRange();
        range.selectNodeContents(pre.querySelector(".line")!.firstChild!);
        return [...range.getClientRects()].every(
          (rect) => rect.right <= pre.parentElement!.querySelector(".code-wrap")!.getBoundingClientRect().left
        );
      }),
      true
    );
    await wrap.click();
  }
  await namedBlock.locator("pre").evaluate((pre) => {
    pre.classList.add("line-numbers", "code-wrapped");
    pre.querySelector(".line")!.textContent = "x".repeat(500);
  });
  const alignment = await namedBlock
    .locator("pre .line")
    .first()
    .evaluate((line) => {
      const range = document.createRange();
      range.selectNodeContents(line.firstChild!);
      return Array.from(range.getClientRects(), (rect) => rect.x);
    });
  assert.ok(alignment.length > 1 && alignment.every((x) => Math.abs(x - alignment[0]!) < 1));
  await namedBlock.screenshot({ path: ".cache/code-wrap-check.png" });
  await namedBlock.locator("pre").evaluate((pre) => {
    pre.classList.remove("line-numbers", "code-wrapped");
  });
  await namedBlock.locator(".line").evaluate((line) => {
    line.setAttribute("class", "line highlight");
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const writingExample = page.locator("details").filter({ has: page.locator("summary", { hasText: "記事の書き方" }) });
  await writingExample.locator("summary").click();
  const writingBlock = writingExample.locator(".code-block");
  await writingBlock.getByRole("tab", { name: "プレビュー" }).click();
  assert.equal((await writingBlock.locator(".markdown-preview").innerText()).trim(), "本文を書いてください。");
  await writingBlock.screenshot({ path: ".cache/writing-example-preview.png" });
  await writingBlock.getByRole("button", { name: "コードをコピー" }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /^---\ntitle: はじめての記事\n/);
  const emptyPreview = page.locator(".code-block").filter({ hasText: "empty-preview.md" });
  await emptyPreview.getByRole("tab", { name: "プレビュー" }).click();
  assert.equal(await emptyPreview.locator(".markdown-preview").innerHTML(), "");
  assert.ok(await emptyPreview.locator(".markdown-preview").isVisible());
  await emptyPreview.screenshot({ path: ".cache/empty-markdown-preview.png" });
  const tabs = page.locator(".code-group").first().getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
  assert.equal(
    await page.locator('.code-group [role="tabpanel"]:visible').first().innerText(),
    'console.log("two");\n'
  );
  await page.keyboard.press("Home");
  assert.equal(await tabs.first().getAttribute("aria-selected"), "true");
  await page.locator("a[data-footnote-ref]").first().focus();
  assert.match(await page.locator("#footnote-tip").innerText(), /Footnote explanation/);
  const mermaid = page.locator(".mermaid").first();
  await mermaid.locator('[data-action="zoom-in"]').click();
  assert.match((await mermaid.locator(".mermaid-canvas").getAttribute("style")) ?? "", /scale\(/);
  await mermaid.locator('[data-action="fullscreen"]').click();
  await page.locator(".mermaid-dialog[open]").waitFor();
  await page.locator('.mermaid-dialog button[aria-label="閉じる"]').click();
  assert.equal(await page.locator('script[src="https://platform.twitter.com/widgets.js"]').count(), 1);
  await page.locator('.twitter-embed[data-twitter-loaded="true"]').first().waitFor();
  const xDetails = page.getByText("Closed X URL", { exact: true }).locator("..");
  const xOpen = page.getByText("Open X URL", { exact: true }).locator("..");
  const xOuter = page.getByText("Outer X details", { exact: true }).locator("..");
  const xInnerOpen = page.getByText("Inner initially open X code", { exact: true }).locator("..");
  const xInnerClosed = page.getByText("Inner closed X URL", { exact: true }).locator("..");
  await xOpen.locator('.twitter-embed[data-twitter-loaded="true"]').waitFor();
  assert.equal(await xDetails.locator('.twitter-embed[data-twitter-loaded="true"]').count(), 0);
  assert.equal(await xDetails.locator(".twitter-embed").getAttribute("data-auto-scanned"), null);
  assert.equal(await xOuter.locator('.twitter-embed[data-twitter-loaded="true"]').count(), 0);
  const hiddenAttempts = await xInnerClosed.locator(".twitter-embed").getAttribute("data-twitter-attempts");
  await xDetails.locator(":scope > summary").click();
  await xDetails.locator('.twitter-embed[data-twitter-loaded="true"]').waitFor();
  await xDetails.locator("iframe").scrollIntoViewIfNeeded();
  await xDetails.frameLocator("iframe").getByText("Fixture video loaded").waitFor();
  await xOuter.locator(":scope > summary").click();
  await xInnerOpen.locator('.twitter-embed[data-twitter-loaded="true"]').waitFor();
  assert.equal(await xInnerClosed.locator('.twitter-embed[data-twitter-loaded="true"]').count(), 0);
  assert.equal(await xInnerClosed.locator(".twitter-embed").getAttribute("data-twitter-attempts"), hiddenAttempts);
  await xInnerClosed.locator(":scope > summary").click();
  await xInnerClosed.locator('.twitter-embed[data-twitter-loaded="true"]').waitFor();
  // URL の見出しが閉じた details の中にあるとき、外側から開いてその見出しまでスクロールする
  const hashOuter = page
    .locator("details")
    .filter({ has: page.locator(":scope > summary", { hasText: "Hash outer" }) });
  const hashTarget = page.locator("#hash-target");
  assert.equal(await hashTarget.isVisible(), false);
  await page.goto(`${origin}/@writer/hello/#hash-target`);
  await hashTarget.waitFor({ state: "visible" });
  assert.equal(await hashOuter.first().evaluate((el) => (el as HTMLDetailsElement).open), true);
  assert.ok(await hashTarget.evaluate((el) => el.getBoundingClientRect().top < window.innerHeight));
  await page.goto(`${origin}/@writer/hello/`);
  await page.evaluate(() => {
    for (const details of document.querySelectorAll("details")) details.open = false;
    location.hash = "#hash-target";
  });
  await hashTarget.waitFor({ state: "visible" });
  assert.ok(await hashTarget.evaluate((el) => el.getBoundingClientRect().top < window.innerHeight));
  for (const label of [
    "filename guard text",
    "filename guard markdown",
    "filename guard group",
    "filename guard plain tab",
  ]) {
    const block = page.locator(".code-block").filter({ has: page.locator("pre", { hasText: label }) });
    const link = block.locator("a").first();
    assert.match(await link.locator(".url-host").innerText(), /xn--gogle-jye\.com/);
    assert.match(await link.locator(".url-warning").innerText(), /接続先に注意/);
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    for (const label of [
      "filename guard text",
      "filename guard markdown",
      "filename guard group",
      "filename guard plain tab",
    ]) {
      const block = page.locator(".code-block").filter({ has: page.locator("pre", { hasText: label }) });
      const panel = block.locator('xpath=ancestor::*[@role="tabpanel"][1]');
      if ((await panel.count()) && !(await panel.isVisible())) {
        const tabId = await panel.getAttribute("aria-labelledby");
        assert.ok(tabId);
        await page.locator(`[id="${tabId}"]`).click();
      }
      for (const selector of [".url-host", ".url-warning"]) {
        const visible = await block.locator(selector).evaluate((element) => {
          const rect = element.getBoundingClientRect();
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const bounds = parent.getBoundingClientRect();
            if (style.overflowX !== "visible" && (rect.left < bounds.left || rect.right > bounds.right)) return false;
            if (style.overflowY !== "visible" && (rect.top < bounds.top || rect.bottom > bounds.bottom)) return false;
          }
          return rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth;
        });
        assert.ok(visible, `${label}: ${selector} is clipped at ${String(width)}px`);
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const unnamedMarkdown = page.locator(".code-block").filter({ hasText: "Unnamed preview" });
  assert.equal(await unnamedMarkdown.getByRole("tab", { name: "Markdown" }).getAttribute("aria-selected"), "true");
  assert.equal(await unnamedMarkdown.locator(".code-wrap").isVisible(), true);
  await unnamedMarkdown.getByRole("tab", { name: "プレビュー" }).click();
  assert.equal(await unnamedMarkdown.locator(".code-wrap").isVisible(), false);
  assert.equal(await unnamedMarkdown.locator(".code-copy").isVisible(), true);
  await unnamedMarkdown.getByRole("tab", { name: "Markdown" }).click();
  assert.equal(await unnamedMarkdown.locator(".code-wrap").isVisible(), true);
  const mathPreview = page.locator(".code-block").filter({ hasText: "math-preview.md" });
  await mathPreview.getByRole("tab", { name: "プレビュー" }).click();
  for (const math of [
    page.locator(".prose > p").filter({ hasText: "Math layout:" }).first().locator(".katex"),
    mathPreview.locator(".katex"),
  ]) {
    assert.equal(await math.locator(".mfrac").count(), 1);
    assert.ok((await math.locator(".msupsub").count()) >= 2);
    assert.equal(await math.locator(".sqrt").count(), 1);
    assert.ok((await math.locator(".mop").count()) >= 1);
    const line = await math.locator(".sqrt svg").boundingBox();
    const exponent = await math.locator(".sqrt .msupsub").first().boundingBox();
    assert.ok(line && exponent && line.y < exponent.y);
  }
  const highlighted = mathPreview.locator(".markdown-preview pre.shiki");
  assert.equal(await highlighted.locator(".line").count(), 3);
  const heights = await highlighted
    .locator(".line")
    .evaluateAll((lines) => lines.map((line) => line.getBoundingClientRect().height));
  assert.ok(heights.every((height) => Math.abs(height - heights[0]!) < 1));
  const bodyHeight = await page
    .locator(".code-block pre .line:visible")
    .first()
    .evaluate((line) => parseFloat(getComputedStyle(line).lineHeight));
  assert.ok(Math.abs(heights[0]! - bodyHeight) < 1);
  const colors = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(value);
    }, theme);
    colors.push(
      await highlighted
        .locator(".line span")
        .first()
        .evaluate((el) => getComputedStyle(el).color)
    );
  }
  assert.notEqual(colors[0], colors[1]);
  const fontStatus = await page.evaluate(async () => {
    const fonts = ["KaTeX_Main", "KaTeX_Math", "KaTeX_Size1"];
    await Promise.all(fonts.map((font) => document.fonts.load(`16px ${font}`)));
    return fonts.map((font) => [...document.fonts].some((face) => face.family === font && face.status === "loaded"));
  });
  assert.ok(fontStatus.every(Boolean));
  await mathPreview.screenshot({ path: ".cache/markdown-preview-check.png" });
  await page
    .locator(".prose > p")
    .filter({ hasText: "Math layout:" })
    .first()
    .screenshot({ path: ".cache/math-body-check.png" });
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  });
  const articleMarkdown = page.locator(".code-block").filter({ hasText: "article.md" });
  for (const block of [
    articleMarkdown,
    unnamedMarkdown,
    page.locator(".code-group").filter({ hasText: "group.md" }).locator(".code-block"),
  ]) {
    const bar = await block.locator(".code-preview-bar").boundingBox();
    const tab = await block.locator(".code-preview-tabs").boundingBox();
    assert.ok(bar && tab && Math.abs(tab.y - bar.y) < 2 && Math.abs(tab.x + tab.width - (bar.x + bar.width - 1)) < 2);
    const filename = block.locator(".code-preview-filename");
    if (await filename.count()) {
      const label = await filename.boundingBox();
      assert.ok(label && label.y < tab.y + tab.height && label.x + label.width <= tab.x);
    }
  }
  assert.equal(await articleMarkdown.getByRole("tab", { name: "Markdown" }).getAttribute("aria-selected"), "true");
  assert.equal(await articleMarkdown.locator("pre").isVisible(), true);
  assert.equal(await articleMarkdown.locator(".markdown-preview").isVisible(), false);
  await articleMarkdown.getByRole("tab", { name: "Markdown" }).focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await articleMarkdown.getByRole("tab", { name: "プレビュー" }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("Tab");
  assert.equal(
    await articleMarkdown.locator(".code-copy").evaluate((button) => document.activeElement === button),
    true
  );
  await page.keyboard.press("Tab");
  assert.equal(
    await articleMarkdown.locator(".markdown-preview").evaluate((panel) => document.activeElement === panel),
    true
  );
  assert.equal(await articleMarkdown.locator(".code-wrap").isVisible(), false);
  assert.equal(await articleMarkdown.locator(".markdown-preview strong").textContent(), "Article bold");
  for (const block of [articleMarkdown, page.locator(".code-block").filter({ hasText: "gist.md" })]) {
    for (const type of ["note", "tip", "important", "warning", "caution"]) {
      assert.equal(
        await block.locator(`.markdown-preview [data-callout="${type}"] .callout-title-icon svg`).count(),
        1
      );
    }
    assert.match(await block.locator(".markdown-preview blockquote").innerText(), /\[!UNKNOWN\]/);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.classList.remove("light", "dark");
        document.documentElement.classList.add(value);
      }, theme);
      const icon = block.locator('.markdown-preview [data-callout="note"] svg');
      assert.ok(await icon.isVisible());
      await block.screenshot({
        path: `.cache/alerts-${block === articleMarkdown ? "article" : "gist"}-${theme}.png`,
      });
    }
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
  });
  await articleMarkdown.getByRole("button", { name: "コードをコピー" }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "# Article preview\n\n**Article bold**\n\n> [!NOTE]\n> Alert NOTE\n\n> [!TIP]\n> Alert TIP\n\n> [!IMPORTANT]\n> Alert IMPORTANT\n\n> [!WARNING]\n> Alert WARNING\n\n> [!CAUTION]\n> Alert CAUTION\n\n> [!UNKNOWN]\n> Alert UNKNOWN\n\n![remote](https://preview-image.invalid/tracker.png) ![local](/preview-local-image.png)\n"
  );
  assert.equal(await articleMarkdown.locator(".markdown-preview img").count(), 0);
  assert.deepEqual(previewImageRequests, []);
  const groupMarkdown = page.locator(".code-group").filter({ hasText: "group.md" });
  await groupMarkdown.getByRole("tab", { name: "Markdown" }).focus();
  await page.keyboard.press("End");
  assert.equal(await groupMarkdown.getByRole("tab", { name: "プレビュー" }).getAttribute("aria-selected"), "true");
  assert.equal(await groupMarkdown.locator(".markdown-preview .md-h1").textContent(), "Group preview");
  assert.equal(await groupMarkdown.locator(".code-preview-filename").count(), 0);
  assert.equal(await groupMarkdown.getByRole("heading").count(), 0);
  assert.equal(await page.locator(".toc-panel").getByText("Group preview").count(), 0);
  assert.equal(
    await groupMarkdown.locator(".md-h1").evaluate((el) => getComputedStyle(el).fontSize),
    await page
      .locator("h1")
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize)
  );
  for (const tab of await groupMarkdown.locator('.code-tabs > [role="tab"]').all()) {
    assert.equal(await tab.evaluate((el) => getComputedStyle(el).whiteSpace), "nowrap");
  }
  const markdownFont = await groupMarkdown
    .locator("pre code")
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.fontFamily, style.fontSize];
    });
  const otherFont = await page
    .locator(".code-block pre code")
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      return [style.fontFamily, style.fontSize];
    });
  assert.deepEqual(markdownFont, otherFont);
  await groupMarkdown.getByRole("button", { name: "コードをコピー" }).click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "# Group preview\n");
  const gistMarkdown = page.locator(".code-block").filter({ hasText: "gist.md" });
  assert.equal(await gistMarkdown.getByRole("tab", { name: "プレビュー" }).getAttribute("aria-selected"), "true");
  assert.equal(await gistMarkdown.locator(".code-wrap").isVisible(), false);
  assert.equal(await gistMarkdown.locator(".markdown-preview strong").textContent(), "Gist bold");
  assert.equal(await gistMarkdown.locator("pre").isVisible(), false);
  await gistMarkdown.getByRole("button", { name: "コードをコピー" }).click();
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "# Gist preview\n\n**Gist bold**\n\n> [!NOTE]\n> Alert NOTE\n\n> [!TIP]\n> Alert TIP\n\n> [!IMPORTANT]\n> Alert IMPORTANT\n\n> [!WARNING]\n> Alert WARNING\n\n> [!CAUTION]\n> Alert CAUTION\n\n> [!UNKNOWN]\n> Alert UNKNOWN\n"
  );
  await gistMarkdown.getByRole("tab", { name: "Markdown" }).click();
  assert.equal(await gistMarkdown.locator("pre").isVisible(), true);
  assert.equal(await gistMarkdown.locator(".code-wrap").isVisible(), true);
  assert.equal(await page.locator(".code-block").filter({ hasText: "gist.txt" }).locator("pre").isVisible(), true);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileMarkdown = page.locator(".code-block").filter({ hasText: "a-very-long-markdown-filename" });
  const mobileBar = mobileMarkdown.locator(".code-preview-tabs");
  const mobileTab = mobileMarkdown.getByRole("tab", { name: "プレビュー" });
  const mobileFilename = await mobileMarkdown.locator(".code-preview-filename").boundingBox();
  const mobileTabs = await mobileBar.boundingBox();
  const mobileName = await mobileMarkdown.locator(".code-filename-text").boundingBox();
  assert.ok(
    mobileFilename &&
      mobileTabs &&
      (mobileFilename.y + mobileFilename.height <= mobileTabs.y + 1 ||
        mobileFilename.x + mobileFilename.width <= mobileTabs.x + 1)
  );
  assert.ok(mobileName && mobileName.x + mobileName.width <= mobileFilename.x + mobileFilename.width);
  await mobileTab.scrollIntoViewIfNeeded();
  const barRect = await mobileBar.boundingBox();
  const tabRect = await mobileTab.boundingBox();
  assert.ok(barRect && tabRect);
  assert.ok(tabRect.x >= barRect.x && tabRect.x + tabRect.width <= barRect.x + barRect.width);
  await mobileTab.click();
  assert.equal(await mobileMarkdown.locator(".code-wrap").isVisible(), false);
  await mobileMarkdown.getByRole("tab", { name: "Markdown" }).click();
  assert.equal(await mobileMarkdown.locator(".code-wrap").isVisible(), true);
  await page.getByRole("button", { name: "目次を開く" }).click();
  const toc = page.locator("#toc-popover");
  await toc.waitFor({ state: "visible" });
  for (const selector of [".code-copy", ".code-wrap"]) {
    const button = namedBlock.locator(selector);
    await button.scrollIntoViewIfNeeded();
    await page.evaluate(
      ({ selector }) => {
        const button = document.querySelector<HTMLElement>(`.code-block:has(.line.highlight) ${selector}`)!;
        const panel = document.querySelector<HTMLElement>("#toc-popover")!;
        window.scrollBy(0, button.getBoundingClientRect().top - panel.getBoundingClientRect().top - 30);
      },
      { selector }
    );
    assert.equal(
      await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return !!document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("#toc-popover");
      }),
      true
    );
  }
  await page.keyboard.press("Escape");
  const floating = page.getByRole("button", { name: "目次を開く" });
  const gistCopy = gistMarkdown.locator(".code-copy");
  await gistCopy.scrollIntoViewIfNeeded();
  await gistCopy.evaluate((code) => {
    const fixed = document.querySelector<HTMLElement>('.floating-actions button[aria-label="目次を開く"]')!;
    window.scrollBy(0, code.getBoundingClientRect().top - fixed.getBoundingClientRect().top);
  });
  const copyRect = await gistCopy.boundingBox();
  const floatingRect = await floating.boundingBox();
  assert.ok(copyRect && floatingRect);
  const overlapX = Math.max(copyRect.x, floatingRect.x);
  const overlapY = Math.max(copyRect.y, floatingRect.y);
  const overlapRight = Math.min(copyRect.x + copyRect.width, floatingRect.x + floatingRect.width);
  const overlapBottom = Math.min(copyRect.y + copyRect.height, floatingRect.y + floatingRect.height);
  assert.ok(overlapX < overlapRight && overlapY < overlapBottom);
  assert.equal(
    await floating.evaluate((element, point) => element.contains(document.elementFromPoint(point.x, point.y)), {
      x: (overlapX + overlapRight) / 2,
      y: (overlapY + overlapBottom) / 2,
    }),
    true
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const viewport of [
    { width: 1440, height: 1600 },
    { width: 375, height: 3000 },
  ]) {
    await page.setViewportSize(viewport);
    for (const path of ["/missing-page", "/privacy/"]) {
      await page.goto(`${origin}${path}`);
      const bottom = await page.locator("footer.site-footer").evaluate((el) => el.getBoundingClientRect().bottom);
      assert.ok(Math.abs(bottom - viewport.height) < 1);
    }
    await page.goto(`${origin}/@writer/hello/`);
    const positions = await page.evaluate(() => ({
      main: document.querySelector("main")!.getBoundingClientRect().bottom,
      footer: document.querySelector("footer.site-footer")!.getBoundingClientRect().top,
      height: document.documentElement.scrollHeight,
    }));
    assert.ok(positions.footer >= positions.main && positions.height > viewport.height);
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  const notFound = await page.goto(`${origin}/missing-page`);
  assert.equal(notFound?.status(), 404);
  await page.getByRole("heading", { name: "ページが見つかりません" }).waitFor();
  assert.equal(await page.locator("header.site-header").count(), 1);
  assert.equal(await page.locator("footer.site-footer").count(), 1);
  await page.goto(`${origin}/privacy/`);
  await page.getByRole("heading", { name: "プライバシーポリシー" }).waitFor();
  assert.equal(await page.locator("header.site-header").count(), 1);
  assert.equal(await page.locator("footer.site-footer a[href='/privacy/']").count(), 1);
  const paragraphs = await page.locator("main .prose p").allTextContents();
  // 測定 ID を設定していないビルド（GA のタグを出さない）では、GA を使用していると案内しない
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.replace(/\s+/g, " ").trim()),
    ["このサイトでは現在、アクセス情報を分析するツールを使用していません。"]
  );
  assert.equal(await page.locator("main .prose a").count(), 0);
  assert.equal(await page.locator('script[src*="googletagmanager.com"]').count(), 0);
  await page.goto(`${origin}/`);
  await page.waitForFunction(
    () =>
      document.querySelector<
        HTMLElement & {
          __vue_app__?: {
            config: {
              globalProperties: { $router: { push: (url: string) => void } };
            };
          };
        }
      >("#__nuxt")?.__vue_app__
  );
  const islandRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/__nuxt_island/PostBody_")) islandRequests.push(request.url());
  });
  await page.keyboard.press("Control+k");
  const input = page.getByRole("searchbox", { name: "検索語" });
  const missingQuery = `missing${randomUUID().replaceAll("-", "")}`;
  await input.fill(missingQuery);
  await page.getByText(`「${missingQuery}」に一致する記事は見つかりませんでした。`).waitFor();
  await input.fill("Scheduled");
  await page.getByText(/「Scheduled」に一致する記事は見つかりませんでした/).waitFor();
  await input.fill("Lucideonlytoken");
  await page.getByText(/「Lucideonlytoken」に一致する記事は見つかりませんでした/).waitFor();
  await input.fill("ピン留め");
  await page.getByText(/「ピン留め」に一致する記事は見つかりませんでした/).waitFor();
  await input.fill("プライバシーポリシー");
  await page.getByText(/に一致する記事は見つかりませんでした/).waitFor();
  await input.fill("searchable unique content");
  const hit = page.locator(".search-hit");
  await hit.first().waitFor();
  assert.equal(await hit.count(), 1);
  assert.equal(await hit.first().getAttribute("href"), "/@writer/hello/");
  assert.match(await hit.first().innerText(), /Fixture Article/);
  await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
  assert.equal(await page.locator(".search-dialog").evaluate((dialog) => (dialog as HTMLDialogElement).open), true);
  await hit.first().click();
  await page.waitForURL(/\/@writer\/hello\/$/);
  await page.getByRole("heading", { name: "Fixture Article" }).waitFor();
  assert.match(await page.locator('.prose .url-host[title="xn--r8jz45g.xn--zckzah"]').innerText(), /例え\.テスト/);
  assert.match(await page.locator(".prose").innerText(), /⟨U\+202E⟩/);
  assert.equal(
    await page.getByRole("link", { name: "GitHub で編集" }).getAttribute("href"),
    "https://github.com/densanken/blog-contents/edit/main/authors/writer/Hello.md"
  );
  await page.locator(".prose .code-copy").first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'console.log("hello");\n');
  assert.ok(islandRequests.length > 0);
  const navigatedTabs = page.locator(".code-group").first().getByRole("tab");
  await navigatedTabs.first().focus();
  await page.keyboard.press("End");
  assert.equal(await navigatedTabs.last().getAttribute("aria-selected"), "true");
  await page.locator("a[data-footnote-ref]").first().focus();
  assert.match(await page.locator("#footnote-tip").innerText(), /Footnote explanation/);
  await page.locator('.mermaid [data-action="fullscreen"]').first().click();
  await page.locator(".mermaid-dialog[open]").waitFor();
  await page.locator('.mermaid-dialog button[aria-label="閉じる"]').click();
  await page.locator('main img[alt="local"]').click();
  await page.locator(".medium-zoom-image--opened").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('script[src="https://platform.twitter.com/widgets.js"]').count(), 1);
  await page.locator('.twitter-embed[data-twitter-loaded="true"]').first().waitFor();
  await xDetails.locator(":scope > summary").click();
  await xDetails.locator('.twitter-embed[data-twitter-loaded="true"]').waitFor();
  await xOuter.locator(":scope > summary").click();
  await xInnerOpen.locator('.twitter-embed[data-twitter-loaded="true"]').waitFor();
  await xInnerClosed.locator(":scope > summary").click();
  await xInnerClosed.locator('.twitter-embed[data-twitter-loaded="true"]').waitFor();
  await page.evaluate(() => {
    document.documentElement.dataset.spaCheck = "yes";
  });
  await page.locator(".related-posts ul a").first().click();
  await page.waitForURL(/\/@writer\/post\d+/);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.spaCheck), "yes");
  await page.getByRole("heading", { name: "Post 01 & <tag>", level: 1 }).waitFor();
  await page.locator('.related-posts a[href="/@writer/hello/"]').waitFor();
  await page.goBack();
  await page.waitForURL(/\/@writer\/hello\/$/);
  await page.locator(".prose .code-copy").first().click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'console.log("hello");\n');
  for (const width of [320, 375, 1440]) {
    await page.setViewportSize({ width, height: 667 });
    for (const path of ["/", "/@writer/hello/", "/privacy/"]) {
      await page.goto(`${origin}${path}`);
      const footer = page.locator(".site-footer");
      assert.equal((await footer.locator(":scope > p > span").allTextContents()).slice(0, 2).join(""), intro);
      assert.equal(await footer.locator(":scope > p a").getAttribute("href"), "/@writer/hello/");
      const footerLinks = footer.locator(".footer-links");
      assert.equal(await footerLinks.locator(':scope > a[href="/"]').count(), 0);
      for (const extraItem of [false, true]) {
        if (extraItem) {
          await footerLinks.evaluate((element) => {
            const link = document.createElement("a");
            link.textContent = "追加した項目";
            element.append(link);
          });
        }
        const layout = await footerLinks.evaluate((element) => {
          const items = [...element.children].map((item) => item.getBoundingClientRect());
          return {
            stacked: getComputedStyle(element).flexDirection === "column",
            lefts: items.map((item) => item.left),
            widths: items.map((item) => item.width),
            tops: items.map((item) => item.top),
            horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
            bottomPadding: Number.parseFloat(getComputedStyle(element.parentElement!).paddingBottom),
          };
        });
        if (layout.stacked) {
          assert.ok(layout.lefts.every((left) => Math.abs(left - layout.lefts[0]!) < 1));
          assert.ok(layout.tops.every((top, index) => index === 0 || top > layout.tops[index - 1]!));
        } else {
          assert.ok(layout.widths.every((itemWidth) => Math.abs(itemWidth - layout.widths[0]!) < 1));
          assert.ok(layout.tops.every((top) => Math.abs(top - layout.tops[0]!) < 1));
        }
        assert.equal(layout.horizontalOverflow, false);
        assert.ok(layout.bottomPadding <= 96);
      }
    }
  }
  for (const path of ["/page/1/", "/page/4/", "/page/02/", "/@writer/page/1/", "/@writer/page/3/", "/@other/page/2/"]) {
    await page.goto(`${origin}/`);
    await page.waitForFunction(
      () =>
        document.querySelector<
          HTMLElement & {
            __vue_app__?: {
              config: {
                globalProperties: { $router: { push: (url: string) => void } };
              };
            };
          }
        >("#__nuxt")?.__vue_app__
    );
    await page.evaluate(
      (url) =>
        document
          .querySelector<
            HTMLElement & {
              __vue_app__?: {
                config: {
                  globalProperties: {
                    $router: { push: (url: string) => void };
                  };
                };
              };
            }
          >("#__nuxt")
          ?.__vue_app__?.config.globalProperties.$router.push(url),
      path
    );
    await page.getByRole("heading", { name: "ページが見つかりません" }).waitFor();
    assert.equal(await page.locator("header.site-header").count(), 1);
    assert.equal(await page.locator("footer.site-footer").count(), 1);
  }
  // 不正なフラグメント（`#100%`）でも、記事の初期化は止まらない（初期化の例外は errors に入り、下の確認で失敗になる）
  await page.goto(`${origin}/@writer/hello/#100%`);
  await page.locator(".prose .code-copy").first().waitFor();
  await page.waitForLoadState("networkidle");
  // 同じページの見出しへのルート相対のリンクも、なめらかにスクロールする（smooth-anchor を付ける）
  await page.goto(`${origin}/@writer/post02/`);
  await page.waitForLoadState("networkidle");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("smooth-anchor")), false);
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/@writer/post02/#github";
    link.textContent = "same page anchor";
    document.querySelector(".prose")!.append(link);
  });
  await page.getByText("same page anchor").click();
  await page.waitForURL(`${origin}/@writer/post02/#github`);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("smooth-anchor")), true);
  // テーマのメニューは、Tab と Shift+Tab で、閉じて外へ移動する（項目の間を移動しない）
  await page.goto(`${origin}/@writer/hello/`);
  await page.waitForLoadState("networkidle");
  for (const key of ["Tab", "Shift+Tab"]) {
    await page.locator('button[popovertarget="theme-menu"]').click();
    await page.locator("#theme-menu").waitFor({ state: "visible" });
    // メニューを開くと、現在の項目にフォーカスが移る（移る前に押すと、メニューの外のキー操作になる）
    await page.waitForFunction(() => !!document.activeElement?.closest("#theme-menu"));
    await page.keyboard.press(key);
    assert.equal(await page.locator("#theme-menu").isVisible(), false, `${key} closes the theme menu`);
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest("#theme-menu")), false);
  }
  // 検索結果の Ctrl/Cmd+クリックは、現在のタブを遷移させず、ブラウザーの既定（別のタブ）に任せる
  await page.goto(`${origin}/`);
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Control+k");
  await page.getByRole("searchbox", { name: "検索語" }).fill("searchable unique content");
  const searchHit = page.locator(".search-hit");
  await searchHit.first().waitFor();
  const [newTab] = await Promise.all([
    context.waitForEvent("page"),
    searchHit.first().click({ modifiers: ["ControlOrMeta"] }),
  ]);
  assert.equal(page.url(), `${origin}/`);
  await newTab.waitForURL(/\/@writer\/hello\/$/);
  await newTab.close();
  // 脚注のプレビューは、画面の下に切れず、収まらなければ参照の上に置く
  const viewport = page.viewportSize();
  assert.ok(viewport);
  await page.goto(`${origin}/@writer/hello/`);
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: viewport.width, height: 400 });
  const footnoteRef = page.locator("a[data-footnote-ref]").first();
  await footnoteRef.evaluate((element) => {
    window.scrollBy(0, element.getBoundingClientRect().bottom - window.innerHeight + 4);
  });
  await footnoteRef.focus();
  const tip = await page.locator("#footnote-tip").boundingBox();
  assert.ok(
    tip && tip.y >= 0 && tip.y + tip.height <= 400,
    `footnote tip is within the viewport: ${JSON.stringify(tip)}`
  );
  await page.setViewportSize(viewport);
  assert.deepEqual(errors, []);
  await context.close();
  process.stdout.write("Browser assertions passed\n");
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    })
  );
  clearTimeout(deadline);
}
