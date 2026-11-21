import type { VFile } from "vfile";

interface Image {
  src: string;
  large?: string;
}
const images = new WeakMap<VFile, { count: number; generated: Map<string, Image> }>();

export const imageState = (file: VFile) => {
  let state = images.get(file);
  if (!state) {
    state = { count: 0, generated: new Map() };
    images.set(file, state);
  }
  return state;
};

export interface ArticleFile {
  articleContext?: { excerpt?: string };
}
