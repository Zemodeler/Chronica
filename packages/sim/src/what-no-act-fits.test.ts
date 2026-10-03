import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, VENTURE_PRICE_MONTHS, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { runSimulationBurst, type BurstInput } from "./burst";
import { createIdFactory, type SimModelPort, type SimOperation } from "./ports";
import { arrangementNetIncome } from "./standing-effects";

/**
 * "I make a business deal and start selling cutlery in the streets of Rome."
 *
 * Three ways an order like that used to come to nothing, and what it comes to
 * now. An arrangement -- the catch-all for anything no other act fits -- could
 * pay its owner a share of the province every month and cost nothing, so it
 * now has a venture's price. An act the engine could not read, even after the
 * repair, was dropped; now it is kept as an arrangement. And an order answered
 * only in words left nothing behind for the next one to find; now it leaves
 * what the player is doing.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const SYRACUSE = PUNIC_IDS.syracuse;
const LEPTINES = { kind: "character" as const, id: "leptines-syracuse" };
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const as = (): ApplyContext => ({
  now: { day: 0, minute: 540 }, actorRef: LEPTINES, offices: definition.government.offices, warfare: definition.warfare,
  terrains: definition.map.terrains, ids: createIdFactory("no-act-fits"), gameId: "game-1",
});
const balance = (world: WorldState, accountId: string) => world.material.accounts.find((account) => account.id === accountId)!.balance;
const STALL_EFFECTS = [{ quantity: "income" as const, direction: "raise" as const, band: "slight" as const, scope: "here" as const }];
const stall = (extra: Record<string, unknown> = {}) => WorldDeltaSchema.parse({
  op: "generic_entity_create", localId: "stall", kind: "stall", label: "A cutler's stall", ownerRef: LEPTINES,
  provinceId: SYRACUSE, effects: STALL_EFFECTS, reason: "He sells knives in the market.", ...extra,
});

describe("an arrangement that pays has a price", () => {
  it("costs a venture's months of what it clears, and is kept from his own purse", () => {
    const world = opening();
    const clears = arrangementNetIncome(world, { provinceId: SYRACUSE, ownerRef: LEPTINES, effects: STALL_EFFECTS, upkeepBand: "slight" });
    expect(clears).toBeGreaterThan(0);
    const result = applyDeltas(world, [stall()], as());
    expect(result.rejected).toEqual([]);
    const price = clears * VENTURE_PRICE_MONTHS;
    // More than his purse holds: he pays down all but a tenth he keeps back
    // for his household (E19 -- it was the whole purse) and owes the rest.
    expect(price).toBeGreaterThan(balance(world, "leptines-purse"));
    expect(balance(result.world, "leptines-purse")).toBe(Math.ceil(balance(world, "leptines-purse") * 0.1));
    expect(result.world.material.obligations.some((obligation) => obligation.label === "Repayment of credit for A cutler's stall")).toBe(true);
    expect(result.world.genericEntities.find((entity) => entity.label === "A cutler's stall")!.upkeep).toEqual({ fromAccountId: "leptines-purse", band: "slight" });
  });

  it("costs nothing when it pays nothing", () => {
    const world = opening();
    const result = applyDeltas(world, [stall({ effects: [] })], as());
    expect(balance(result.world, "leptines-purse")).toBe(balance(world, "leptines-purse"));
  });

  it("charges an update for what it adds, and nothing for a new name", () => {
    const free = applyDeltas(opening(), [stall({ effects: [] })], as()).world;
    const id = free.genericEntities.find((entity) => entity.label === "A cutler's stall")!.id;
    const renamed = applyDeltas(free, [WorldDeltaSchema.parse({ op: "generic_entity_update", entityRef: id, label: "Leptines' knives", reason: "A sign." })], as());
    expect(balance(renamed.world, "leptines-purse")).toBe(balance(free, "leptines-purse"));
    const paying = applyDeltas(free, [WorldDeltaSchema.parse({ op: "generic_entity_update", entityRef: id, effects: STALL_EFFECTS, reason: "It starts to pay." })], as());
    expect(paying.rejected).toEqual([]);
    expect(balance(paying.world, "leptines-purse")).toBeLessThan(balance(free, "leptines-purse"));
  });
});

/** A scripted model: the orchestrator's answers in order, and nobody else is asked anything. */
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
const answer = (deltas: readonly unknown[], summary = "Leptines starts selling cutlery in the market.") => JSON.stringify({
  intent: { summary, domains: ["trade"] }, narrativeSummary: summary, frictions: [], deltas, facts: [], delegations: [], schedule: [],
  cognitionCandidates: [], outcome: "continue", playerDecision: null,
});
const burst = (port: SimModelPort, orderText: string, world: WorldState = opening()): BurstInput => ({
  world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains,
  burstId: "no-act-fits", gameId: "game-1", actorRef: LEPTINES, actorPolityId: "syracuse", orderText, knownFacts: [], queue: [],
  port, spanDays: 7, narratorSeeds: [],
});

