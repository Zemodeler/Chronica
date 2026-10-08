import { describe, expect, it } from "vitest";
import { OrchestratorOutputSchema, WorldDeltaSchema, type OrchestratorOutput } from "@chronica/shared";
import { partsNotCarriedOut, replacingPart } from "./orchestrate";
import { recordDelegations } from "./burst";
import { createIdFactory } from "./ports";
import { opening } from "./fiscal-test-kit";

/**
 * A part asked for again used to leave what the first answer wrote for it
 * beside what replaced it: its act done twice, its delegation held twice, its
 * fact told twice. A part refused with a reason, or told to stay as it is, was
 * asked for again for nothing.
 */

const answer = (change: Record<string, unknown>): OrchestratorOutput => OrchestratorOutputSchema.parse({
  intent: { summary: "x", domains: ["administration"], parts: [] }, narrativeSummary: "x", frictions: [], deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null, ...change,
});
const gift = (reason: string) => WorldDeltaSchema.parse({ op: "public_benefaction", kind: "feast", payerAccountRef: "rome-treasury", amount: 100, reason });
const fact = (localId: string) => ({ localId, kind: "family_matter", summary: "A family matter.", affectedRefs: [{ kind: "character", id: "gaius-genucius" }], visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 20 });

describe("a part asked for again", () => {
  it("replaces what the first answer wrote for it: one act, one delegation, one fact", () => {
    const original = answer({
      intent: { summary: "x", domains: ["administration"], parts: [
        { said: "Give a feast for the people.", acts: [0], goals: [], spend: null, factLocalIds: ["feast_fact"], whyNot: null },
        { said: "Write to the consul.", acts: [1], goals: [], spend: null, factLocalIds: [], whyNot: null },
      ] },
      deltas: [gift("the wrong sort of act, first time"), gift("the consul's letter, standing in")],
      facts: [fact("feast_fact")],
      delegations: [{ localId: "d1", issuerRef: { kind: "character", id: "gaius-genucius" }, recipientRef: { kind: "character", id: "gnaeus-cornelius" }, claimedAuthorityGrantRef: null, instruction: "Give the feast.", part: 0 }],
    });
    const retry = answer({
      intent: { summary: "x", domains: ["administration"], parts: [{ said: "Give a feast for the people.", acts: [0], goals: [], spend: null, factLocalIds: ["feast_fact"], whyNot: null }] },
      deltas: [gift("the right act, second time")],
      facts: [fact("feast_fact")],
      delegations: [{ localId: "d1", issuerRef: { kind: "character", id: "gaius-genucius" }, recipientRef: { kind: "character", id: "gnaeus-cornelius" }, claimedAuthorityGrantRef: null, instruction: "Give the feast.", part: 0 }],
    });
    const merged = replacingPart(original, 0, retry);
    expect(merged.deltas.map((delta) => (delta as { reason: string }).reason)).toEqual(["the consul's letter, standing in", "the right act, second time"]);
    // The other part still names its own act, in its new place.
    expect(merged.intent.parts[1]!.acts).toEqual([0]);
    expect(merged.intent.parts[0]!.acts).toEqual([1]);
    expect(merged.facts).toHaveLength(1);
    expect(merged.delegations).toHaveLength(1);
  });

  it("is not asked for when the part was refused with a reason, or says to stay as he is", () => {
    const refused = answer({ intent: { summary: "x", domains: ["administration"], parts: [{ said: "Declare war on Carthage.", acts: [], goals: [], spend: null, factLocalIds: [], whyNot: "Only the Senate could decide it, and he is no magistrate." }] } });
    expect(partsNotCarriedOut(refused)).toEqual([]);
    const staying = answer({ intent: { summary: "x", domains: ["administration"], parts: [{ said: "Keep my place in the maniple.", acts: [], goals: [], spend: null, factLocalIds: [], whyNot: null }] } });
    expect(partsNotCarriedOut(staying)).toEqual([]);
    const forgotten = answer({ intent: { summary: "x", domains: ["administration"], parts: [{ said: "Give a feast for the people.", acts: [], goals: [], spend: null, factLocalIds: [], whyNot: null }] } });
    expect(partsNotCarriedOut(forgotten)).toHaveLength(1);
  });

  it("does not hand the same order to the same man twice", () => {
    const world = opening(150);
    const ids = createIdFactory("dup");
    const one = { localId: "d1", issuerRef: { kind: "character" as const, id: "gaius-genucius" }, recipientRef: { kind: "character" as const, id: "gnaeus-cornelius" }, claimedAuthorityGrantRef: null, instruction: "Find bread for the army.", part: null };
    const once = recordDelegations(world, [one, { ...one, localId: "d2", instruction: "Find  bread for the ARMY." }], ids, new Map(), []);
    expect(once.orderAttempts.filter((attempt) => attempt.instruction.startsWith("Find"))).toHaveLength(1);
    const again = recordDelegations(once, [one], ids, new Map(), []);
    expect(again.orderAttempts.filter((attempt) => attempt.instruction.startsWith("Find"))).toHaveLength(1);
  });
});
