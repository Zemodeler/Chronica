import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, resolveEligibility, type Character, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";

/**
 * A slave, a freedman, a Vestal.
 *
 * Nobody here had a legal standing or a sex, so a slave could spend his
 * master's money, a woman could be elected consul, and no Vestal could exist.
 * Now the law says what a person is, and three things hang on it: who may hold
 * an office, whose say a slave's purse and bargains answer to, and how a slave
 * becomes free.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const SYRUS = "syrus-slave";
const CURIUS = "manius-curius";

function world(): WorldState {
  const state = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  const curius = state.characters.find((character) => character.id === CURIUS)!;
  const syrus: Character = {
    ...curius, id: SYRUS, name: "Syrus", ageYearsAtStart: 30, prestigeBps: 500, personalAccountId: "syrus-purse",
    officesHeld: [], relations: [], ambitions: [], legalStatus: "enslaved", ownerCharacterId: CURIUS, peculium: false,
  };
  return {
    ...state,
    characters: [...state.characters, syrus],
    material: {
      ...state.material,
      accounts: [...state.material.accounts, { id: "syrus-purse", owner: { kind: "character", id: SYRUS }, currencyId: state.material.currency.id, balance: 40, status: "active", visibility: "private" }],
    },
  };
}

const as = (actor: string, written: readonly unknown[], state: WorldState = world()) => {
  const deltas = written.map((raw) => WorldDeltaSchema.parse(raw));
  const context: ApplyContext = {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: actor }, offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory(`status-${actor}`), gameId: "game-status", actsForTheWorld: true, orderDeltas: new Set(deltas),
  };
  return applyDeltas(state, deltas, context);
};
const person = (state: WorldState, id: string) => state.characters.find((character) => character.id === id)!;
const eligible = (state: WorldState, who: string, officeId: string) => {
  const office = offices.find((candidate) => candidate.id === officeId)!;
  return resolveEligibility({ ...state, elapsedStep: 0 }, who, office.eligibilityRequirementIds, office.id).eligible;
};
const pay = { op: "money_transfer", fromAccountRef: "syrus-purse", toAccountRef: "curius-purse", amount: 10, reason: "Syrus buys bread." };

describe("a slave's purse is his master's", () => {
  it("cannot be spent by the slave, unless his master lets him keep it", () => {
    const refused = as(SYRUS, [pay]);
    expect(refused.rejected[0]?.kind).toBe("ignored");
    expect(refused.rejected[0]?.reason).toMatch(/Manius Curius Dentatus's/);

    const allowed = as(CURIUS, [{ op: "legal_status_set", characterRef: SYRUS, status: "enslaved", peculium: true, reason: "He has earned a purse." }]);
    expect(allowed.rejected).toEqual([]);
    expect(allowed.breaches).toEqual([]);
    const spent = as(SYRUS, [pay], allowed.world);
    expect(spent.rejected).toEqual([]);
  });

  it("is hunted when he runs", () => {
    const fled = as(SYRUS, [{ op: "character_state_set", characterRef: SYRUS, moveToProvinceId: PUNIC_IDS.capua, reason: "He runs for Capua." }]);
    expect(fled.factProposals.find((fact) => fact.kind === "runaway")?.summary).toMatch(/run away from Manius Curius Dentatus/);
  });
});

describe("freedom", () => {
  it("is his master's alone to give, and leaves him a client of his patron", () => {
    const stranger = as("quintus-ogulnius", [{ op: "legal_status_set", characterRef: SYRUS, status: "freed", reason: "Ogulnius frees him." }]);
    expect(stranger.rejected).toHaveLength(1);

    const freed = as(CURIUS, [{ op: "legal_status_set", characterRef: SYRUS, status: "freed", reason: "Curius frees him in his will's spirit." }]);
    expect(freed.rejected).toEqual([]);
    expect(freed.breaches).toEqual([]);
    expect(person(freed.world, SYRUS).legalStatus).toBe("freed");
    expect(person(freed.world, SYRUS).ownerCharacterId).toBe(CURIUS);
    const gratitude = person(freed.world, SYRUS).relations.find((relation) => relation.subjectCharacterId === CURIUS);
    expect(gratitude?.causes.some((cause) => cause.label === "He gave me my freedom.")).toBe(true);
    // A freedman spends his own money now.
    expect(as(SYRUS, [pay], freed.world).rejected).toEqual([]);
    // But he was not born free, and the magistracies are for those who were.
    expect(eligible(freed.world, SYRUS, "roman-quaestor")).toBe(false);
  });

  it("is taken only from a man already in somebody's hands", () => {
    const atLarge = as(CURIUS, [{ op: "legal_status_set", characterRef: "decius-vibellius", status: "enslaved", reason: "Curius claims him." }]);
    expect(atLarge.rejected[0]?.reason).toMatch(/at large/);

    const state = world();
    const captive = { ...state, characters: state.characters.map((character) => (character.id === "decius-vibellius" ? { ...character, disqualifyingStatuses: ["captured"] } : character)) };
    const sold = as(CURIUS, [{ op: "legal_status_set", characterRef: "decius-vibellius", status: "enslaved", reason: "Taken at Rhegium and sold." }], captive);
    expect(sold.rejected).toEqual([]);
    expect(person(sold.world, "decius-vibellius").legalStatus).toBe("enslaved");
    expect(person(sold.world, "decius-vibellius").ownerCharacterId).toBe(CURIUS);
  });
});

describe("who may hold what", () => {
  it("keeps the magistracies for free men, and the hearth of Vesta for women", () => {
    const state = world();
    const claudia = { ...state, characters: state.characters.map((character) => (character.id === "quintus-ogulnius" ? { ...character, gender: "female" as const } : character)) };
    expect(eligible(state, "quintus-ogulnius", "roman-quaestor")).toBe(true);
    expect(eligible(claudia, "quintus-ogulnius", "roman-quaestor")).toBe(false);
    expect(eligible(claudia, "quintus-ogulnius", "roman-vestal")).toBe(true);
    expect(eligible(state, SYRUS, "roman-senator")).toBe(false);
  });

  it("lets the world make a Vestal, and a slave belonging to whoever made him", () => {
    const made = as(CURIUS, [
      { op: "character_create", localId: "vestal", name: "Tuccia", polityId: "rome", provinceId: PUNIC_IDS.rome, age: 12, officeLabel: null, traits: [], gender: "female", generatedBecause: "A girl taken for Vesta." },
      { op: "character_create", localId: "steward", name: "Eros", polityId: "rome", provinceId: PUNIC_IDS.rome, age: 40, officeLabel: null, traits: [], legalStatus: "enslaved", generatedBecause: "The steward of the Sabine farm." },
    ]);
    expect(made.rejected).toEqual([]);
    const tuccia = made.world.characters.find((character) => character.name === "Tuccia")!;
    const eros = made.world.characters.find((character) => character.name === "Eros")!;
    expect(tuccia.gender).toBe("female");
    expect(eros.legalStatus).toBe("enslaved");
    expect(eros.ownerCharacterId).toBe(CURIUS);
  });
});
