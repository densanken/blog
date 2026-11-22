export const analyticsScripts = (id: string) =>
  /^G-[A-Z0-9]+$/.test(id)
    ? [
        { src: `https://www.googletagmanager.com/gtag/js?id=${id}`, async: true },
        {
          innerHTML: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config',${JSON.stringify(id)});`,
        },
      ]
    : [];
