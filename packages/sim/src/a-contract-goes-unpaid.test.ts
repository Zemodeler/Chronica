import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, taxBurdens, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * A man hired.
 *
 * The captain and his company, the physician, the envoy, the tax farmer: none
 * of them could exist, because nothing said who paid whom for what, or what
 * the work let the man do. A contract says it. The engine pays it every month,
 * and ends it the first month it cannot.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const as = (actor: string, written: readonly unknown[], state: WorldState = world()) => {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(`hire-${actor}`), gameId: "game-hire", actsForTheWorld: true, orderDeltas: new Set(deltas),
  };
  return applyDeltas(state, deltas, context);
};
const tickTo = (state: WorldState, day: number) =>
  runDeterministicTick({ world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`hire-tick-${day}`), warfare: definition.warfare });
const balance = (state: WorldState, id: string) => state.material.accounts.find((account) => account.id === id)!.balance;
const person = (state: WorldState, id: string) => state.characters.find((character) => character.id === id)!;

describe("a man hired, and paid", () => {
  it("pays the advance now and the wage every month, and lapses when the purse runs dry", () => {
    const before = balance(world(), "curius-purse");
    const hired = as("manius-curius", [{
      op: "service_contract_open", localId: "doctor", role: "physician", label: "Physician to the house of Curius",
      employerAccountRef: "curius-purse", employeeRef: "quintus-ogulnius", advance: 20, monthlyPay: 5_000, duties: "Keep the old man alive.", reason: "His health is failing.",
    }]);
    expect(hired.rejected).toEqual([]);
    expect(hired.breaches).toEqual([]);
    expect(balance(hired.world, "curius-purse")).toBe(before - 20);
    const contract = hired.world.material.contracts[0]!;
    expect(contract.status).toBe("active");

    // A wage no purse and no farm of his can find: the next month is missed, and the contract is over.
    const broke = { ...hired.world, material: { ...hired.world.material, accounts: hired.world.material.accounts.map((account) => (account.id === "curius-purse" ? { ...account, balance: 0 } : account)) } };
    const month = tickTo(tickTo(broke, 30).world, 40);
    const lapsed = month.world.material.contracts.find((candidate) => candidate.id === contract.id)!;
    expect(lapsed.status).toBe("lapsed");
    expect(month.world.material.obligations.find((obligation) => obligation.id === contract.obligationId)?.active).toBe(false);
  });

  it("cannot be paid for out of a treasury the man hiring does not hold", () => {
    const refused = as("manius-curius", [{
      op: "service_contract_open", localId: "doctor", role: "physician", label: "A physician at public expense",
      employerAccountRef: "rome-treasury", employeeRef: "quintus-ogulnius", monthlyPay: 10, duties: "Physic.", reason: "Curius would rather Rome paid.",
    }]);
    expect(refused.rejected[0]?.kind).toBe("ignored");
  });
});

