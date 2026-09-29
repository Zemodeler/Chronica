import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { OrchestratorOutputSchema, ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { renderCharacterPortrait } from "./cognition";
import { createIdFactory, type SimModelPort } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * Blasio, consul of Rome, was written "severe fever" on the hundred and
 * seventh day and never recovered, because nothing could end a status the
 * world had written. Rome was at war with the Campanians of Rhegium all that
 * time, and no Roman army went near them.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const clock = definition.clock;
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context: ApplyContext = {
  now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gnaeus-cornelius" }, offices: definition.government.offices,
  warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory("bed"), gameId: "game-bed",
};
const tick = (world: WorldState, day: number) => runDeterministicTick({ world: { ...world, elapsedStep: day, instant: { ...world.instant, day } }, toDay: day, ids: createIdFactory(`bed-${day}`), warfare: definition.warfare });
const blasio = (world: WorldState) => world.characters.find((character) => character.id === "gnaeus-cornelius")!;

describe("an ailment written as a word", () => {
  it("passes in its time, and says so", () => {
    const ill = applyDeltas(opening(), [{ op: "character_state_set", characterRef: "gnaeus-cornelius", healthDeltaBps: -1_000, addStatuses: ["severe fever"], removeStatuses: [], heirRef: null, reason: "Fever." }], context).world;
    expect(blasio(ill).disqualifyingStatuses).toContain("severe fever");
    expect(blasio(tick(ill, 20).world).disqualifyingStatuses).toContain("severe fever");
    const later = tick(ill, 31);
    expect(blasio(later.world).disqualifyingStatuses).not.toContain("severe fever");
    expect(later.factProposals.some((fact) => fact.kind === "recovery" && /severe fever/.test(fact.summary))).toBe(true);
  });

  it("passes at once when it is older than the record of its time", () => {
    const world = opening();
    const legacy: WorldState = { ...world, characters: world.characters.map((character) => (character.id === "gnaeus-cornelius" ? { ...character, disqualifyingStatuses: ["severe fever"] } : character)) };
    expect(blasio(tick(legacy, 1).world).disqualifyingStatuses).toEqual([]);
  });

  it("leaves what the engine keeps alone", () => {
    const world = opening();
    const held: WorldState = { ...world, characters: world.characters.map((character) => (character.id === "gnaeus-cornelius" ? { ...character, disqualifyingStatuses: ["captured"] } : character)) };
    expect(blasio(tick(held, 1).world).disqualifyingStatuses).toEqual(["captured"]);
  });
});

describe("a war nobody is fighting", () => {
  it("is put to a magistrate of the power whose armies are nowhere near the enemy", () => {
    // Legio I in Sicily; the Campanians hold Rhegium; nobody Roman is near them.
    const world = opening();
    const away: WorldState = { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === "roman-field-army" ? { ...force, locationId: PUNIC_IDS.lilybaeum } : force)) } };
    const text = renderCharacterPortrait("gnaeus-cornelius", "Gnaeus Cornelius Blasio", away, clock);
    expect(text).toMatch(/No army of their power stands within reach of Campanian legion of Rhegium/);
    // Not to a senator, who raises no legions.
    expect(renderCharacterPortrait("manius-curius", "Manius Curius Dentatus", away, clock)).not.toMatch(/No army of their power/);
  });
});

describe("an order of several parts", () => {
  it("answers the part that came to nothing, even when the rest came to something", async () => {
    const answer = OrchestratorOutputSchema.parse({
      intent: {
        summary: "A letter to Syracuse, and the governorship of Sicily.",
        domains: ["diplomacy"],
        parts: [
          { said: "Send another ultimatum to Syracuse", factLocalIds: ["ultimatum"], whyNot: null },
          { said: "Take control of the conquered Sicilian lands under my governorship", factLocalIds: [], whyNot: null },
        ],
      },
      narrativeSummary: "The consul writes to Syracuse.",
      frictions: [], deltas: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
      facts: [{ localId: "ultimatum", kind: "diplomacy", summary: "Clepsina wrote to Hieron demanding he acknowledge Rome's claims.", affectedRefs: [{ kind: "polity", id: "rome" }], visibility: "public", discoveryState: "public", significance: 40 }],
    });
    const port: SimModelPort = {
      complete(operation) {
        if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify(answer));
        if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
        return Promise.resolve("{}");
      },
    };
    const result = await runSimulationBurst({
      world: opening(), clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "parts", gameId: "game-parts",
      actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: "Send another ultimatum to Syracuse. Take control of the conquered Sicilian lands under my governorship.",
      spanDays: 7, knownFacts: [], queue: [], port, narratorSeeds: [], budget: { ...DEFAULT_BUDGET, maxModelCalls: 2 },
    });
    const unanswered = result.newFacts.filter((fact) => fact.kind === "order_part_unanswered");
    expect(unanswered).toHaveLength(1);
    expect(unanswered[0]!.summary).toMatch(/governorship" Nothing came of it\./);
  });
});

describe("a fact that puts an army where it is not", () => {
  it("loses the place, and keeps the army", async () => {
    const answer = OrchestratorOutputSchema.parse({
      intent: { summary: "Nothing.", domains: [] },
      narrativeSummary: "The fleet is reviewed.",
      frictions: [], deltas: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
      facts: [{ localId: "review", kind: "fleet_review", summary: "The Carthaginian fleet was reviewed in Latium.", affectedRefs: [{ kind: "force", id: "carthaginian-fleet" }, { kind: "province", id: PUNIC_IDS.rome }], visibility: "public", discoveryState: "public", significance: 30 }],
    });
    const port: SimModelPort = { complete: (operation) => Promise.resolve(operation === "simulate_orchestrate" ? JSON.stringify(answer) : JSON.stringify({ actors: [] })) };
    const result = await runSimulationBurst({
      world: opening(), clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "places", gameId: "game-places",
      actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome",
      orderText: "Wait.", spanDays: 7, knownFacts: [], queue: [], port, narratorSeeds: [], budget: { ...DEFAULT_BUDGET, maxModelCalls: 2 },
    });
    const review = result.newFacts.find((fact) => fact.kind === "fleet_review")!;
    expect(review.affectedEntities.map((entity) => entity.id)).toEqual(["carthaginian-fleet"]);
  });
});
