import { describe, expect, it } from "vitest";
import { firstPunicWarScenario, FIRST_PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type Office, type ScenarioClock, type WorldState } from "@chronica/shared";
import { runSimulationBurst, type BurstInput } from "./burst";
import { repairDeltas } from "./repair-deltas";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * The second attempt at a change the engine refused over how it was written.
 *
 * Before this, a delta that parsed and then failed on contact with the world
 * was dropped where it stood and the model was never told: a player's order
 * came back half-done, with no second try and nothing to stop the same
 * misunderstanding arriving again on the next order.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const offices: readonly Office[] = definition.government.offices;
const clock: ScenarioClock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

function recordingPort(script: Partial<Record<SimOperation, string[]>>) {
  const remaining: Partial<Record<SimOperation, string[]>> = structuredClone(script);
  const seen: { operation: SimOperation; system: string; message: string }[] = [];
  const port: SimModelPort = {
    complete(operation, system, message) {
      seen.push({ operation, system, message });
      const next = remaining[operation]?.shift();
      if (next === undefined) return Promise.reject(new Error(`no further "${operation}" response`));
      return Promise.resolve(next);
    },
  };
  return { port, seen };
}

/** A rename naming an army that does not exist, beside one that does. */
const A_GOOD_ORDER_AND_A_BAD_ONE = JSON.stringify({
  intent: { summary: "Reorganise the army.", domains: ["military"] },
  narrativeSummary: "The consul numbers his legions.",
  frictions: [],
  deltas: [
    { op: "force_modify", forceRef: "legio-i", moraleBpsDelta: 100, reason: "The men are addressed." },
    { op: "force_modify", forceRef: "the-second-legion", name: "Legio II", reason: "The second legion is numbered." },
  ],
  facts: [],
  schedule: [],
  outcome: "continue",
});

const THE_CORRECTION = JSON.stringify({
  deltas: [{ op: "force_modify", forceRef: "legio-i", name: "Legio II", reason: "The legion is numbered." }],
});

const NOTHING_HAPPENS = JSON.stringify({ actors: [] });

function input(port: SimModelPort, overrides: Partial<BurstInput> = {}): BurstInput {
  return {
    world: world(), clock, offices, warfare: definition.warfare,
    burstId: "b1", gameId: "game-1",
    actorRef: { kind: "character", id: "marcus-atilius" }, actorPolityId: "rome",
    orderText: "Number the legions.", knownFacts: [], queue: [], port,
    ...overrides,
  };
}

describe("a refused change gets one corrected attempt", () => {
  it("carries the refusal back and applies what comes of it", async () => {
    const { port, seen } = recordingPort({
      simulate_orchestrate: [A_GOOD_ORDER_AND_A_BAD_ONE], repair_deltas: [THE_CORRECTION],
      simulate_cognition: [NOTHING_HAPPENS],
    });
    const result = await runSimulationBurst(input(port));

    // The repair was asked for, and it was shown the exact complaint rather
    // than being told only that something went wrong.
    const repair = seen.find((call) => call.system.startsWith("You are correcting changes"));
    expect(repair).toBeDefined();
    expect(repair!.message).toContain("the-second-legion");
    expect(repair!.message).toContain("REFUSED");

    // And the corrected change took effect.
    expect(result.world.material.forces.find((force) => force.id === "legio-i")!.name).toBe("Legio II");
  });

  it("leaves the change that was right alone", async () => {
    const before = world();
    const { port } = recordingPort({
      simulate_orchestrate: [A_GOOD_ORDER_AND_A_BAD_ONE], repair_deltas: [THE_CORRECTION],
      simulate_cognition: [NOTHING_HAPPENS],
    });
    const result = await runSimulationBurst(input(port));

    const morale = result.world.material.forces.find((force) => force.id === "legio-i")!.moraleBps;
    expect(morale).toBe(before.material.forces.find((force) => force.id === "legio-i")!.moraleBps + 100);
  });

  it("does not ask when nothing was refused over how it was written", async () => {
    const clean = JSON.stringify({
      intent: { summary: "Address the men.", domains: ["military"] },
      narrativeSummary: "The consul addresses his legion.",
      frictions: [], facts: [], schedule: [], outcome: "continue",
      deltas: [{ op: "force_modify", forceRef: "legio-i", moraleBpsDelta: 100, reason: "A speech." }],
    });
    const { port, seen } = recordingPort({ simulate_orchestrate: [clean], simulate_cognition: [NOTHING_HAPPENS] });
    await runSimulationBurst(input(port));

    expect(seen.some((call) => call.system.startsWith("You are correcting changes"))).toBe(false);
  });

  it("survives a repair that comes back unusable", async () => {
    const { port } = recordingPort({
      simulate_orchestrate: [A_GOOD_ORDER_AND_A_BAD_ONE], repair_deltas: ["not json at all"],
      simulate_cognition: [NOTHING_HAPPENS],
    });
    const result = await runSimulationBurst(input(port));

    // The good change still stands; the bad one is simply still refused.
    expect(result.world.material.forces.find((force) => force.id === "legio-i")!.name).toBe("Legio I");
    expect(result.world.material.forces.some((force) => force.id === "the-second-legion")).toBe(false);
  });
});

