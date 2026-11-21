import assert from "node:assert/strict";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { safeFetch } from "../../../plugins/safe-fetch.ts";

interface Address {
  address: string;
  family: number;
}
type Callback = (error: Error | null, addresses?: Address[]) => void;
interface Options {
  connect: { lookup: (hostname: string, options: { all?: boolean }, callback: Callback) => void };
}
const network = vi.hoisted(() => ({
  fetch:
    vi.fn<(url: URL, options: { signal: AbortSignal; dispatcher?: unknown; redirect?: string }) => Promise<Response>>(),
  lookup: vi.fn<(host: string, options: { all?: boolean }, callback: Callback) => void>(),
  options: undefined as Options | undefined,
  agent: {},
}));
vi.mock("node:dns", () => ({ lookup: network.lookup }));
vi.mock("undici", () => ({
  Agent: class {
    constructor(options: Options) {
      network.options = options;
      network.agent = this;
    }
  },
  fetch: network.fetch,
}));

beforeEach(() => {
  network.fetch.mockReset();
});

describe("safe fetch", () => {
  it.each([
    "0.0.0.0",
    "172.16.0.1",
    "224.0.0.1",
    "[fc00::1]",
    "[fe80::1]",
    "[::ffff:7f00:1]",
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "100.64.0.1",
    "168.63.129.16",
    "[::1]",
    "[::ffff:127.0.0.1]",
    "[2002:0808:0808::]",
    "[64:ff9b::808:808]",
    "2130706433",
    "0177.0.0.1",
    "0x7f000001",
  ])("blocks %s before network access", async (host) => {
    await expect(safeFetch(`http://${host}/`, { maxBytes: 100 })).rejects.toThrow();
    expect(network.fetch).not.toHaveBeenCalled();
  });
  it.each(["file:///etc/passwd", "http://8.8.8.8:8080/", "ftp://8.8.8.8/"])(
    "rejects disallowed URL %s",
    async (url) => {
      await expect(safeFetch(url, { maxBytes: 100 })).rejects.toThrow();
      expect(network.fetch).not.toHaveBeenCalled();
    }
  );
  it("rejects redirects to a private address and excessive redirects", async () => {
    network.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }));
    await expect(safeFetch("https://example.com/", { maxBytes: 10 })).rejects.toThrow();
    expect(network.fetch).toHaveBeenCalledTimes(1);
    network.fetch
      .mockReset()
      .mockImplementation(() => Promise.resolve(new Response(null, { status: 302, headers: { location: "/next" } })));
    await expect(safeFetch("https://example.com/", { maxBytes: 10 })).rejects.toThrow();
    expect(network.fetch).toHaveBeenCalledTimes(4);
    for (const [, options] of network.fetch.mock.calls) {
      expect(options).toMatchObject({ redirect: "manual", dispatcher: network.agent });
    }
  });
  it.each(["file:///etc/passwd", "https://8.8.8.8:8080/"])("rejects redirect to %s", async (location) => {
    network.fetch.mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    await expect(safeFetch("https://example.com/", { maxBytes: 10 })).rejects.toThrow();
    expect(network.fetch).toHaveBeenCalledTimes(1);
  });
  it("enforces byte limits and supports truncation", async () => {
    network.fetch.mockImplementation(() => Promise.resolve(new Response("abcdef")));
    await expect(safeFetch("https://example.com", { maxBytes: 3 })).rejects.toThrow();
    expect((await safeFetch("https://example.com", { maxBytes: 3, truncate: true })).toString()).toBe("abc");
  });
  it("enforces byte limits across multiple chunks", async () => {
    network.fetch.mockImplementation(() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("ab"));
              controller.enqueue(new TextEncoder().encode("cd"));
              controller.enqueue(new TextEncoder().encode("ef"));
              controller.close();
            },
          })
        )
      )
    );
    await expect(safeFetch("https://example.com", { maxBytes: 3 })).rejects.toThrow();
    expect((await safeFetch("https://chunks.example.com", { maxBytes: 3, truncate: true })).toString()).toBe("abc");
  });
  it("shares successful requests with matching options", async () => {
    network.fetch.mockImplementation(() => Promise.resolve(new Response("ok")));
    const url = "https://cache.example/";
    const options = { maxBytes: 10 };
    const [first, second] = await Promise.all([safeFetch(url, options), safeFetch(url, options)]);
    expect(first.toString()).toBe("ok");
    expect(second.toString()).toBe("ok");
    await safeFetch(url, options);
    expect(network.fetch).toHaveBeenCalledTimes(1);
    await safeFetch(url, { maxBytes: 11 });
    await safeFetch(url, { maxBytes: 10, truncate: true });
    expect(network.fetch).toHaveBeenCalledTimes(3);
  });
  it("retries failed requests", async () => {
    network.fetch.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(new Response("ok"));
    const url = "https://retry.example/";
    await expect(safeFetch(url, { maxBytes: 10 })).rejects.toThrow("offline");
    expect((await safeFetch(url, { maxBytes: 10 })).toString()).toBe("ok");
    expect(network.fetch).toHaveBeenCalledTimes(2);
  });
  it("limits concurrent requests", async () => {
    const pending: ((response: Response) => void)[] = [];
    network.fetch.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const requests = Array.from({ length: 5 }, (_, i) =>
      safeFetch(`https://example.com/${String(i)}`, { maxBytes: 10 })
    );
    expect(network.fetch).toHaveBeenCalledTimes(4);
    const first = pending.shift();
    assert.ok(first);
    first(new Response("ok"));
    await vi.waitFor(() => {
      expect(network.fetch).toHaveBeenCalledTimes(5);
    });
    for (const resolve of pending) resolve(new Response("ok"));
    await Promise.all(requests);
  });
});