describe("an act the engine cannot read is kept, not dropped", () => {
  // A figure paid into a private purse is refused on principle: what a
  // private income yields is set by what yields it. Written twice, it was lost.
  const FIGURE = { op: "income_source_upsert", incomeSourceRef: null, kind: "trade", label: "Cutlery sales", beneficiaryAccountRef: "leptines-purse", amount: 400, cadenceDays: 30, reason: "He sells knives." };

  it("becomes the venture it describes, at the venture's price, and the audit says so", async () => {
    const port = scripted([answer([FIGURE]), JSON.stringify({ deltas: [FIGURE] })]);
    const result = await runSimulationBurst(burst(port, "I make a business deal and start selling cutlery in the streets."));
    const venture = result.world.material.ventures.find((candidate) => candidate.title === "Cutlery sales")!;
    expect(venture.ownerCharacterId).toBe(LEPTINES.id);
    // Trade in the one market he is in.
    expect(venture.fromProvinceId).toBe(SYRACUSE);
    expect(venture.toProvinceId).toBe(SYRACUSE);
    expect(result.audit.some((entry) => entry.kind === "kept" && entry.op === "income_source_upsert")).toBe(true);
    // Paid for, not handed over.
    expect(balance(result.world, "leptines-purse")).toBeLessThan(balance(opening(), "leptines-purse"));
  });

  it("keeps what cannot be a venture or an estate as an arrangement", async () => {
    const pension = { ...FIGURE, kind: "pension", label: "A patron's allowance" };
    const port = scripted([answer([pension]), JSON.stringify({ deltas: [pension] })]);
    const result = await runSimulationBurst(burst(port, "I take an allowance from a patron."));
    expect(result.world.genericEntities.find((entity) => entity.label === "A patron's allowance")?.kind).toBe("business");
  });

  it("does not turn a payment into a thing: who is paid is the order itself", async () => {
    const payment = { op: "money_transfer", fromAccountRef: "leptines-purse", toAccountRef: "the-smiths-account", amount: 5, reason: "He pays the smith." };
    const port = scripted([answer([payment]), JSON.stringify({ deltas: [payment] })]);
    const result = await runSimulationBurst(burst(port, "I pay the smith."));
    expect(result.audit.some((entry) => entry.kind === "kept")).toBe(false);
  });
});

describe("an order that leaves nothing else leaves what he is doing", () => {
  it("records a pursuit, and the next such order replaces it rather than adding another", async () => {
    const first = await runSimulationBurst(burst(scripted([answer([])]), "I make a business deal and start selling cutlery in the streets."));
    const pursuits = (world: WorldState) => world.genericEntities.filter((entity) => entity.kind === "pursuit" && entity.ownerRef?.id === LEPTINES.id);
    expect(pursuits(first.world)).toHaveLength(1);
    expect(pursuits(first.world)[0]!.label).toBe("Leptines starts selling cutlery in the market.");
    expect(first.audit.some((entry) => entry.kind === "pursuit")).toBe(true);

    const second = await runSimulationBurst(burst(scripted([answer([], "Leptines takes up selling lamps as well.")]), "I sell lamps too.", first.world));
    expect(pursuits(second.world)).toHaveLength(1);
    expect(pursuits(second.world)[0]!.label).toBe("Leptines takes up selling lamps as well.");
  });

  it("records nothing for a question, or for an order that did something", async () => {
    const asked = await runSimulationBurst(burst(scripted([answer([])]), "What does a knife sell for in Syracuse?"));
    expect(asked.world.genericEntities.some((entity) => entity.kind === "pursuit")).toBe(false);
    const did = await runSimulationBurst(burst(scripted([answer([stall()])]), "I set up a cutler's stall."));
    expect(did.world.genericEntities.some((entity) => entity.kind === "pursuit")).toBe(false);
  });
});
