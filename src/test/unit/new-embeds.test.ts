import { toString } from "hast-util-to-string";
import { h } from "hastscript";
import { VFile } from "vfile";
import { describe, expect, it, vi } from "vitest";

import { gist } from "../../../plugins/embeds/gist.ts";
import { github } from "../../../plugins/embeds/github.ts";
import { googleSlides } from "../../../plugins/embeds/google-slides.ts";
import { twitch } from "../../../plugins/embeds/twitch.ts";
import { twitter } from "../../../plugins/embeds/twitter.ts";
import { youtube } from "../../../plugins/embeds/youtube.ts";
import unicodeGuard from "../../../plugins/rehype-unicode-code.ts";
import { safeFetch } from "../../../plugins/safe-fetch.ts";

vi.mock("../../../plugins/safe-fetch.ts", () => ({ safeFetch: vi.fn() }));
const reserve = vi.fn();

describe("X posts and YouTube videos", () => {
  it.each(["https://x.com/user/status/123abc", "https://x.com/user/status/123_4", "https://x.com/user/status/"])(
    "rejects the post URL %s",
    async (url) => {
      expect(await twitter.fromUrl(new URL(url), reserve)).toBeUndefined();
    }
  );
  it.each(["https://x.com/user/status/123", "https://x.com/user/status/123/", "https://x.com/user/status/123/photo/1"])(
    "converts the post URL %s",
    async (url) => {
      expect(JSON.stringify(await twitter.fromUrl(new URL(url), reserve))).toContain('https://x.com/user/status/123"');
    }
  );
  it.each([
    "https://www.youtube.com/watch?v=videoseries",
    "https://youtu.be/videoseries",
    "https://www.youtube.com/embed/videoseries",
    "https://www.youtube.com/shorts/videoseries",
  ])("rejects the reserved video ID in %s", async (url) => {
    expect(await youtube.fromUrl(new URL(url), reserve)).toBeUndefined();
  });
  it("rejects the reserved video ID in an iframe", () => {
    expect(
      youtube.fromEmbedCode([h("iframe", { src: "https://www.youtube.com/embed/videoseries" })], 0)
    ).toBeUndefined();
  });
  it("converts a video link that has a playlist", async () => {
    expect(
      JSON.stringify(await youtube.fromUrl(new URL("https://www.youtube.com/watch?v=abc_123&list=PLabc"), reserve))
    ).toContain("youtube-nocookie.com/embed/abc_123");
  });
});

describe("Google Slides", () => {
  it.each([
    ["d/abc", "d/abc/embed"],
    ["d/abc/", "d/abc/embed"],
    ["d/abc/edit?usp=sharing", "d/abc/embed"],
    ["d/abc/edit#slide=id.p", "d/abc/embed#slide=id.p"],
    ["d/abc/view", "d/abc/embed"],
    ["d/abc/present", "d/abc/embed"],
    ["d/abc/preview/", "d/abc/embed"],
    ["d/abc/embed", "d/abc/embed"],
    ["d/abc/pub", "d/abc/pubembed"],
    ["d/abc/pubembed", "d/abc/pubembed"],
    ["d/e/2PACX-abc/pub", "d/e/2PACX-abc/pubembed"],
    ["d/e/2PACX-abc/pubembed", "d/e/2PACX-abc/pubembed"],
    ["d/e/2PACX-abc/pubhtml", "d/e/2PACX-abc/pubembed"],
  ])("converts %s", async (input, output) => {
    expect(
      JSON.stringify(await googleSlides.fromUrl(new URL(`https://docs.google.com/presentation/${input}`), reserve))
    ).toContain(`https://docs.google.com/presentation/${output}`);
  });
  it.each([
    ["d/abc/edit?usp=sharing#slide=id.p", "d/abc/embed#slide=id.p"],
    ["d/e/2PACX-abc/pubhtml", "d/e/2PACX-abc/pubembed"],
  ])("normalizes iframe %s", (input, output) => {
    const result = googleSlides.fromEmbedCode(
      [h("iframe", { src: `https://docs.google.com/presentation/${input}` })],
      0
    );
    expect(result).toEqual({ url: `https://docs.google.com/presentation/${output}`, length: 1 });
  });
  it("rejects unrelated URLs", async () => {
    expect(
      await googleSlides.fromUrl(new URL("https://docs.google.com/presentation/d/abc/extra"), reserve)
    ).toBeUndefined();
    await expect(async () =>
      googleSlides.fromUrl(new URL("https://docs.google.com/presentation/d/e/abc/pubembed"), reserve)
    ).rejects.toThrow();
  });
});

describe("Twitch clips", () => {
  it.each([
    "https://clips.twitch.tv/Funny-Clip",
    "https://www.twitch.tv/user/clip/Funny-Clip",
    "https://twitch.tv/user/clip/Funny-Clip",
    "https://m.twitch.tv/user/clip/Funny-Clip",
  ])("converts %s", async (url) => {
    expect(JSON.stringify(await twitch.fromUrl(new URL(url), reserve))).toContain(
      "https://clips.twitch.tv/embed?clip=Funny-Clip&parent=blog.densanken.com&parent=localhost&parent=127.0.0.1"
    );
  });
  it("normalizes iframe clips and discards supplied parents", async () => {
    const result = twitch.fromEmbedCode(
      [h("iframe", { src: "https://clips.twitch.tv/embed?clip=Funny-Clip_1&parent=example.com" })],
      0
    );
    expect(result).toEqual({ url: "https://clips.twitch.tv/Funny-Clip_1", length: 1 });
    expect(JSON.stringify(await twitch.fromUrl(new URL(result!.url), reserve))).toContain(
      "clip=Funny-Clip_1&parent=blog.densanken.com&parent=localhost&parent=127.0.0.1"
    );
  });
  it.each([
    "https://clips.twitch.tv.evil.test/embed?clip=Funny-Clip",
    "https://clips.twitch.tv/other?clip=Funny-Clip",
    "https://clips.twitch.tv/embed?clip=bad%2Fslug",
    "https://clips.twitch.tv/embed?clip=日本語",
    "https://clips.twitch.tv/embed?clip=",
    "not a url",
  ])("rejects iframe %s", (src) => {
    expect(twitch.fromEmbedCode([h("iframe", { src })], 0)).toBeUndefined();
  });
  it("rejects unrelated URLs", async () => {
    expect(await twitch.fromUrl(new URL("https://clips.twitch.tv.evil.test/clip"), reserve)).toBeUndefined();
  });
});