describe("what is worth a second attempt", () => {
  const rejection = (kind: "world" | "reference") => ({
    delta: { op: "force_modify" as const, forceRef: "legio-i", moraleBpsDelta: 1, reason: "x" },
    reason: kind === "world" ? "The treasury is short." : "No force \"x\" exists.",
    kind,
  });

  it("never argues with the world", async () => {
    let called = false;
    const port: SimModelPort = { complete() { called = true; return Promise.resolve("{}"); } };
    // A "world" rejection is the world saying no. Asking the model to try
    // again is asking it to argue with the rules, and costs a call to do it.
    const result = await repairDeltas({ port, worldText: "", rejected: [rejection("world")] });

    expect(called).toBe(false);
    expect(result.calls).toBe(0);
    expect(result.deltas).toEqual([]);
  });

  it("spends exactly one call on the writing", async () => {
    let calls = 0;
    const port: SimModelPort = {
      complete() {
        calls += 1;
        return Promise.resolve(JSON.stringify({ deltas: [] }));
      },
    };
    const result = await repairDeltas({ port, worldText: "", rejected: [rejection("reference"), rejection("reference")] });

    expect(calls).toBe(1);
    expect(result.calls).toBe(1);
  });

  it("gives up rather than making the player wait twice for nothing", async () => {
    const port: SimModelPort = { complete() { return Promise.reject(new Error("terminated: timeout")); } };
    const result = await repairDeltas({ port, worldText: "", rejected: [rejection("reference")] });

    expect(result.deltas).toEqual([]);
    expect(result.failure).toContain("in time");
  });
});

describe("a refused id that was cut short", () => {
  it("is shown what it could have meant, so the correction can choose", async () => {
    // From a live run: the model copied the first half of a province's id, and
    // the start it copied fits two provinces -- so the engine rightly would not
    // guess, and the same half-id came back in the correction because nothing
    // said what else to write.
    const { punicWarsScenario } = await import("@chronica/db");
    const stem = "cut-short-province";
    const cloned = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
    const [carni, taurisci] = [cloned.map.provinces[0]!, cloned.map.provinces[1]!];
    const punic = { ...cloned, map: { ...cloned.map, provinces: cloned.map.provinces.map((province) => (
      province === carni ? { ...province, id: `${stem}b1` } : province === taurisci ? { ...province, id: `${stem}b2` } : province)) } };
    const { port, seen } = recordingPort({ repair_deltas: [JSON.stringify({ deltas: [] })] });
    await repairDeltas({
      port,
      worldText: "",
      world: punic,
      rejected: [{
        delta: { op: "province_material_shift", provinceId: stem, stabilityBpsDelta: -100, reason: "Unrest." },
        reason: `No province "${stem}" exists to be changed.`,
        kind: "reference",
      }],
    });
    expect(seen[0]!.message).toContain(`${stem}b1 (${carni.name})`);
    expect(seen[0]!.message).toContain(`${stem}b2 (${taurisci.name})`);
  });
});

describe("a correction written as a patch", () => {
  it("is laid over the change it corrects instead of refused for everything it left out", async () => {
    // From a live run: asked to write a refused creation again, the model wrote
    // only the field it fixed, and the repair was refused for every field it
    // had never meant to change.
    const { port } = recordingPort({ repair_deltas: [JSON.stringify({ deltas: [{ op: "character_create", localId: "herald", provinceId: FIRST_PUNIC_IDS.rome }] })] });
    const original = {
      op: "character_create" as const, localId: "herald", name: "Cingetorix", polityId: "rome", provinceId: "nowhere-at-all", age: 40,
      officeLabel: null, officeAuthorises: [], traits: [], standing: null, wealth: 0, generatedBecause: "A herald.",
    };
    const repaired = await repairDeltas({ port, worldText: "", rejected: [{ delta: original, reason: 'No province "nowhere-at-all".', kind: "reference" }] });
    expect(repaired.failure).toBeNull();
    expect(repaired.deltas).toEqual([expect.objectContaining({ name: "Cingetorix", provinceId: FIRST_PUNIC_IDS.rome, age: 40 })]);
  });

  it("keeps the good corrections when one of them is bad", async () => {
    const { port } = recordingPort({ repair_deltas: [JSON.stringify({ deltas: [
      { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 10, reason: "Good." },
      { op: "not_a_thing_at_all" },
    ] })] });
    const repaired = await repairDeltas({ port, worldText: "", rejected: [
      { delta: { op: "money_transfer", fromAccountRef: "nobody", toAccountRef: null, amount: 10, reason: "x" }, reason: "No account.", kind: "reference" },
    ] });
    expect(repaired.deltas).toHaveLength(1);
    expect(repaired.failure).toBeNull();
  });
});
