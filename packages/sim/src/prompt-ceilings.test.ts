import { describe, expect, it } from "vitest";
import { CHRONICLE_SYSTEM_PROMPT } from "./chronicle";
import { COGNITION_SYSTEM_PROMPT } from "./cognition";
import { FACT_RECONCILE_SYSTEM_PROMPT } from "./reconcile-facts";
import { DELTA_REPAIR_SYSTEM_PROMPT } from "./repair-deltas";

/**
 * Ceilings for every system prompt but the orchestrator's, which has its own
 * with its own history (prompt-smoke.test.ts), and the rule writer's (there
 * too).
 *
 * The orchestrator's ceiling was the only one, so the cognition prompt -- sent
 * once per shard per round, several times a burst, and carrying the same
 * generated delta schema -- could grow without anybody noticing. A ceiling
 * here moves the way that one does: only for a real new capability, by the
 * least it needs, with a dated line saying why.
 *
 * Measured 2026-09-28, after `AgreementKind`, `FamilyKind` and
 * `GovernmentForm` were named once in the schema instead of spelled out at
 * every use (orchestrator 68 320 -> 67 751, cognition 62 202 -> 61 775).
 */
describe("the system prompts stay the size they are", () => {
  it("cognition: its rules and the proposal schema, sent with every round", () => {
    // Most of this is the delta union's generated schema, shared with the
    // orchestrator's: a field added to `deltas.ts` grows both. The margin is
    // a little wider than the orchestrator's for that reason, so a change
    // that pays its way there is not refused here.
    // Raised 63k -> 73k (2026-10-03), for the same schema as the orchestrator's.
    expect(COGNITION_SYSTEM_PROMPT.length).toBeLessThan(73_000);
  });

  it("the historian, the repairer and the reconciler: prose only", () => {
    expect(CHRONICLE_SYSTEM_PROMPT.length).toBeLessThan(4_500);
    expect(DELTA_REPAIR_SYSTEM_PROMPT.length).toBeLessThan(1_300);
    expect(FACT_RECONCILE_SYSTEM_PROMPT.length).toBeLessThan(1_400);
  });
});
