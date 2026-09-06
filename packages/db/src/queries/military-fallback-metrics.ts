import { eq, isNotNull } from "drizzle-orm";
import type { ChronicaDatabase } from "../database";
import { turns } from "../schema/game";

// Military-emergency fallback firing-rate (docs/29).
//
// `apps/web/lib/resolution/military-emergency-fallback.ts`'s own removal
// criterion is evidence, not a code-reading audit: "remove once shadow-turn
// or production evidence shows the Game Master reliably answers every
// military_emergency pressure without this backstop ever firing." Every
// firing is already durably recorded -- `pipeline.ts` tags each one
// `sourceRef: "military_emergency_fallback"` in the `workflow_audit.candidates`
// it writes every turn (see the docs/27 correction) -- so producing the
// evidence is a read, not new instrumentation.

export interface MilitaryFallbackFiringRate {
  readonly totalTurns: number;
  readonly turnsWithFallbackFiring: number;
  /** `turnsWithFallbackFiring / totalTurns`, or 0 when there are no turns yet. */
  readonly firingRate: number;
}

/** Exported for direct unit testing -- the actual parsing logic, independent of the DB round-trip. */
export function fallbackFired(workflowAudit: unknown): boolean {
  if (workflowAudit === null || typeof workflowAudit !== "object") return false;
  const candidates = (workflowAudit as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return false;
  return candidates.some(
    (candidate) =>
      typeof candidate === "object" && candidate !== null
      && (candidate as { sourceRef?: unknown }).sourceRef === "military_emergency_fallback"
      && (candidate as { executionOk?: unknown }).executionOk === true,
  );
}

/**
 * How often the military-emergency fallback actually fired: `gameId` scopes
 * to one campaign, or omit it for a cross-game rollup. Only turns with a
 * recorded `workflow_audit` count toward `totalTurns` -- a turn resolved
 * before this column existed is excluded rather than silently counted as
 * "no firing."
 */
export async function getMilitaryFallbackFiringRate(
  db: ChronicaDatabase,
  gameId?: string,
): Promise<MilitaryFallbackFiringRate> {
  const rows = await db
    .select({ workflowAudit: turns.workflowAudit })
    .from(turns)
    .where(gameId === undefined ? isNotNull(turns.workflowAudit) : eq(turns.gameId, gameId));

  const withAudit = gameId === undefined ? rows : rows.filter((row) => row.workflowAudit !== null);
  const totalTurns = withAudit.length;
  const turnsWithFallbackFiring = withAudit.filter((row) => fallbackFired(row.workflowAudit)).length;
  return {
    totalTurns,
    turnsWithFallbackFiring,
    firingRate: totalTurns === 0 ? 0 : turnsWithFallbackFiring / totalTurns,
  };
}
