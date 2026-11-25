import stylistic from "@stylistic/eslint-plugin";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

import withNuxt from "./.nuxt/eslint.config.mjs";

export default withNuxt(
  { ignores: ["contents/**", ".output/**", "dist/**"] },
  {
    plugins: { "@stylistic": stylistic },
    rules: {
      "no-console": "warn",
      "prefer-template": "error",
      "no-duplicate-imports": ["error", { allowSeparateTypeImports: true }],
      "@stylistic/padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "import", next: "*" },
        { blankLine: "any", prev: "import", next: "import" },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: 'ImportSpecifier[importKind="type"]', message: "Use a top-level type import." },
      ],
    },
  },
  {
    files: ["**/*.{ts,vue}"],
    rules: {
      // @nuxt/eslint-config が有効にする strict-type-checked に、stylistic-type-checked のルールを加える
      ...tseslint.configs.stylisticTypeChecked.at(-1)?.rules,
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-use-before-define": "error",
    },
  },
  {
    // fuzzing の入力は、意図的に制御文字やゼロ幅文字を含み、実行回数などを出力する
    files: ["src/test/fuzz/**/*.ts"],
    rules: { "no-console": "off", "no-control-regex": "off", "no-irregular-whitespace": "off" },
  },
  prettier
);
