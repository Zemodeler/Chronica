import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { NEUTRAL_MIND, WorldStateSchema, deriveDefaultMind } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { games, turns, worldSnapshots } from "../schema/game";

// Backfill: neutral schema-level `mind` default → a properly role-derived one
// (character-sim phase 2).
//
// `Character.mind` defaults to `NEUTRAL_MIND` at the Zod level so an archived
// snapshot from before this field existed still parses -- but a flat neutral
// mind for everyone is not what the spec calls for ("prefer authored scenario
// values; otherwise derive conservative defaults from role, skills, office,
// age, culture"). This idempotent pass replaces any character whose `mind`
// is still exactly `NEUTRAL_MIND` with one `deriveDefaultMind` computes from
// their canonical state, and leaves every other character -- one already
// authored, or already backfilled -- untouched. Same in-place
// snapshot-correction pattern as `backfillNpcCharacters` (character-sim
// phase 1) and the original coin-denomination migration.

export interface MindBackfillReport {
  gamesScanned: number;
  gamesUpdated: number;
  charactersScanned: number;
  charactersBackfilled: number;
}

function isNeutralMind(mind: unknown): boolean {
  return JSON.stringify(mind) === JSON.stringify(NEUTRAL_MIND);
}

export async function backfillCharacterMinds(db: ChronicaDatabase): Promise<MindBackfillReport> {
  const report: MindBackfillReport = { gamesScanned: 0, gamesUpdated: 0, charactersScanned: 0, charactersBackfilled: 0 };
  const allGames = await db.select({ id: games.id }).from(games);

  for (const game of allGames) {
    report.gamesScanned++;

    const [snapshotRow] = await db
      .select({ turnId: worldSnapshots.turnId, state: worldSnapshots.state })
      .from(worldSnapshots)
      .innerJoin(turns, eq(turns.id, worldSnapshots.turnId))
      .where(eq(turns.gameId, game.id))
      .orderBy(desc(turns.index))
      .limit(1);
    if (snapshotRow === undefined) continue;

    const parsedWorld = WorldStateSchema.safeParse(snapshotRow.state);
    if (!parsedWorld.success) continue;

    let changed = false;
    const characters = parsedWorld.data.characters.map((character) => {
      report.charactersScanned++;
      if (!isNeutralMind(character.mind)) return character;
      changed = true;
      report.charactersBackfilled++;
      return {
        ...character,
        mind: deriveDefaultMind({
          officeId: character.officeId,
          skills: character.skills,
          ageYears: character.ageYearsAtStart,
          cultureId: character.cultureId,
        }),
      };
    });

    if (!changed) continue;

    const world = { ...parsedWorld.data, characters };
    const worldJson = JSON.stringify(world);
    const stateHash = createHash("sha256").update(worldJson).digest("hex");
    await db
      .update(worldSnapshots)
      .set({ state: JSON.parse(worldJson) as unknown, stateHash })
      .where(eq(worldSnapshots.turnId, snapshotRow.turnId));
    report.gamesUpdated++;
  }

  return report;
}
