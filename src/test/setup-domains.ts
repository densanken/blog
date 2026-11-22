import { knownDomains } from "../../plugins/url-guard.ts";

// 誤ってリンクを開いても実在のサイトに接続しないよう、テストの偽装ドメインは予約済みの TLD（.test）にする
// 偽装の元になるドメインとして、knownDomains の .com を .test にしたものを足す
export const testDomains = knownDomains
  .filter((domain) => domain.endsWith(".com"))
  .map((domain) => domain.replace(/\.com$/, ".test"));
for (const domain of testDomains) if (!knownDomains.includes(domain)) knownDomains.push(domain);
