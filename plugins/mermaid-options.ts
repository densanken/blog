// Mermaid のブラウザーから、ローカルアドレスを含むネットワークへの接続を防ぐ
export const mermaidOptions = {
  mermaidConfig: { securityLevel: "strict" as const },
  launchOptions: {
    chromiumSandbox: true,
    args: [
      "--proxy-server=http://127.0.0.1:9",
      "--proxy-bypass-list=<-loopback>",
      "--host-resolver-rules=MAP * ~NOTFOUND",
    ],
  },
};
