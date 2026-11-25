import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";

import { Agent, fetch } from "undici";

// 応答が成功でなかったことを表す（呼び出し側が、ステータスで失敗の原因を区別できるよう、status を保持する）
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${String(status)}`);
    this.status = status;
  }
}

// 記事の作者が指定した URL をビルド時に取得するための fetch
// ビルドを実行する環境の内部ネットワークへ到達させないよう、公開アドレス以外への接続を拒否する
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["168.63.129.16", 32],
  ["224.0.0.0", 3],
] as const) {
  blocked.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["2002::", 16],
  ["fec0::", 10],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(address, prefix, "ipv6");
}

const assertPublic = (address: string) => {
  if (blocked.check(address, isIP(address) === 6 ? "ipv6" : "ipv4")) {
    throw new Error(`非公開のアドレスには接続できません: ${address}`);
  }
};

// 名前解決の結果を、接続の直前に検証する（IP アドレスを直接指定した場合は、この関数が呼ばれない）
const agent = new Agent({
  connect: {
    lookup: (hostname, options, callback) => {
      lookup(hostname, { ...options, all: true }, (error, addresses) => {
        try {
          if (error) throw error;
          for (const { address } of addresses) assertPublic(address);
        } catch (e) {
          callback(e instanceof Error ? e : new Error(String(e)), "", 0);
          return;
        }
        if (options.all) callback(null, addresses);
        else if (addresses[0]) callback(null, addresses[0].address, addresses[0].family);
        else callback(new Error("名前解決の結果がありません"), "", 0);
      });
    },
  },
});

// 1回の取得は、リダイレクト3回、タイムアウト15秒、本文 maxBytes まで
const get = async (
  href: string,
  { maxBytes, truncate, headers }: { maxBytes: number; truncate: boolean; headers: Record<string, string> }
) => {
  const signal = AbortSignal.timeout(15_000);
  const origin = new URL(href).origin;
  for (let redirects = 0; ; redirects++) {
    const url = new URL(href);
    // 認証の情報を、別のオリジンへのリダイレクト先に送らない
    if (url.origin !== origin) headers = {};
    if (!/^https?:$/.test(url.protocol) || !["", "80", "443"].includes(url.port)) {
      throw new Error(`取得できない URL です: ${url.href}`);
    }
    const literal = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal)) assertPublic(literal);
    const response = await fetch(url, {
      dispatcher: agent,
      redirect: "manual",
      signal,
      headers: { ...headers, "user-agent": "Mozilla/5.0 (compatible; CCSBlogBuilder/1.0)" },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel();
      if (redirects === 3) throw new Error(`リダイレクトが多すぎます: ${href}`);
      href = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(response.status);
    }
    const chunks = [];
    let size = 0;
    if (!response.body) throw new Error("応答の本文がありません");
    for await (const value of response.body) {
      const chunk: unknown = value;
      if (!(chunk instanceof Uint8Array)) throw new Error("応答の本文が不正です");
      chunks.push(chunk);
      size += chunk.length;
      if (size > maxBytes) {
        if (!truncate) throw new Error(`サイズが上限（${String(maxBytes)} バイト）を超えています: ${href}`);
        break;
      }
    }
    return Buffer.concat(chunks).subarray(0, maxBytes);
  }
};

// 同時に取得する数に上限を設ける
const maxConcurrent = 4;
let running = 0;
const waiting: (() => void)[] = [];
const cache = new Map<string, Promise<Buffer>>();

// http(s) の URL だけを取得する
// 本文が maxBytes を超えた場合は、truncate が true なら前半だけを返し、false なら失敗にする
// headers は最初の URL と同じオリジンにだけ送る
export const safeFetch = (
  href: string,
  {
    maxBytes,
    truncate = false,
    headers = {},
  }: { maxBytes: number; truncate?: boolean; headers?: Record<string, string> }
) => {
  const key = JSON.stringify([href, maxBytes, truncate, Object.keys(headers)]);
  const cached = cache.get(key);
  if (cached) return cached;
  const request = (async () => {
    if (running >= maxConcurrent) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await get(href, { maxBytes, truncate, headers });
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  })().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, request);
  return request;
};
