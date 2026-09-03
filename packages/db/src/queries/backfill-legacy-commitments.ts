import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { WorldStateSchema, type Commitment, type CommitmentActionKind } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { games, turns, worldSnapshots } from "../schema/game";
import { npcCommitments } from "../schema/dialogue";

// Backfill: legacy `npc_commitments` rows -> the canonical, replayable
// `world.commitments` ledger (character-sim phase 3).
//
// Before this phase, a dialogue-inferred promise lived only as a DB row with
// no authority or resource check behind it -- `promiseType` was free text,
// and nothing enforced that the promisor actually controlled what they
// promised. Going forward, every new commitment is created through
// `applySocialEvents` (character-agency/commitments.ts) with a real
// authority/resource check at creation time; this pass gives an old game's
// still-pending legacy rows a canonical counterpart so its turn pipeline
// (which now reads `world.commitments`, not the DB table) can still see and
// resolve them. Idempotent: a legacy row already folded in (matched by id)
// is left untouched, and a row's amount/office is deliberately left
// unenforced here (the old rows never recorded one) rather than fabricated.

const LEGACY_ACTION_KIND: Record<string, CommitmentActionKind> = {
  money: "payment",
  food: "other",
  shelter: "protection",
  introduction: "political_support",
  information: "information_sharing",
  assistance: "other",
};

export interface LegacyCommitmentBackfillReport {
  gamesScanned: number;
  gamesUpdated: number;
  commitmentsScanned: number;
  commitmentsBackfilled: number;
}

export async function backfillLegacyCommitments(db: ChronicaDatabase): Promise<LegacyCommitmentBackfillReport> {
  const report: LegacyCommitmentBackfillReport = { gamesScanned: 0, gamesUpdated: 0, commitmentsScanned: 0, commitmentsBackfilled: 0 };
  const allGames = await db.select({ id: games.id }).from(games);

  for (const game of allGames) {
    report.gamesScanned++;

    const pendingRows = await db
      .select()
      .from(npcCommitments)
      .where(and(eq(npcCommitments.gameId, game.id), eq(npcCommitments.status, "pending")));
    if (pendingRows.length === 0) continue;

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

    const existingIds = new Set((parsedWorld.data.commitments ?? []).map((c) => c.id));
    const knownCharacterIds = new Set(parsedWorld.data.characters.map((c) => c.id));
    const toAdd: Commitment[] = [];
    for (const row of pendingRows) {
      report.commitmentsScanned++;
      const id = `legacy:${row.id}`;
      if (existingIds.has(id)) continue;
      if (!knownCharacterIds.has(row.npcCharacterId) || !knownCharacterIds.has(row.playerCharacterId)) continue;
      toAdd.push({
        id,
        promisorCharacterId: row.npcCharacterId,
        beneficiaryCharacterId: row.playerCharacterId,
        actionKind: LEGACY_ACTION_KIND[row.promiseType] ?? "other",
        description: row.promisedResult,
        conditions: row.conditions,
        requiredOfficeId: null,
        requiredResource: null,
        visibility: "private",
        sourceEventId: null,
        breachPressureKind: "humiliation",
        status: "pending",
        createdAtStep: row.createdAtStep,
        reviewAtStep: row.createdAtStep + 6,
        resolvedAtStep: null,
        resolutionReason: null,
      });
      report.commitmentsBackfilled++;
    }
    if (toAdd.length === 0) continue;

    const world = { ...parsedWorld.data, commitments: [...(parsedWorld.data.commitments ?? []), ...toAdd] };
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
