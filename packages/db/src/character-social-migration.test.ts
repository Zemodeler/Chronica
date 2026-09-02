import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("character_profiles / character_social_events migration", () => {
  const sql = readFileSync(fileURLToPath(new URL("../migrations/0027_character_social.sql", import.meta.url)), "utf8");

  it("creates both tables", () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "character_profiles"');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "character_social_events"');
  });

  it("scopes both tables to a game and never carries relationship score, availability, or location", () => {
    expect(sql).toMatch(/"character_profiles"[\s\S]*?"game_id" uuid NOT NULL REFERENCES "games"/);
    expect(sql).not.toMatch(/"character_profiles"[\s\S]*?relationship_score/);
    expect(sql).not.toMatch(/"character_profiles"[\s\S]*?is_available/);
    expect(sql).not.toMatch(/"character_profiles"[\s\S]*?location_province_id/);
  });

  it("defaults every social event to proposed, never applied, so a fresh row cannot be mistaken for one already resolved", () => {
    expect(sql).toContain(`"status" text NOT NULL DEFAULT 'proposed'`);
  });
});
