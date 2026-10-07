import { defineConfig } from "vitest/config";

export default defineConfig({
  // The components are built by Next (jsx: preserve); the tests that draw one to markup compile it themselves.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: {
      "server-only": new URL("./test/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
