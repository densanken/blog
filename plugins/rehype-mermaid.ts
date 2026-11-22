import { relative } from "node:path";

import rehypeMermaid from "rehype-mermaid";
import { unified } from "unified";

import { authorsPath } from "./content-paths.ts";
import { mermaidOptions } from "./mermaid-options.ts";
import { defect } from "./warn.ts";

import type { Root } from "hast";
import type { VFile } from "vfile";

export default ({ contents }: { contents: string }) => {
  const processor = unified().use(rehypeMermaid, mermaidOptions);
  return async (tree: Root, file: VFile) => {
    try {
      return await processor.run(tree, file);
    } catch (error) {
      const path = `${authorsPath}/${relative(contents, file.path)}`;
      defect(`Mermaid の変換に失敗しました: ${error instanceof Error ? error.message : String(error)}`, path);
      throw error;
    }
  };
};
