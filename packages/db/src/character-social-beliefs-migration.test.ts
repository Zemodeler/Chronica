import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("character_social_events beliefs/pressures migration", () => {
  const sql = readFileSync(fileURLToPath(new URL("../migrations/0028_character_social_beliefs_pressures.sql", import.meta.url)), "utf8");

  it("additively adds both columns, defaulting existing rows to an empty array", () => {
    expect(sql).toContain('ALTER TABLE "character_social_events" ADD COLUMN IF NOT EXISTS "proposed_beliefs" jsonb NOT NULL DEFAULT \'[]\'');
    expect(sql).toContain('ALTER TABLE "character_social_events" ADD COLUMN IF NOT EXISTS "pressure_changes" jsonb NOT NULL DEFAULT \'[]\'');
  });

  it("is idempotent (IF NOT EXISTS on every column add)", () => {
    const alters = sql.match(/ALTER TABLE[^;]+;/g) ?? [];
    expect(alters.length).toBeGreaterThan(0);
    for (const statement of alters) expect(statement).toContain("IF NOT EXISTS");
  });
});
