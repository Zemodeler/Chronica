import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { runDeterministicTick } from "./tick";

/**
 * "Start a church." "Build an academy."
 *
 * Before this, both were carried out and neither did anything. A church was an
 * arrangement -- a record whose effects the model was asked to remember to
 * apply every month, which it could not -- and faith was a field on characters
 * that nothing read. An academy was a project whose finished building was
 * "other", with no effect of any kind; the code that would have made it train
 * people had no callers. A fortress built in play defended nobody.
 *
 * Now a made thing says what it goes on doing, in words, and the engine does
 * it every month for as long as somebody pays for its keep.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = "punic-italy-latium";

const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const context = (actor = "gaius-genucius"): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: actor },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("made"),
  gameId: "game-made",
  actsForTheWorld: true,
});

function order(written: readonly unknown[], state: WorldState = world()) {
  const result = applyDeltas(state, written.map((raw) => WorldDeltaSchema.parse(raw)), context());
  expect(result.rejected).toEqual([]);
  return result.world;
}

/** Days pass, a tick at a time, as a burst walks the world forward. */
function after(state: WorldState, days: number): { world: WorldState; facts: string[] } {
  let current = state;
  const facts: string[] = [];
  for (let day = 10; day <= days; day += 10) {
    const ticked = runDeterministicTick({ world: { ...current, elapsedStep: day, instant: { day, minute: 540 } }, toDay: day, ids: createIdFactory(`tick-${day}`), warfare: definition.warfare });
    current = ticked.world;
    facts.push(...ticked.factProposals.map((fact) => fact.summary));
  }
  expect(WorldStateSchema.safeParse(current).success).toBe(true);
  return { world: current, facts };
}

const material = (state: WorldState, provinceId: string) => state.material.provinceMaterial.find((row) => row.provinceId === provinceId)!;
const balance = (state: WorldState, accountId: string) => state.material.accounts.find((account) => account.id === accountId)!.balance;

describe("start a church", () => {
  const church = [
    {
      op: "character_create", localId: "prophet", name: "Tiberius the Seer", polityId: "rome", provinceId: LATIUM, age: 40,
      officeLabel: null, traits: [], faith: "The Unconquered Sun", generatedBecause: "Somebody has to preach it.",
    },
    {
      op: "generic_entity_create", localId: "church", kind: "church", label: "The Temple of the Unconquered Sun",
      ownerRef: { kind: "polity", id: "rome" }, provinceId: LATIUM,
      effects: [
        { quantity: "conversion", band: "great", faith: "The Unconquered Sun" },
        { quantity: "stability", band: "slight" },
      ],
      upkeep: { fromAccountRef: "rome-treasury", band: "slight" },
      reason: "A church is founded in Rome.",
    },
  ];

  it("founds the faith by naming it, and its prophet believes it", () => {
    const made = order(church);
    const faith = made.faiths.find((candidate) => candidate.name === "The Unconquered Sun")!;
    expect(faith).toBeDefined();
    expect(made.characters.find((character) => character.name === "Tiberius the Seer")!.faithId).toBe(faith.id);
  });

  it("wins converts every month, costs the treasury its keep, and says when the city turns", () => {
    const made = order(church);
    const { world: later, facts } = after(made, 330);
    const faith = later.faiths.find((candidate) => candidate.name === "The Unconquered Sun")!;
    const share = later.faithAdherence.find((row) => row.provinceId === LATIUM && row.faithId === faith.id)!.shareBps;
    expect(share).toBeGreaterThanOrEqual(5_000);
    expect(facts.some((summary) => summary.includes("now follow The Unconquered Sun"))).toBe(true);
    expect(later.material.transactions.some((transaction) => transaction.kind === "upkeep" && transaction.sourceAccountId === "rome-treasury")).toBe(true);
  });

  it("stops when nobody pays for it, and the record says so", () => {
    const made = order(church);
    const broke: WorldState = {
      ...made,
      // Empty, and nothing coming in: Rome's revenue alone now covers a
      // church's keep, so an empty chest is not the same as a broke one.
      material: {
        ...made.material,
        accounts: made.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance: 0 } : account)),
        incomeSources: made.material.incomeSources.map((source) => (source.beneficiaryAccountId === "rome-treasury" ? { ...source, active: false } : source)),
      },
    };
    const { world: later, facts } = after(broke, 90);
    expect(facts.some((summary) => summary.includes("fell into disuse"))).toBe(true);
    const faith = later.faiths.find((candidate) => candidate.name === "The Unconquered Sun")!;
    expect(later.faithAdherence.some((row) => row.faithId === faith.id)).toBe(false);
  });
});

