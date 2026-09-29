import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { computeOpinion, deriveRelationDimension, stableHash, WorldStateSchema, type OrderAttempt, type WorldState } from "@chronica/shared";
import { answerByTemper, defianceOf } from "./insubordination";

/**
 * A consul gives an order to a man who loathes him, whose faction stands
 * against him, and whom nothing binds. The man used to accept it as readily
 * as a devoted client; now his own temper answers it before he is asked.
 */

const base = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

const order = (id: string, recipient = "quintus-fabius", issuer = "marcus-atilius"): OrderAttempt => ({
  id, actionId: `action-${id}`,
  issuerRef: { kind: "character", id: issuer }, recipientRef: { kind: "character", id: recipient },
  claimedAuthorityGrantId: null,
  authorityCheck: { authorized: true, grant: null, standing: null, reason: "the consul" },
  instruction: "March the second legion to Messana", standing: "binding",
  status: "issued", recipientDecisionReason: null, issuedAtStep: 0, decidedAtStep: null, consequenceFactRefs: [],
});

/** Quintus, who hates Marcus, has no sense of duty, and no conscience to speak of. */
function aManWhoWillNot(world: WorldState): WorldState {
  return {
    ...world,
    characters: world.characters.map((character) => (character.id === "quintus-fabius"
      ? {
        ...character,
        mind: { ...character.mind, drives: { ...character.mind.drives, duty: 10 }, temperament: { ...character.mind.temperament, honesty: 70 } },
        relations: [{ subjectCharacterId: "marcus-atilius", causes: [{ id: "old-grudge", label: "He shamed me before the Senate.", score: -60, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }],
      }
      : character)),
  };
}

/** The first order id this man's temper actually refuses: the roll is the order's own. */
function anOrderHeRefuses(world: WorldState): OrderAttempt {
  const chance = defianceOf(world, order("probe"))!.chanceBps;
  for (let n = 0; n < 200; n += 1) {
    if (stableHash([`order-${n}`, "defiance"]) % 10_000 < chance) return order(`order-${n}`);
  }
  throw new Error("No order in two hundred that he refuses.");
}

describe("a legate who will not", () => {
  it("is likely to refuse a man he hates, and an honest man refuses to his face", () => {
    const defiance = defianceOf(aManWhoWillNot(base()), order("probe"));
    expect(defiance).not.toBeNull();
    expect(defiance!.chanceBps).toBeGreaterThan(3_000);
    expect(defiance!.answer).toBe("refuse");
    expect(defiance!.why).toContain("no love for");
  });

  it("does as a devoted, dutiful man is told", () => {
    const world = base();
    const devoted: WorldState = {
      ...world,
      characters: world.characters.map((character) => (character.id === "quintus-fabius"
        ? { ...character, traits: ["dutiful"], mind: { ...character.mind, drives: { ...character.mind.drives, duty: 90 } },
          relations: [{ subjectCharacterId: "marcus-atilius", causes: [{ id: "patron", label: "He made me.", score: 40, occurredAtStep: 0, decayPerYearBps: 0, encounterMemoryId: null }] }] }
        : character)),
    };
    expect(defianceOf(devoted, order("probe"))).toBeNull();
  });

  it("answers the order himself, on the record, and is the bolder and less afraid for it", () => {
    const world = aManWhoWillNot(base());
    const refused = anOrderHeRefuses(world);
    const result = answerByTemper({ ...world, orderAttempts: [refused] }, []);
    const decided = result.world.orderAttempts[0]!;
    expect(decided.status).toBe("refused");
    expect(decided.recipientDecisionReason).toContain("no love for");
    // Never a silent drop: the refusal reaches the record.
    expect(result.facts.map((fact) => fact.kind)).toEqual(["order_refused"]);
    const quintus = result.world.characters.find((character) => character.id === "quintus-fabius")!;
    const marcus = result.world.characters.find((character) => character.id === "marcus-atilius")!;
    expect(quintus.lessons?.map((lesson) => lesson.kind)).toEqual(["defied"]);
    expect(deriveRelationDimension(quintus, "marcus-atilius", "fear")).toBeLessThan(0);
    expect(computeOpinion(marcus, "quintus-fabius")).toBeLessThan(0);
    // Asked twice, the same answer: the roll is the order's own.
    expect(answerByTemper(result.world, []).facts).toEqual([]);
  });

  it("never answers for the player", () => {
    const world = aManWhoWillNot(base());
    const refused = anOrderHeRefuses(world);
    const result = answerByTemper({ ...world, orderAttempts: [refused] }, ["quintus-fabius"]);
    expect(result.world.orderAttempts[0]!.status).toBe("issued");
  });

  it("leaves an order from a man with no standing to give it to the man himself", () => {
    const world = aManWhoWillNot(base());
    expect(defianceOf(world, { ...order("probe"), standing: "presumptuous" })).toBeNull();
  });
});
