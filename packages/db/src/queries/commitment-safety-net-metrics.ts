import { eq, isNotNull } from "drizzle-orm";
import type { ChronicaDatabase } from "../database";
import { turns } from "../schema/game";

// Commitment safety net firing-rate (docs/30, docs/31).
//
// `apps/web/lib/resolution/commitment-safety-net.ts`'s own removal criterion
// is evidence, not a code-reading audit: "remove once shadow-turn or
// production evidence shows the Game Master reliably resolves every due
// commitment without this backstop ever firing." Every firing is already
// durably recorded -- `pipeline.ts` tags each one
// `sourceRef: "commitment_safety_net"` in the `workflow_audit.candidates` it
// writes every turn, the same way the military-emergency fallback is tagged
// -- so producing the evidence is a read, not new instrumentation.

export interface CommitmentSafetyNetFiringRate {
  readonly totalTurns: number;
  readonly turnsWithFallbackFiring: number;
  /** `turnsWithFallbackFiring / totalTurns`, or 0 when there are no turns yet. */
  readonly firingRate: number;
}

/** Exported for direct unit testing -- the actual parsing logic, independent of the DB round-trip. */
export function commitmentSafetyNetFired(workflowAudit: unknown): boolean {
  if (workflowAudit === null || typeof workflowAudit !== "object") return false;
  const candidates = (workflowAudit as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return false;
  return candidates.some(
    (candidate) =>
      typeof candidate === "object" && candidate !== null
      && (candidate as { sourceRef?: unknown }).sourceRef === "commitment_safety_net"
      && (candidate as { executionOk?: unknown }).executionOk === true,
  );
}

/**
 * How often the commitment safety net actually fired: `gameId` scopes to one
 * campaign, or omit it for a cross-game rollup. Only turns with a recorded
 * `workflow_audit` count toward `totalTurns` -- a turn resolved before this
 * column existed is excluded rather than silently counted as "no firing."
 */
export async function getCommitmentSafetyNetFiringRate(
  db: ChronicaDatabase,
  gameId?: string,
): Promise<CommitmentSafetyNetFiringRate> {
  const rows = await db
    .select({ workflowAudit: turns.workflowAudit })
    .from(turns)
    .where(gameId === undefined ? isNotNull(turns.workflowAudit) : eq(turns.gameId, gameId));

  const withAudit = gameId === undefined ? rows : rows.filter((row) => row.workflowAudit !== null);
  const totalTurns = withAudit.length;
  const turnsWithFallbackFiring = withAudit.filter((row) => commitmentSafetyNetFired(row.workflowAudit)).length;
  return {
    totalTurns,
    turnsWithFallbackFiring,
    firingRate: totalTurns === 0 ? 0 : turnsWithFallbackFiring / totalTurns,
  };
}