describe("DNS validation", () => {
  it.each([
    [[{ address: "10.0.0.1", family: 4 }], false],
    [[{ address: "::1", family: 6 }], false],
    [
      [
        { address: "8.8.8.8", family: 4 },
        { address: "192.168.1.1", family: 4 },
      ],
      false,
    ],
    [
      [
        { address: "8.8.8.8", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
      true,
    ],
  ])("validates every resolved address", async (addresses, allowed) => {
    network.lookup.mockImplementation((_host, options, callback) => {
      expect(options.all).toBe(true);
      callback(null, addresses);
    });
    const options = network.options;
    assert.ok(options);
    const result = await new Promise<[Error | null, Address[] | undefined]>((resolve) => {
      options.connect.lookup("example.com", { all: true }, (error, addresses) => {
        resolve([error, addresses]);
      });
    });
    if (allowed) expect(result).toEqual([null, addresses]);
    else expect(result[0]).toBeInstanceOf(Error);
  });
  it("validates the DNS lookup of a redirect destination", async () => {
    network.lookup.mockImplementation((host, _options, callback) => {
      callback(null, [{ address: host === "internal.example" ? "127.0.0.1" : "8.8.8.8", family: 4 }]);
    });
    network.fetch.mockImplementation(async (url, { dispatcher }) => {
      assert.ok(dispatcher);
      const options = network.options;
      assert.ok(options);
      await new Promise<void>((resolve, reject) => {
        options.connect.lookup(url.hostname, {}, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      return new Response(null, { status: 302, headers: { location: "https://internal.example/" } });
    });
    await expect(safeFetch("https://public.example/", { maxBytes: 10 })).rejects.toThrow(/非公開/);
    expect(network.lookup.mock.calls.map(([host]) => host)).toEqual(["public.example", "internal.example"]);
  });
});

describe("timeout", () => {
  it("shares the 15 second deadline across redirects and body reads", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort(new Error("timeout"));
      }, ms);
      return controller.signal;
    });
    try {
      network.fetch.mockImplementation(
        (_url, { signal }) =>
          new Promise((resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                const reason: unknown = signal.reason;
                reject(reason instanceof Error ? reason : new Error("aborted"));
              },
              { once: true }
            );
            setTimeout(() => {
              resolve(new Response(null, { status: 302, headers: { location: "/next" } }));
            }, 10_000);
          })
      );
      const request = safeFetch("https://example.com", { maxBytes: 10 });
      const assertion = expect(request).rejects.toThrow("timeout");
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
      expect(network.fetch).toHaveBeenCalledTimes(2);
      expect(network.fetch.mock.calls[0]?.[1].signal).toBe(network.fetch.mock.calls[1]?.[1].signal);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });
  it("aborts a stalled response body at the deadline", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => {
        controller.abort(new Error("body timeout"));
      }, ms);
      return controller.signal;
    });
    try {
      network.fetch.mockImplementation((_url, { signal }) =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                signal.addEventListener(
                  "abort",
                  () => {
                    controller.error(signal.reason);
                  },
                  { once: true }
                );
              },
            })
          )
        )
      );
      const assertion = expect(safeFetch("https://example.com", { maxBytes: 10 })).rejects.toThrow("body timeout");
      await vi.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });
});
