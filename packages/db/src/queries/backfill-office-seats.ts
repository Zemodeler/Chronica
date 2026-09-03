import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { WorldStateSchema, type OfficeSeat } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { games, turns, worldSnapshots } from "../schema/game";

// Backfill: pre-phase-4 `Character.officeId` → an authoritative `OfficeSeat`
// (character-sim phase 4).
//
// Before institutions/procedures existed, `officeId` was the only office
// record; there was no holder/term/vacancy/provenance ledger behind it. This
// idempotent pass synthesizes a `held` seat (seatIndex 0) for every office a
// living or dead character's `officeId` still names, with no procedure
// provenance -- the appointment predates procedures, so none can be recorded
// truthfully. It never touches a seat that already exists for that office
// and seat index, so re-running it changes nothing. Same in-place
// snapshot-correction pattern as `backfillCharacterMinds`.

export interface OfficeSeatBackfillReport {
  gamesScanned: number;
  gamesUpdated: number;
  seatsCreated: number;
}

export async function backfillOfficeSeats(db: ChronicaDatabase): Promise<OfficeSeatBackfillReport> {
  const report: OfficeSeatBackfillReport = { gamesScanned: 0, gamesUpdated: 0, seatsCreated: 0 };
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

    const existingSeats = parsedWorld.data.material.officeSeats;
    const newSeats: OfficeSeat[] = [];
    for (const character of parsedWorld.data.characters) {
      if (character.officeId === null) continue;
      const alreadySeated = existingSeats.some((seat) => seat.officeId === character.officeId && seat.seatIndex === 0);
      if (alreadySeated) continue;
      newSeats.push({
        id: `${character.officeId}:seat:0`,
        officeId: character.officeId,
        seatIndex: 0,
        holderCharacterId: character.id,
        status: "held",
        vacancyCause: "none",
        termStartedAtStep: 0,
        termExpiresAtStep: null,
        appointmentProcedureId: null,
        removalProcedureId: null,
        eligibilityRequirementIds: [],
      });
    }

    if (newSeats.length === 0) continue;
    report.seatsCreated += newSeats.length;

    const world = {
      ...parsedWorld.data,
      material: { ...parsedWorld.data.material, officeSeats: [...existingSeats, ...newSeats] },
    };
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
