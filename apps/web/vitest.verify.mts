import { defineConfig } from "vitest/config";
const pkg = (p: string) => "C:/Users/andrei/AppData/Roaming/Harbor/worktrees/e515963d/implement-durable-turns-and-chro-5dcf9e/packages/" + p;
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: [
    { find: "server-only", replacement: "C:/Users/andrei/AppData/Roaming/Harbor/worktrees/e515963d/implement-durable-turns-and-chro-5dcf9e/apps/web/test/server-only.ts" },
    { find: /^@chronica\/db$/, replacement: pkg("db/src/index.ts") },
    { find: /^@chronica\/shared$/, replacement: pkg("shared/src/index.ts") },
    { find: /^@chronica\/sim$/, replacement: pkg("sim/src/index.ts") },
    { find: /^@chronica\/billing$/, replacement: pkg("billing/src/index.ts") },
  ] },
  test: { exclude: ["e2e/**", "node_modules/**", ".next/**"] },
});