describe("Gist", () => {
  it("accepts only the official script shape", () => {
    const script = (src: string, properties = {}) => h("script", { src, ...properties });
    expect(gist.fromEmbedCode([script("https://gist.github.com/user/abcdef.js?file=a%20b.md")], 0)).toEqual({
      url: "https://gist.github.com/user/abcdef?file=a+b.md",
      length: 1,
    });
    for (const node of [
      script("https://gist.github.com.evil.test/user/abcdef.js"),
      script("https://gist.github.com/user/not-hex.js"),
      script("https://gist.github.com/user/abcdef.js", { async: true }),
      script("https://gist.github.com/user/abcdef.js?file=%ZZ"),
    ])
      expect(gist.fromEmbedCode([node], 0)).toBeUndefined();
  });
  it("selects the requested file", async () => {
    vi.mocked(safeFetch).mockResolvedValueOnce(
      Buffer.from(JSON.stringify({ files: { "a.md": { content: "one" }, "b.md": { content: "two" } } }))
    );
    const result = await gist.fromUrl(new URL("https://gist.github.com/user/abcdef?file=b.md"), reserve);
    expect(JSON.stringify(result)).toContain('"filename":"b.md"');
    expect(JSON.stringify(result)).not.toContain('"filename":"a.md"');
  });
  it("renders all fetched files as text", async () => {
    vi.mocked(safeFetch).mockResolvedValueOnce(
      Buffer.from(
        JSON.stringify({ files: { "a.js": { content: "<script>hello</script>" }, "b.txt": { content: "two" } } })
      )
    );
    const budget = vi.fn();
    const result = await gist.fromUrl(new URL("https://gist.github.com/user/abcdef"), budget);
    expect(JSON.stringify(result)).toContain('"githubEmbed":true');
    expect(budget).toHaveBeenCalledOnce();
    expect(safeFetch).toHaveBeenCalledWith("https://api.github.com/gists/abcdef", { maxBytes: 1_000_000 });
    expect(JSON.stringify(result)).toContain('"value":"<script>hello</script>"');
    expect(JSON.stringify(result)).toContain('"filename":"b.txt"');
  });
  it("shows invisible Gist code, copies the same visible text and cleans the filename", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const code = "left\u202eright\n";
    vi.mocked(safeFetch).mockResolvedValueOnce(
      Buffer.from(JSON.stringify({ files: { "a\u200b.js": { content: code } } }))
    );
    const result = await gist.fromUrl(new URL("https://gist.github.com/user/abcdef"), reserve);
    expect(result).toBeDefined();
    if (!result) throw new Error("Gist was not rendered");
    const tree = { type: "root" as const, children: [result] };
    unicodeGuard()(tree, new VFile({ path: "contents/writer/post.md" }));
    expect(toString(tree)).toContain("⟨U+202E⟩");
    expect(JSON.stringify(tree)).toContain('"filename":"a.js"');
    // コピーする値（pre の code）も、表示するコードと同じく可視化する（表示と違う文字列をコピーさせない）
    expect(JSON.stringify(tree)).toContain(`"code":${JSON.stringify("left⟨U+202E⟩right\n")}`);
    expect(JSON.stringify(tree)).not.toContain('"code":"left\u202e');
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
  it("sends GITHUB_TOKEN only when it is set", async () => {
    vi.stubEnv("GITHUB_TOKEN", "secret");
    vi.mocked(safeFetch).mockResolvedValueOnce(Buffer.from(JSON.stringify({ files: { "a.md": { content: "one" } } })));
    await gist.fromUrl(new URL("https://gist.github.com/user/abcdef"), reserve);
    expect(safeFetch).toHaveBeenLastCalledWith("https://api.github.com/gists/abcdef", {
      maxBytes: 1_000_000,
      headers: { authorization: "Bearer secret" },
    });
    vi.unstubAllEnvs();
  });
  it("rejects unrelated URLs and truncated files", async () => {
    expect(await gist.fromUrl(new URL("https://gist.github.com.evil.test/user/abcdef"), reserve)).toBeUndefined();
    vi.mocked(safeFetch).mockResolvedValueOnce(
      Buffer.from(JSON.stringify({ files: { a: { content: "partial", truncated: true } } }))
    );
    await expect(gist.fromUrl(new URL("https://gist.github.com/user/abcdef"), reserve)).rejects.toThrow();
  });
});

it("marks generated GitHub file embeds", async () => {
  vi.mocked(safeFetch).mockResolvedValueOnce(Buffer.from("example\n"));
  const result = await github.fromUrl(new URL("https://github.com/user/repo/blob/main/file.ts"), reserve);
  expect(result?.properties.githubEmbed).toBe(true);
});
