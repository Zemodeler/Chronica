import eslint from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [".claude/worktrees/**", "**/.next/**", "**/coverage/**", "**/dist/**", "**/next-env.d.ts", "**/node_modules/**", "scripts/**"],
  },
  eslint.configs.recommended,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
    },
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },
  {
    // packages/sim is pure and deterministic (docs/architecture.md).
    // scripts/check-sim-purity.mjs is the CI gate; this block is the same rule
    // in the editor, where it is cheap to obey and expensive to discover later.
    files: ["packages/sim/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "Elapsed simulation time is world state -- take the step as an argument." },
        { name: "process", message: "Configuration is an argument, not an ambient read." },
        { name: "fetch", message: "packages/sim performs no I/O -- pass the data in." },
        { name: "performance", message: "A timing read is still a clock read." },
        { name: "crypto", message: "Ids come from the burst's IdFactory (packages/sim/src/ports.ts), never from entropy." },
      ],
      // Math.floor/min/max are deterministic and wanted; only the entropy is not.
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Rolls are stableHash/stableChoice over canonical inputs (packages/shared/src/determinism.ts)." },
        { object: "Date", property: "now", message: "Elapsed simulation time is world state -- take the step as an argument." },
        { object: "performance", property: "now", message: "A timing read is still a clock read." },
        { object: "crypto", property: "randomUUID", message: "Ids come from the burst's IdFactory (packages/sim/src/ports.ts), never from entropy." },
      ],
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["node:*", "fs", "path", "crypto"], message: "packages/sim performs no I/O." }] },
      ],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": "allow-with-description" }],
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
    },
  },
);
