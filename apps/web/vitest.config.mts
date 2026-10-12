import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** A file of this repository, by its path from here: portable across checkouts and worktrees. */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // The components are built by Next (jsx: preserve); the tests that draw one to markup compile it themselves.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    alias: [
      { find: "server-only", replacement: here("./test/server-only.ts") },
      // The workspace packages by source path rather than through node_modules:
      // in a linked worktree the links point at another checkout, and a test
      // must run against the sources of the branch it sits on.
      { find: /^@chronica\/db\/schema$/, replacement: here("../../packages/db/src/schema/index.ts") },
      { find: /^@chronica\/db$/, replacement: here("../../packages/db/src/index.ts") },
      { find: /^@chronica\/shared$/, replacement: here("../../packages/shared/src/index.ts") },
      { find: /^@chronica\/sim$/, replacement: here("../../packages/sim/src/index.ts") },
      { find: /^@chronica\/ai$/, replacement: here("../../packages/ai/src/index.ts") },
      { find: /^@chronica\/billing$/, replacement: here("../../packages/billing/src/index.ts") },
    ],
  },
  test: {
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