describe("build an academy", () => {
  it("finishes as an academy, and the people raised there are better for it", () => {
    const made = order([{
      op: "project_create", localId: "academy", kind: "construction", label: "The Academy of Latium",
      sponsorRef: { kind: "polity", id: "rome" }, fundingAccountRef: "rome-treasury",
      milestones: [{ label: "Built", dueInDays: 20, costAmount: 50 }],
      completionOutcome: { kind: "structure", label: "The Academy of Latium", provinceId: LATIUM, polityId: "rome", structureKind: "academy_building" },
      reason: "Rome will train its officers.",
    }]);
    const { world: built } = after(made, 30);
    const academy = built.structures.find((structure) => structure.name === "The Academy of Latium")!;
    expect(academy.kind).toBe("academy_building");

    const raise = (state: WorldState) => order([{
      op: "character_create", localId: "cadet", name: "Lucius", polityId: "rome", provinceId: LATIUM, age: 20, officeLabel: null, traits: [], generatedBecause: "A young officer.",
    }], state).characters.find((character) => character.name === "Lucius")!.skills.martial;
    expect(raise(built)).toBeGreaterThan(raise(made));
  });

  it("builds a fortress that defends, which no building from a project ever did", () => {
    const made = order([{
      op: "project_create", localId: "fort", kind: "construction", label: "The Fort on the Tiber",
      sponsorRef: { kind: "polity", id: "rome" }, fundingAccountRef: "rome-treasury",
      milestones: [{ label: "Built", dueInDays: 20, costAmount: 50 }],
      completionOutcome: { kind: "structure", label: "The Fort on the Tiber", provinceId: LATIUM, polityId: "rome", amount: 500, structureKind: "fortress" },
      reason: "A fort on the river.",
    }]);
    const fort = after(made, 30).world.structures.find((structure) => structure.name === "The Fort on the Tiber")!;
    expect(fort.defensiveEffectsBps).toBeGreaterThan(0);
  });
});

describe("anything else anybody makes", () => {
  it("pays its owner, scaled to what the province can yield", () => {
    const made = order([{
      op: "generic_entity_create", localId: "market", kind: "market", label: "The Forum Boarium",
      ownerRef: { kind: "polity", id: "rome" }, provinceId: LATIUM,
      effects: [{ quantity: "income", band: "marked" }], reason: "A cattle market.",
    }]);
    // Founding it costs a venture's months of what it clears, so it is measured
    // by what it adds each month rather than by the balance a season later.
    const gained = (state: WorldState) => balance(after(state, 120).world, "rome-treasury") - balance(after(state, 30).world, "rome-treasury");
    expect(gained(made)).toBeGreaterThan(gained(order([])));
    expect(balance(made, "rome-treasury")).toBeLessThan(balance(world(), "rome-treasury"));
  });

  it("makes a harsh law felt across the whole realm, and the province settles lower", () => {
    const made = order([{
      op: "generic_entity_create", localId: "law", kind: "law", label: "The Law of the Levy",
      ownerRef: { kind: "polity", id: "rome" },
      effects: [{ quantity: "stability", direction: "lower", band: "great", scope: "realm" }], reason: "Every man serves.",
    }]);
    expect(material(after(made, 120).world, LATIUM).stabilityBps).toBeLessThan(material(after(order([]), 120).world, LATIUM).stabilityBps);
  });
});
