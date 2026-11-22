export const usePostBodyInteractions = () => {
  const selectTab = (tab: HTMLButtonElement) => {
    const tabs = tab.parentElement!;
    for (const item of tabs.querySelectorAll<HTMLButtonElement>(':scope > [role="tab"]')) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")!)!.hidden = !selected;
    }
    if (tabs.classList.contains("code-preview-tabs")) {
      tabs.closest(".code-block")!.querySelector<HTMLElement>(".code-wrap")!.style.display =
        tab === tabs.lastElementChild ? "none" : "";
    }
  };

  // URL の見出しが閉じた details の中にあれば、外側から順に開いてからスクロールする
  const revealHash = () => {
    let id: string;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      // `#100%` のような不正なフラグメントでは、見出しを開かない（例外にして、記事の初期化を止めない）
      return;
    }
    const target = id ? document.getElementById(id) : null;
    if (!target?.closest(".prose")) return;
    const closed = [
      ...(function* () {
        for (let el = target.parentElement?.closest("details"); el; el = el.parentElement?.closest("details")) yield el;
      })(),
    ].filter((details) => !details.open);
    if (!closed.length) return;
    for (const details of closed.reverse()) details.open = true;
    target.scrollIntoView();
  };

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element;
    if (!target.closest(".prose")) return;
    const anchor = target.closest("a");
    if (anchor?.hash && anchor.origin === location.origin && anchor.pathname === location.pathname) {
      // 同じ URL のリンクは hashchange が起きないため、ここで処理する
      setTimeout(revealHash);
    }
    const tab = target.closest<HTMLButtonElement>('.code-tabs > [role="tab"]');
    if (tab) {
      selectTab(tab);
      return;
    }
    const button = target.closest<HTMLButtonElement>(".code-copy, .code-wrap");
    if (button) {
      const block = button.closest<HTMLElement>(".code-block")!;
      if (button.classList.contains("code-copy")) {
        void navigator.clipboard.writeText(block.dataset.code!).then(() => {
          button.setAttribute("aria-label", "コピーしました");
          const icons = button.querySelectorAll<SVGElement>("svg");
          icons[0]!.style.display = "";
          icons[1]!.style.display = "none";
          setTimeout(() => {
            button.setAttribute("aria-label", "コードをコピー");
            icons[0]!.style.display = "none";
            icons[1]!.style.display = "";
          }, 2000);
        });
      } else if (button.classList.contains("code-wrap")) {
        const pressed = button.getAttribute("aria-pressed") !== "true";
        button.setAttribute("aria-pressed", String(pressed));
        button.setAttribute("aria-label", pressed ? "折り返しをやめて横スクロールにする" : "コードを折り返す");
        const icons = button.querySelectorAll<SVGElement>("svg");
        icons[0]!.style.display = pressed ? "" : "none";
        icons[1]!.style.display = pressed ? "none" : "";
        block.querySelector("pre")!.classList.toggle("code-wrapped", pressed);
      }
      return;
    }
  };

  const onKeydown = (event: KeyboardEvent) => {
    const tab = (event.target as Element).closest<HTMLButtonElement>('.code-tabs > [role="tab"]');
    if (!tab) return;
    const tabs = [...tab.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = tabs.indexOf(tab);
    const next = {
      ArrowRight: (index + 1) % tabs.length,
      ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next]!);
    tabs[next]!.focus();
  };

  const loadTwitter = (embeds: NodeListOf<HTMLElement>) => {
    const { twttr } = window as unknown as { twttr?: { widgets?: { load: (element: HTMLElement) => void } } };
    if (!twttr?.widgets) return;
    for (const embed of embeds) {
      if (!embed.closest("details:not([open])")) {
        embed.querySelector("blockquote")?.classList.add("twitter-tweet");
        twttr.widgets.load(embed);
      }
    }
  };

  const onToggle = (event: Event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open || !details.closest(".prose")) return;
    loadTwitter(details.querySelectorAll<HTMLElement>(".twitter-embed"));
  };

  onMounted(() => {
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("toggle", onToggle, true);
    window.addEventListener("hashchange", revealHash);
    revealHash();
    const embeds = document.querySelectorAll<HTMLElement>(".prose .twitter-embed");
    if (embeds.length) {
      const src = "https://platform.twitter.com/widgets.js";
      const { twttr } = window as unknown as { twttr?: { widgets?: { load: (element: HTMLElement) => void } } };
      if (twttr?.widgets) loadTwitter(embeds);
      else if (!document.querySelector(`script[src="${src}"]`)) {
        const script = Object.assign(document.createElement("script"), { src, async: true });
        script.addEventListener(
          "load",
          () => {
            loadTwitter(document.querySelectorAll<HTMLElement>(".prose .twitter-embed"));
          },
          { once: true }
        );
        document.head.append(script);
      }
    }
  });
  onBeforeUnmount(() => {
    document.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("toggle", onToggle, true);
    window.removeEventListener("hashchange", revealHash);
  });
};
