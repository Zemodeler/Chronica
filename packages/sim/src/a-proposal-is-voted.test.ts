import { describe, expect, it } from "vitest";
import { WorldDeltaSchema, atWar, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { as, definition, holdersOf, opening } from "./competence-test-kit";
import type { SimModelPort } from "./ports";
import { stanceOfPart, stanceOfWords } from "./stance";
import { usurpedLately } from "./usurpation";

/**
 * A proposal is voted (the user's rule, 2026-10-08): "If the player says 'propose to declare war' the Senate votes; if he says 'I declare war' the engine takes the
 * consequences of that action: he said it, it happened." The words decide (`stance.ts`), the orchestrator's reading standing where they are plain neither way.
 */

const [CONSUL] = holdersOf(opening(), "roman-consul") as [string];

describe("a proposal is voted", () => {
  it("reads 'I declare' and 'I order' as done, and 'propose', 'move', 'ask the Senate', 'put to the vote' as moved", () => {
    for (const said of ["I declare war on Carthage.", "I hereby declare war.", "I order a levy of two legions", "We declare war on Syracuse.", "By my own word, the war begins."]) expect(stanceOfWords(said), said).toBe("declare");
    for (const said of ["I propose that Rome declare war on Carthage.", "Propose to declare war on Carthage", "I move that the Senate vote a war.", "Ask the Senate to declare war.", "Put it to the vote: war on Carthage.", "I request the Senate's leave for a levy."]) expect(stanceOfWords(said), said).toBe("propose");
    // Where the words say neither, nothing is said, and the engine's default holds; "I do not declare" is no declaration.
    for (const said of ["Raise two legions.", "War on Carthage.", "I do not declare war."]) expect(stanceOfWords(said), said).toBeNull();
    // Both ways at once is a motion: the cautious reading.
    expect(stanceOfWords("I declare that I propose war.")).toBe("propose");
  });

  it("reads each part of an order by its own clause, and leaves the orchestrator's reading where the words are plain neither way", () => {
    const order = "I declare war on Carthage. Propose a levy of four legions to the Senate.";
    expect(stanceOfPart(order, "Declare war on Carthage", null)).toBe("declare");
    expect(stanceOfPart(order, "Raise a levy of four legions", null)).toBe("propose");
    expect(stanceOfPart("War on Carthage.", "Make war on Carthage", "declare")).toBe("declare");
    expect(stanceOfPart("War on Carthage.", "Make war on Carthage", null)).toBeNull();
    // The words override the orchestrator, either way.
    expect(stanceOfPart("I propose war on Carthage.", "Make war on Carthage", "declare")).toBe("propose");
  });

  it("moves a proposal in the Senate: no war until it carries, and then none of a usurper's cost", () => {
    const world = opening();
    const war = WorldDeltaSchema.parse({ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "carthage", terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Carthage must answer." });
    const moved = applyDeltas(world, [war], as(CONSUL, world.elapsedStep, [war]));
    expect(atWar(moved.world.polityAgreements, "rome", "carthage")).toBe(false);
    expect(moved.rejected[0]!.reason).toMatch(/moved it in the chamber/);
    expect(moved.world.material.politicalProcedures.at(-1)).toMatchObject({ institutionId: "roman-senate", sponsorCharacterId: CONSUL });
    // The Senate carries it: the vote is the authority, and nothing is answered for.
    const carried = applyDeltas(moved.world, [war], { ...as(CONSUL, world.elapsedStep, [war]), sanctionedDeltas: new Set([war]) });
    expect(atWar(carried.world.polityAgreements, "rome", "carthage")).toBe(true);
    expect(usurpedLately(carried.world, CONSUL)).toBe(false);
    expect(carried.factProposals.map((fact) => fact.kind)).not.toContain("act_usurped");
  });

  it("is told by the player's own words in a burst: 'I declare war' is a war, 'I propose war' is a motion", async () => {
    const run = async (orderText: string, stance?: "propose" | "declare"): Promise<WorldState> => {
      const port: SimModelPort = { complete(operation) {
        if (operation === "simulate_cognition") return Promise.resolve('{"actors":[]}');
        return Promise.resolve(JSON.stringify({
          intent: { summary: "War on Carthage", domains: ["war"], parts: [{ said: "Make war on Carthage", acts: [0], ...(stance === undefined ? {} : { stance }) }] },
          narrativeSummary: "The war is spoken.", facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
          deltas: [{ op: "agreement_open", localId: "war", kind: "war", polityId: "rome", otherPolityId: "carthage", terms: "War.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Carthage must answer." }],
        }));
      } };
      const result = await runSimulationBurst({ world: opening(0), clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
        burstId: "stance", gameId: "stance", actorRef: { kind: "character", id: CONSUL }, actorPolityId: "rome", orderText, spanDays: 1, knownFacts: [], queue: [], port, narratorSeeds: [], budget: DEFAULT_BUDGET });
      return result.world;
    };
    const said = await run("I declare war on Carthage.");
    expect(atWar(said.polityAgreements, "rome", "carthage")).toBe(true);
    expect(usurpedLately(said, CONSUL)).toBe(true);
    const proposed = await run("I propose that Rome make war on Carthage.", "declare");
    expect(atWar(proposed.polityAgreements, "rome", "carthage")).toBe(false);
    expect(proposed.material.politicalProcedures.some((procedure) => procedure.institutionId === "roman-senate" && /war on Carthage/i.test(procedure.label))).toBe(true);
    // Words that say neither, and an orchestrator that reads them as a declaration: his reading stands.
    const reading = await run("War on Carthage.", "declare");
    expect(atWar(reading.polityAgreements, "rome", "carthage")).toBe(true);
    // And with no reading at all, an act of constitutional weight is moved, not done.
    const plain = await run("War on Carthage.");
    expect(atWar(plain.polityAgreements, "rome", "carthage")).toBe(false);
  }, 120_000);
});
