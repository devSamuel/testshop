import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

const noComments = {
  meta: {
    type: "suggestion",
    docs: { description: "Disallow source comments; code should explain itself" },
    messages: { found: "Comments are not allowed in this codebase." },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: "found" });
        }
      },
    };
  },
};

const local = { rules: { "no-comments": noComments } };

export default defineConfig([
  globalIgnores(["dist", "coverage", "node_modules", "playwright-report", "test-results"]),
  {
    files: ["**/*.{js,cjs,ts,tsx}"],
    plugins: { local },
    rules: { "local/no-comments": "error" },
  },
  {
    files: ["*.config.js", "*.config.cjs"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat["recommended-latest"],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "interface"],
      "no-console": ["error", { allow: ["error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "react-refresh/only-export-components": "off",
    },
  },
]);
