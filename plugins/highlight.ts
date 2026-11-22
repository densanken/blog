import { bundledLanguagesInfo } from "shiki";

import type { BundledLanguage } from "shiki";

export const highlight = {
  theme: { default: "github-light", dark: "github-dark" },
  langs: bundledLanguagesInfo
    .flatMap(({ id, aliases = [] }) => [id, ...aliases])
    .filter((lang): lang is BundledLanguage => /^[\w-]+$/.test(lang)),
} as const;
