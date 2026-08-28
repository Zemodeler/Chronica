import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": new URL("./test/server-only.ts", import.meta.url).pathname,
    },
  },
  test: {
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
