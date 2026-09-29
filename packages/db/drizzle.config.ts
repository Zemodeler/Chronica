import { defineConfig } from "drizzle-kit";

// Migrations 0012-0042 were written by hand, and the snapshots drizzle-kit
// diffs against stopped at 0011 -- so `generate` would have produced one
// enormous migration re-creating everything since. `meta/0042_snapshot.json`
// is the schema as of 0042, regenerated from `src/schema` (2026-09-28): with
// it, `generate` against today's schema reports no changes. A migration
// written by hand from here on should be followed by a fresh snapshot the same
// way (generate into an empty folder, copy its snapshot in as `<idx>_snapshot`
// with `prevId` set to the last one's `id`), or `generate` drifts again.

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://chronica:chronica@localhost:5432/chronica" },
  strict: true,
});