describe("what the work needs", () => {
  it("puts a hired company under whoever hired it, and gives it back when the captain walks out", () => {
    const company = world().material.forces.find((force) => force.commanderCharacterId === "decius-vibellius")!;
    const hired = as("gaius-genucius", [{
      op: "service_contract_open", localId: "campanians", role: "mercenary", label: "The Campanians in Roman pay",
      employerAccountRef: "rome-treasury", employeeRef: "decius-vibellius", monthlyPay: 50, termDays: 365, duties: "Fight for Rome in Sicily.",
      forceRef: company.id, reason: "Rome needs men across the strait.",
    }]);
    expect(hired.rejected).toEqual([]);
    const theirs = hired.world.material.forces.find((force) => force.id === company.id)!;
    expect(theirs.controllerCharacterId).toBe("gaius-genucius");
    expect(theirs.polityId).toBe("rome");

    const contractId = hired.world.material.contracts[0]!.id;
    const walked = as("decius-vibellius", [{ op: "service_contract_close", contractRef: contractId, reason: "Carthage pays better." }], hired.world);
    expect(walked.rejected).toEqual([]);
    expect(walked.breaches).toEqual([]);
    expect(walked.world.material.contracts[0]!.status).toBe("broken");
    const back = walked.world.material.forces.find((force) => force.id === company.id)!;
    expect(back.polityId).toBe(company.polityId);
    expect(back.controllerCharacterId).toBe(company.controllerCharacterId);
    expect(person(walked.world, "decius-vibellius").prestigeBps).toBe(person(world(), "decius-vibellius").prestigeBps - 300);
  });

  it("lets an envoy speak for the power that sent him, for as long as he is paid to", () => {
    const hired = as("gaius-genucius", [{
      op: "service_contract_open", localId: "envoy", role: "envoy", label: "Envoy to Syracuse", employerAccountRef: "rome-treasury",
      employeeRef: "manius-curius", advance: 30, termDays: 90, duties: "Treat with Hieron.", counterpartPolityId: "syracuse", reason: "Rome sends its most respected man.",
    }]);
    expect(hired.rejected).toEqual([]);
    const grant = hired.world.authorityGrants.find((candidate) => candidate.sourceRef === hired.world.material.contracts[0]!.id)!;
    expect(grant.powers).toEqual(["negotiate"]);
    const over = tickTo(hired.world, 90).world;
    expect(over.material.contracts[0]!.status).toBe("ended");
    expect(over.authorityGrants.find((candidate) => candidate.id === grant.id)?.revokedAtStep).not.toBeNull();
  });

  it("lets a province's tax to a farmer, who pays for it and whose take the province feels", () => {
    const before = balance(world(), "rome-treasury");
    const burdenBefore = taxBurdens(world()).get("rome")!.asked;
    const farmed = as("gaius-genucius", [{
      op: "service_contract_open", localId: "farm", role: "tax_farmer", label: "The tax farm of Campania", employerAccountRef: "rome-treasury",
      employeeRef: "quintus-ogulnius", advance: 100, monthlyPay: 5, termDays: 1_826, duties: "Collect the tithe of Campania.",
      provinceId: "punic-italy-campanian-plain", reason: "The treasury would rather have the money now.",
    }]);
    expect(farmed.rejected).toEqual([]);
    expect(balance(farmed.world, "rome-treasury")).toBe(before + 100);
    const take = farmed.world.material.incomeSources.find((source) => source.id === farmed.world.material.contracts[0]!.incomeSourceId)!;
    expect(take.beneficiaryAccountId).toBe(person(world(), "quintus-ogulnius").personalAccountId);
    expect(take.amount).toBeGreaterThan(0);
    // Counted against what Rome's land can bear, like Rome's own tax.
    expect(taxBurdens(farmed.world).get("rome")!.asked).toBeGreaterThan(burdenBefore);
  });
});

describe("healing", () => {
  it("is rest and little more, unless a physician treats the man -- and then the engine says how it went", () => {
    const state = world();
    const sick = { ...state, characters: state.characters.map((character) => (character.id === "manius-curius" ? { ...character, healthBps: 3_000 } : character)) };
    const rested = as("manius-curius", [{ op: "character_state_set", characterRef: "manius-curius", healthDeltaBps: 6_000, reason: "He is well again." }], sick);
    expect(person(rested.world, "manius-curius").healthBps).toBe(3_500);

    const treated = as("manius-curius", [{ op: "character_state_set", characterRef: "manius-curius", healthDeltaBps: 6_000, physicianRef: "quintus-ogulnius", reason: "Ogulnius sees to him." }], sick);
    const health = person(treated.world, "manius-curius").healthBps;
    const learning = person(state, "quintus-ogulnius").skills.learning;
    // Mended by what his learning allows, or not at all: never by the number written.
    expect([3_000, 3_000 + 1_500 + learning * 30]).toContain(health);
    expect(treated.factProposals.find((fact) => fact.kind === "treatment")).toBeDefined();
  });
});

describe("a man hired to serve an army", () => {
  it("serves the hirer's own army instead of being read as hiring it out", () => {
    // Clepsina hired a grain contractor to feed Legio I before Messana, and was
    // told "Legio I is not Nicias's to hire out".
    const army = world().material.forces.find((force) => force.id === "roman-field-army")!;
    const hired = as(army.controllerCharacterId, [{
      op: "service_contract_open", localId: "supply", role: "retainer", label: "Provisions and transport for the legion",
      employerAccountRef: "rome-treasury", employeeRef: "quintus-ogulnius", advance: 20, forceRef: "roman-field-army",
      duties: "Buy and deliver food and transport to the siege lines.", reason: "Feed the army.",
    }]);
    expect(hired.rejected).toEqual([]);
    const after = hired.world.material.forces.find((force) => force.id === "roman-field-army")!;
    expect(after.controllerCharacterId).toBe(army.controllerCharacterId);
    expect(after.polityId).toBe(army.polityId);
    expect(hired.world.material.contracts[0]!.forceId).toBeNull();
    expect(hired.factProposals.find((fact) => fact.kind === "contract_opened")?.summary).toMatch(/in the service of/);
  });

  it("still will not hire out a company from a man who does not lead it", () => {
    const refused = as("gaius-genucius", [{
      op: "service_contract_open", localId: "band", role: "mercenary", label: "The Campanians, hired",
      employerAccountRef: "rome-treasury", employeeRef: "quintus-ogulnius", forceRef: "campanian-legion",
      duties: "Fight for Rome.", reason: "Buy the garrison.",
    }]);
    expect(refused.rejected[0]?.reason).toMatch(/not .* to hire out/);
  });
});
