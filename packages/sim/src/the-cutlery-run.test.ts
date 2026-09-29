import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { OrchestratorOutputSchema, ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runSimulationBurst, type BurstInput } from "./burst";
import { orchestrate } from "./orchestrate";
import { kindsIn, readLeniently } from "./bare-refs";
import { buildWorldSlice } from "./slice";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * What the first live run of a merchant's orders found, that no test had.
 *
 * Seven private orders -- a stall, a ship, a loan, a tutor, a vineyard -- and
 * three came back as nothing at all, because the model wrote its references as
 * bare ids and the whole answer was discarded; three more were headlined as
 * the merchant raising armies he had never asked for, because the world's own
 * business had been written into his order.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const SYRACUSE = "ita-72843720b81376294924159-sicily-southeast";
const MESSANA = "ita-72843720b81376294924159-sicily-northeast";
const LEPTINES = { kind: "character" as const, id: "leptines-syracuse" };
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

function scripted(orchestrator: readonly string[]): SimModelPort {
  const queue = [...orchestrator];
  return {
    complete(operation: SimOperation) {
      if (operation === "simulate_orchestrate" || operation === "repair_deltas") {
        const next = queue.shift();
        if (next !== undefined) return Promise.resolve(next);
      }
      if (operation === "simulate_cognition") return Promise.resolve(JSON.stringify({ actors: [] }));
      return Promise.reject(new Error(`nothing scripted for ${operation}`));
    },
  };
}
const answer = (fields: Record<string, unknown>) => JSON.stringify({
  intent: { summary: "Leptines fits out a ship for the oil trade.", domains: ["trade"] }, narrativeSummary: "He fits out a ship.",
  frictions: [], deltas: [], worldDeltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null,
  ...fields,
});

describe("a reference written as the bare id", () => {
  // Twenty facts, each naming its people as bare ids: past what salvage will
  // drop, so before this the whole answer went, and the order with it.
  const facts = Array.from({ length: 16 }, (_, index) => ({
    localId: `f${index}`, kind: "trade", summary: `Oil loaded, day ${index}.`,
    affectedRefs: ["leptines-syracuse", "syracuse", SYRACUSE], knownToRefs: ["leptines-syracuse"],
    visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 5,
  }));

  it("is put into shape from the world, and the answer is kept", async () => {
    const world = opening();
    const slice = buildWorldSlice({
      world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      actorRef: LEPTINES, actorPolityId: "syracuse", orderText: "I fit out a ship and trade olive oil to Messana.",
      facts: [], dueEvents: [], pendingEvents: [], narratorSeeds: [],
    });
    const result = await orchestrate(scripted([answer({ facts })]), slice, kindsIn(world));
    expect(result.parseFailure).toBeNull();
    expect(result.output.facts).toHaveLength(16);
    expect(result.output.facts[0]!.affectedRefs).toEqual([
      { kind: "character", id: "leptines-syracuse" }, { kind: "polity", id: "syracuse" }, { kind: "province", id: SYRACUSE },
    ]);
  });

  it("wraps a handle the same answer minted as what minted it", async () => {
    const world = opening();
    const slice = buildWorldSlice({
      world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare,
      actorRef: LEPTINES, actorPolityId: "syracuse", orderText: "I hire a captain.", facts: [], dueEvents: [], pendingEvents: [], narratorSeeds: [],
    });
    const hire = { op: "character_create", localId: "captain", name: "Dion the Captain", polityId: "syracuse", provinceId: SYRACUSE, age: 40, officeLabel: null, traits: [], generatedBecause: "Hired." };
    const fact = { ...facts[0]!, affectedRefs: ["local:captain"], knownToRefs: [] };
    const result = await orchestrate(scripted([answer({ deltas: [hire], facts: [fact] })]), slice, kindsIn(world));
    expect(result.output.facts[0]!.affectedRefs).toEqual([{ kind: "character", id: "local:captain" }]);
  });
});

