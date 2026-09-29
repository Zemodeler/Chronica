import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type BattleResult, type WorldState } from "@chronica/shared";
import { sentenceByOutcome, summonToJudgment } from "./trials";

const base = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

describe("a Carthaginian general who lost", () => {
  const world = base();
  const hanno = world.characters.find((character) => character.id === "hanno-carthage")!;
  const force = world.material.forces.find((candidate) => candidate.polityId === "carthage" && candidate.commanderCharacterId === hanno.id)
    ?? { ...world.material.forces[0]!, id: "hanno-army", polityId: "carthage", commanderCharacterId: hanno.id };
  const withForce: WorldState = world.material.forces.some((candidate) => candidate.id === force.id) ? world : { ...world, material: { ...world.material, forces: [...world.material.forces, force] } };
  const result = { battleId: "battle-himera", outcome: "defender_victory" } as unknown as BattleResult;

  it("is summoned before the Hundred and Four, and a routed army puts his life to the vote", () => {
    const routed: WorldState = { ...withForce, material: { ...withForce.material, forces: withForce.material.forces.filter((candidate) => candidate.id !== force.id) } };
    const summoned = summonToJudgment(routed, result, [force], "Himera");
    const trial = summoned.world.material.politicalProcedures.at(-1)!;
    expect(trial).toMatchObject({ type: "denunciation", institutionId: "carthaginian-hundred-and-four", subjectId: hanno.id, sentence: "death" });
    expect(summoned.facts[0]!.summary).toContain("The Hundred and Four");
    // Summoned once for one battle.
    expect(summonToJudgment(summoned.world, result, [force], "Himera").world.material.politicalProcedures.length).toBe(summoned.world.material.politicalProcedures.length);
  });

  it("is not summoned for a draw, nor by a power that does not judge its generals", () => {
    expect(summonToJudgment(withForce, { ...result, outcome: "inconclusive" }, [force], "Himera").facts).toEqual([]);
    expect(summonToJudgment({ ...withForce, departments: [] }, result, [force], "Himera").facts).toEqual([]);
  });

  it("pays back what he was found to have taken, and a fifth of what is left, when convicted", () => {
    const treasury = withForce.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === "carthage")!;
    const rich: WorldState = {
      ...withForce,
      material: { ...withForce.material, accounts: withForce.material.accounts.map((account) => (account.id === hanno.personalAccountId ? { ...account, balance: 1_000 } : account)) },
      diversions: [{ id: "d", byCharacterId: hanno.id, scope: { kind: "polity", id: "carthage" }, departmentId: "carthage-accounts", amount: 500, toAccountId: hanno.personalAccountId, firstAtStep: 0, lastAtStep: 0, foundAtStep: 5 }],
    };
    const before = treasury.balance;
    const convicted = sentenceByOutcome(rich, {
      id: "t", type: "denunciation", institutionId: "carthaginian-hundred-and-four", sponsorCharacterId: hanno.id, subjectKind: "character", subjectId: hanno.id,
      label: "The trial of Hanno", eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "resolved", resolutionMechanism: "vote", openedAtStep: 0,
      deadlineStep: 10, resolvedAtStep: 10, visibility: "public", voteRecordId: null, outcome: "passed", outcomeReason: "Guilty.", sourceEventIds: [], resultingEventIds: [], sentence: "fine",
    }, 10);
    const balance = (id: string) => convicted.material.accounts.find((account) => account.id === id)!.balance;
    expect(balance(hanno.personalAccountId)).toBe(400);
    expect(balance(treasury.id)).toBe(before + 600);
    expect(convicted.diversions).toEqual([]);
    expect(convicted.material.officeSeats.some((seat) => seat.holderCharacterId === hanno.id && seat.status === "held")).toBe(false);
  });
});
