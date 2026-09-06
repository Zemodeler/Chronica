import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { WorldStateSchema } from "@chronica/shared";
import type { ChronicaDatabase } from "../database";
import { worldSnapshots } from "../schema/game";

// Repair: two resolution-time code paths (auto-resolving a storyline whose
// province changed hands, and the `resolve_storyline` workflow) used to set
// `nextDevelopment: ""` on the storyline they closed out. `WorldStateSchema`
// requires `nextDevelopment` to be non-empty, so any snapshot saved while
// that bug was live now fails validation on every read. Both call sites are
// fixed going forward; this repairs snapshots already persisted with the bad
// value. Idempotent -- a snapshot with no empty `nextDevelopment` is left
// untouched.

export interface StorylineNextDevelopmentRepairReport {
  snapshotsScanned: number;
  snapshotsRepaired: number;
  storylinesRepaired: number;
}

export async function repairEmptyStorylineNextDevelopment(db: ChronicaDatabase): Promise<StorylineNextDevelopmentRepairReport> {
  const report: StorylineNextDevelopmentRepairReport = { snapshotsScanned: 0, snapshotsRepaired: 0, storylinesRepaired: 0 };
  const rows = await db.select({ turnId: worldSnapshots.turnId, state: worldSnapshots.state }).from(worldSnapshots);

  for (const row of rows) {
    report.snapshotsScanned++;
    const state = row.state as { storylines?: unknown };
    if (!Array.isArray(state?.storylines)) continue;

    let changed = false;
    const storylines = state.storylines.map((s: unknown) => {
      if (typeof s !== "object" || s === null) return s;
      const storyline = s as Record<string, unknown>;
      if (storyline.nextDevelopment !== "") return storyline;
      changed = true;
      report.storylinesRepaired++;
      const phase = typeof storyline.phase === "string" ? storyline.phase : "resolved";
      return { ...storyline, nextDevelopment: `${phase === "resolved" ? "Resolved" : "Pending"}: see history.` };
    });
    if (!changed) continue;

    const world = { ...(row.state as object), storylines };
    const parsed = WorldStateSchema.safeParse(world);
    if (!parsed.success) continue; // don't write a snapshot that still fails validation

    const worldJson = JSON.stringify(world);
    const stateHash = createHash("sha256").update(worldJson).digest("hex");
    await db
      .update(worldSnapshots)
      .set({ state: JSON.parse(worldJson) as unknown, stateHash })
      .where(eq(worldSnapshots.turnId, row.turnId));
    report.snapshotsRepaired++;
  }

  return report;
}
