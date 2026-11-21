import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 120,
  trailingComma: "es5",
  sortPackageJson: false,
  ignorePatterns: ["pnpm-lock.yaml", "node_modules/", ".nuxt/", ".output/", ".data/", "dist/", "contents/"],
  sortImports: { groups: ["builtin", "external", "internal", ["parent", "sibling"], "type", "index"] },
});
