import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** A file of this repository, by its path from here: portable across checkouts and worktrees. */
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // The sibling packages by source path rather than through node_modules:
    // in a linked worktree the links point at another checkout, and a test
    // must run against the sources of the branch it sits on.
    alias: [
      { find: /^@chronica\/shared$/, replacement: here("../shared/src/index.ts") },
      { find: /^@chronica\/billing$/, replacement: here("../billing/src/index.ts") },
    ],
  },
  test: { environment: "node" },
});
