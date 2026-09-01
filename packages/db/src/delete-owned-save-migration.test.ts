import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("permanent save deletion migration", () => {
  it("detaches financial and AI audit rows instead of blocking deletion", () => {
    const sql = readFileSync(fileURLToPath(new URL("../migrations/0024_delete_owned_saves.sql", import.meta.url)), "utf8");
    expect(sql).toContain('ALTER TABLE "ai_calls" ALTER COLUMN "game_id" DROP NOT NULL');
    expect(sql.match(/ON DELETE SET NULL/g)).toHaveLength(3);
  });

  it("makes every player-owned save relation cascade", () => {
    const sql = readFileSync(fileURLToPath(new URL("../migrations/0025_cascade_player_owned_save_data.sql", import.meta.url)), "utf8");
    expect(sql.match(/ON DELETE CASCADE/g)).toHaveLength(4);
  });
});
