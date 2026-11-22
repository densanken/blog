import type { TocLink } from "@nuxt/content";

export type TocPart = { text: string } | { svg: string };
export type IconTocLink = Omit<TocLink, "children"> & {
  parts?: TocPart[];
  iconLabel?: string;
  children?: IconTocLink[];
};