describe("the world's business written into the order", () => {
  const burst = (port: SimModelPort): BurstInput => ({
    world: opening(), clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
    burstId: "cutlery", gameId: "game-1", actorRef: LEPTINES, actorPolityId: "syracuse", orderText: "I fit out a ship and trade olive oil to Messana.",
    knownFacts: [], queue: [], port, spanDays: 7, narratorSeeds: [],
  });
  // Exactly what the live run wrote into a merchant's order: a chieftain for
  // another people, and an army under him.
  const CHIEF = { op: "character_create", localId: "chief", name: "A Mamertine captain", polityId: "mamertines", provinceId: MESSANA, age: 40, officeLabel: null, traits: [], generatedBecause: "The Mamertines have nobody to lead them." };
  const HOST = { op: "force_create", localId: "host", name: "Mamertine levy", polityId: "mamertines", commanderCharacterRef: "local:chief", controllerCharacterRef: "local:chief", locationId: MESSANA, authorizedStrength: 800, payObligationRef: null, reason: "The Mamertines arm." };

  it("is carried out as the world's, not refused as the merchant raising an army", async () => {
    const result = await runSimulationBurst(burst(scripted([answer({ deltas: [CHIEF, HOST] })])));
    expect(result.audit.filter((entry) => entry.kind === "ignored")).toEqual([]);
    expect(result.audit.filter((entry) => entry.kind === "refiled").map((entry) => entry.op)).toEqual(["character_create", "force_create"]);
    expect(result.world.material.forces.some((force) => force.name === "Mamertine levy")).toBe(true);
    expect(result.newFacts.some((fact) => fact.kind === "order_ignored")).toBe(false);
  });

  it("stays his when he is in it: a foreign levy under his own command is his to answer for", async () => {
    const his = { ...HOST, commanderCharacterRef: "leptines-syracuse", controllerCharacterRef: "leptines-syracuse" };
    const result = await runSimulationBurst(burst(scripted([answer({ deltas: [his] })])));
    expect(result.audit.some((entry) => entry.kind === "refiled")).toBe(false);
  });
});

/** The second live run, after the first round of fixes: what was still in the way. */
describe("the second run", () => {
  const context = (extra: Partial<ApplyContext> = {}): ApplyContext => ({
    now: { day: 0, minute: 540 }, actorRef: LEPTINES, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory("second-run"), gameId: "game-1", ...extra,
  });
  const apply = (deltas: readonly unknown[], extra: Partial<ApplyContext> = {}, world: WorldState = opening()) =>
    applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), context(extra));

  it("reads a reference with its kind written in front of the id", () => {
    const result = apply([{ op: "character_intent_set", actorCharacterRef: "character:leptines-syracuse", actionType: "prepare", targetRefs: [], rationale: "He readies a cargo.", priority: 50, visibility: "private" }]);
    expect(result.rejected).toEqual([]);
  });

  it("takes the id out of a { kind, id } written where only the id was wanted", () => {
    const value = { ...(JSON.parse(answer({})) as Record<string, unknown>), deltas: [{ op: "character_intent_set", actorCharacterRef: { kind: "character", id: "leptines-syracuse" }, actionType: "prepare", targetRefs: [], rationale: "He readies a cargo.", priority: 50, visibility: "private" }] };
    const read = readLeniently(OrchestratorOutputSchema, value, kindsIn(opening()));
    expect(read.parsed.success).toBe(true);
  });

  it("salvages in rounds: a gathering with its only event dropped goes too, and the rest of the answer stays", () => {
    const gathering = { op: "social_events", events: [{ participantCharacterRefs: ["leptines-syracuse", "hieron-ii"], kind: "negotiation", visibility: "private", summary: "They talk terms." }] };
    const intent = { op: "character_intent_set", actorCharacterRef: "leptines-syracuse", actionType: "prepare", targetRefs: [], rationale: "He readies a cargo.", priority: 50, visibility: "private" };
    const read = readLeniently(OrchestratorOutputSchema, { ...JSON.parse(answer({})), deltas: [gathering, intent] }, kindsIn(opening()));
    expect(read.parsed.success).toBe(true);
    if (read.parsed.success) expect(read.parsed.data.deltas.map((delta) => delta.op)).toEqual(["character_intent_set"]);
  });

  it("makes the man he hires when the answer named him and never made him", () => {
    const result = apply([{
      op: "service_contract_open", localId: "vilicus", role: "retainer", label: "Vilicus of the vineyard", employerAccountRef: "leptines-purse",
      employeeRef: "local:lucius-vilicus", monthlyPay: 3, duties: "Runs the vineyard.", reason: "He hires a steward.",
    }]);
    expect(result.rejected).toEqual([]);
    expect(result.world.characters.some((character) => character.name === "Lucius Vilicus")).toBe(true);
  });

  it("does not let the world spend the player's purse, and does let his order", () => {
    const spectacle = { op: "money_transfer", fromAccountRef: "leptines-purse", toAccountRef: null, amount: 1_000, reason: "He paid for the games." };
    const world = opening();
    const byTheWorld = apply([spectacle], { actsForTheWorld: true, orderDeltas: new Set(), playerCharacterId: LEPTINES.id }, world);
    expect(byTheWorld.rejected).toHaveLength(1);
    expect(byTheWorld.world.material.accounts.find((account) => account.id === "leptines-purse")!.balance).toBe(1_400);
    const parsed = WorldDeltaSchema.parse(spectacle);
    const byHim = applyDeltas(world, [parsed], context({ actsForTheWorld: true, orderDeltas: new Set([parsed]), playerCharacterId: LEPTINES.id }));
    expect(byHim.rejected).toEqual([]);
  });
});
