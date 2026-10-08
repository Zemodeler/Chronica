import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { auditMoney, unexplainedTotal } from "./money-audit";
import { FOLLOWS_PAID_PCT, changedCoin, followsHim } from "./defection-consequences";
import { hasDeserted } from "./defection";
import { keepTheBodies } from "./bodies";

/**
 * A man who went over left his contracts with the power he left running: its pay went on to a deserter, and a company he led stayed as the handing-over of his armies had
 * left it. Now every contract of the power he left is broken that day; a hired band he led follows him or falls back by rule (a band unpaid nearly always follows); the chest
 * it takes is changed from one coinage to the other at the money-changers' rate, and the cut leaves the books by the `abroad` door. A deserter who comes back is judged by the
 * power he left: the Hundred and Four try him for his life.
 */
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (actor: string, day = 0): ApplyContext => ({
  now: { day, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  ids: createIdFactory(`bargain-${actor}`), gameId: "game-bargain", playerCharacterId: actor,
});
const goOver = (world: WorldState, who: string, to: string, day = 0) => applyDeltas(world, [WorldDeltaSchema.parse({ op: "character_state_set", characterRef: who, polityId: to, reason: "He goes over." })], context(who, day));

/** Carthage hires a company of Gauls under a captain of its own, and funds its chest. */
function hired(world: WorldState, captainId: string, missed: number): WorldState {
  const deltas = [WorldDeltaSchema.parse({
    op: "service_contract_open", localId: "gauls", role: "mercenary", label: "A company of Gauls", employerAccountRef: "carthage-treasury", employeeRef: captainId,
    advance: 200, monthlyPay: 3_000, termDays: 365, duties: "Serve Carthage in Sicily.", company: { categoryId: "infantry", strength: 500 }, provinceId: null, reason: "Carthage wants men.",
  })];
  const made = applyDeltas(world, deltas, { ...context("hanno-carthage"), orderDeltas: new Set(deltas) });
  const contract = made.world.material.contracts.at(-1)!;
  const band = made.world.material.forces.find((force) => force.id === contract.forceId)!;
  return {
    ...made.world,
    material: {
      ...made.world.material,
      obligations: made.world.material.obligations.map((obligation) => (obligation.id === contract.obligationId ? { ...obligation, missedPeriods: missed } : obligation)),
      accounts: made.world.material.accounts.map((account) => (account.owner.kind === "force" && account.owner.id === band.id ? { ...account, balance: 10_000 } : account)),
    },
  };
}
const contractOf = (world: WorldState, captainId: string) => world.material.contracts.find((candidate) => candidate.employeeCharacterId === captainId && candidate.role === "mercenary")!;

describe("a defector leaves his bargains behind", () => {
  const base = opening();
  const captains = base.characters.filter((character) => character.polityId === "carthage" && character.alive && character.id !== "hanno-carthage").slice(0, 14);

  it("breaks his contract with the power he left, so that it pays a deserter nothing", () => {
    const captain = captains[0]!;
    const world = hired(base, captain.id, 0);
    const contract = contractOf(world, captain.id);
    const result = goOver(world, captain.id, "rome");
    expect(result.rejected).toEqual([]);
    expect(result.world.material.contracts.find((candidate) => candidate.id === contract.id)!.status).toBe("broken");
    expect(result.world.material.obligations.find((obligation) => obligation.id === contract.obligationId)!.active).toBe(false);
  });

  it("has his hired band follow him or fall back to the power that hired it, and the chest it takes is changed at the changers' rate", () => {
    const outcomes = captains.map((captain) => {
      const world = hired(base, captain.id, 0);
      const band = world.material.forces.find((force) => force.id === contractOf(world, captain.id).forceId)!;
      const result = goOver(world, captain.id, "rome");
      const after = result.world.material.forces.find((force) => force.id === band.id)!;
      expect(unexplainedTotal(auditMoney(world, result.world))).toBe(0);
      return { captain, band, after, result, world };
    });
    const followed = outcomes.filter((entry) => entry.after.polityId === "rome");
    const stayed = outcomes.filter((entry) => entry.after.polityId === "carthage");
    expect(followed.length + stayed.length).toBe(outcomes.length);
    expect(followed.length).toBeGreaterThan(0);
    expect(stayed.length).toBeGreaterThan(0);
    for (const entry of followed) {
      expect(entry.after).toMatchObject({ commanderCharacterId: entry.captain.id, controllerCharacterId: entry.captain.id, payObligationId: null });
      const chest = entry.result.world.material.accounts.find((account) => account.owner.kind === "force" && account.owner.id === entry.band.id)!.balance;
      expect(chest).toBe(10_000 - changedCoin(entry.world, "carthage", "rome", 10_000).cut);
      expect(entry.result.factProposals.some((fact) => /went over with .+ to .+: .+ contract is broken/.test(fact.summary))).toBe(true);
    }
    for (const entry of stayed) {
      expect(entry.after.commanderCharacterId).not.toBe(entry.captain.id);
      expect(entry.after.controllerCharacterId).not.toBe(entry.captain.id);
      expect(entry.result.factProposals.some((fact) => /would not follow .+ over to/.test(fact.summary))).toBe(true);
    }
  });

  it("follows him the oftener the longer it has gone unpaid", () => {
    const captain = captains[0]!;
    const paid = hired(base, captain.id, 0);
    const owed = hired(base, captain.id, 3);
    const band = (state: WorldState) => state.material.forces.find((force) => force.id === contractOf(state, captain.id).forceId)!;
    expect(followsHim(paid, band(paid), captain)).toBe(FOLLOWS_PAID_PCT);
    expect(followsHim(owed, band(owed), captain)).toBeGreaterThan(80);
  });

  it("changes coin for the silver in it, and the cut is the changers'", () => {
    const crossing = changedCoin(opening(), "carthage", "rome", 10_000);
    expect(crossing.received + crossing.cut).toBe(10_000);
    expect(crossing.cut).toBeGreaterThan(0);
    expect(changedCoin(opening(), "rome", "rome", 10_000)).toEqual({ received: 10_000, cut: 0 });
  });

  it("tries a deserter who comes home before the Hundred and Four, for his life", () => {
    const man = captains[1]!;
    const gone = goOver(base, man.id, "rome").world;
    expect(hasDeserted(gone, man, "carthage")).toBe(true);
    const back = goOver(gone, man.id, "carthage", 40);
    expect(back.rejected).toEqual([]);
    const him = back.world.characters.find((character) => character.id === man.id)!;
    expect(him.polityId).toBe("carthage");
    expect(him.disqualifyingStatuses).toEqual(expect.arrayContaining(["deserter", "captured"]));
    expect(him.disqualifyingStatuses).not.toContain("foreigner");
    const trial = back.world.material.politicalProcedures.find((procedure) => procedure.subjectId === man.id && procedure.type === "denunciation")!;
    expect(trial).toMatchObject({ institutionId: "carthaginian-hundred-and-four", sentence: "death" });
    expect(back.factProposals.some((fact) => /has come back to .+ the court has the case against him, for his life/.test(fact.summary))).toBe(true);
  });

  it("tries a deserter whom the Senate refused and sent back", () => {
    const general = base.material.forces.find((force) => force.polityId === "carthage" && force.personnel.some((row) => row.fit > 0))!.commanderCharacterId;
    const laid = goOver({ ...base, polityAgreements: base.polityAgreements.filter((agreement) => agreement.kind !== "war") }, general, "rome").world;
    const motion = laid.material.politicalProcedures.find((procedure) => procedure.subjectId === general && /received as a guest/.test(procedure.label))!;
    const refused = { ...laid, material: { ...laid.material, politicalProcedures: laid.material.politicalProcedures.map((procedure) => (procedure.id === motion.id ? { ...procedure, stage: "resolved" as const, outcome: "failed" as const, resolvedAtStep: 30 } : procedure)) } };
    const sat = keepTheBodies({ world: { ...refused, elapsedStep: 31 }, offices: definition.government.offices, successionRules: definition.government.successionRules, toDay: 31 });
    expect(sat.world.material.politicalProcedures.some((procedure) => procedure.subjectId === general && procedure.type === "denunciation" && procedure.sentence === "death")).toBe(true);
  });
});
