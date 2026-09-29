import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, estateTerms, improvementTerms, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { withMiddlingManagers } from "./middling-managers";

/**
 * "I don't hold office. I own an estate, and I mean to improve it."
 *
 * A private citizen had no lawful way to do anything with land. Every holding
 * in the world was an empty list; developing a province was a government's
 * act, so a private man ordering it breached his authority -- or, because the
 * men and money did not answer to him, simply was not heard. Manius Curius,
 * the man with the most standing in Rome, owned nothing but a purse.
 *
 * Now the leading men own estates that pay them every month; an estate can be
 * bought with one's own money, or granted out of the public land by the
 * government; and an owner can improve his own land from his own purse without
 * anybody's leave. The engine, not the model, says what land costs and yields.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
// Middling managers: these count estates, not the skill of the men running them.
const opening = (): WorldState => withMiddlingManagers(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));
const LATIUM = "punic-italy-latium";

const as = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`land-${characterId}`),
  gameId: "game-1",
});

const balance = (world: WorldState, accountId: string) => world.material.accounts.find((account) => account.id === accountId)!.balance;
const yieldOf = (world: WorldState, holdingId: string) => {
  const holding = world.material.holdings.find((candidate) => candidate.id === holdingId)!;
  return world.material.incomeSources.find((source) => source.id === holding.incomeSourceId)!.amount;
};

const IMPROVE_THE_FARM: WorldDelta = {
  op: "holding_improve", holdingRef: "curius-sabine-farm", band: "slight",
  works: "Drain the lower fields and plant them with vines", paidFromAccountRef: "curius-purse",
  reason: "Curius improves his own farm.",
};

describe("a man and his land", () => {
  it("gives the leading men estates that pay them every month", () => {
    const world = opening();
    expect(world.material.holdings.find((holding) => holding.id === "curius-sabine-farm")?.legalHolderCharacterId).toBe("manius-curius");
    const before = balance(world, "curius-purse");
    const month = runDeterministicTick({ world, toDay: 30, ids: createIdFactory("land-tick"), warfare: definition.warfare }).world;
    expect(balance(month, "curius-purse")).toBe(before + 40);
    // An estate authored in the scenario is the same kind of thing as one bought in play.
    expect(estateTerms(world, LATIUM, "slight")?.monthlyYield).toBe(40);
  });

  it("lets a private citizen improve his own estate from his own purse, lawfully", () => {
    const world = opening();
    const terms = improvementTerms(world, LATIUM, 40, "slight")!;
    const result = applyDeltas(world, [IMPROVE_THE_FARM], as("manius-curius"));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
    expect(balance(result.world, "curius-purse")).toBe(balance(world, "curius-purse") - terms.cost);
    expect(yieldOf(result.world, "curius-sabine-farm")).toBe(40 + terms.added);
  });

  it("refuses works nobody can pay for, as the world refusing", () => {
    const world = opening();
    const poor: WorldState = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "curius-purse" ? { ...account, balance: 10 } : account)) } };
    const result = applyDeltas(poor, [IMPROVE_THE_FARM], as("manius-curius"));
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.kind).toBe("world");
  });

  it("will not improve land past what it can give", () => {
    let world = opening();
    let refused = false;
    for (let attempt = 0; attempt < 40 && !refused; attempt += 1) {
      const rich: WorldState = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "curius-purse" ? { ...account, balance: 1_000_000 } : account)) } };
      const result = applyDeltas(rich, [{ ...IMPROVE_THE_FARM, band: "great" }], as("manius-curius"));
      refused = result.rejected.length > 0;
      world = result.world;
    }
    expect(refused).toBe(true);
    // A tenth of what a market in Latium would bring in: an estate is a man's living.
    expect(yieldOf(world, "curius-sabine-farm")).toBeLessThanOrEqual(600);
  });

  it("lets him buy land with his own money, at the engine's price", () => {
    const world = opening();
    const terms = estateTerms(world, LATIUM, "slight")!;
    const buy: WorldDelta = {
      op: "holding_create", localId: "the_new_farm", title: "A farm on the Anio", provinceId: LATIUM,
      holderCharacterRef: "manius-curius", band: "slight", priceFromAccountRef: "curius-purse",
      reason: "Curius buys the farm beside his own.",
    };
    const result = applyDeltas(world, [buy], as("manius-curius"));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
    expect(balance(result.world, "curius-purse")).toBe(balance(world, "curius-purse") - terms.price);
    const farm = result.world.material.holdings.find((holding) => holding.title === "A farm on the Anio")!;
    expect(farm.legalHolderCharacterId).toBe("manius-curius");
    expect(yieldOf(result.world, farm.id)).toBe(terms.monthlyYield);
  });

  it("treats a grant of public land as the government's act: lawful for the consul, a breach for a private man", () => {
    const grant: WorldDelta = {
      op: "holding_create", localId: "the_grant", title: "Public land by the Liris", provinceId: LATIUM,
      holderCharacterRef: "quintus-ogulnius", band: "marked", priceFromAccountRef: null,
      reason: "A grant for services to the state.",
    };
    expect(applyDeltas(opening(), [grant], as("gaius-genucius")).breaches).toEqual([]);
    const unlawful = applyDeltas(opening(), [grant], as("manius-curius"));
    const heard = unlawful.breaches.length > 0 || unlawful.rejected.some((rejection) => rejection.kind === "ignored");
    expect(heard).toBe(true);
  });

  it("does not let an income be written into a private purse, or an estate's yield be rewritten, or a revenue be redirected", () => {
    const world = opening();
    const handedAnIncome: WorldDelta = {
      op: "income_source_upsert", incomeSourceRef: null, localId: "windfall", kind: "trade", label: "Grain trade to Rome",
      beneficiaryAccountRef: "curius-purse", amount: 5_000, cadenceDays: 30, counterpartyPolityId: null, active: true,
      reason: "He trades grain.",
    };
    const rewritten: WorldDelta = {
      op: "income_source_upsert", incomeSourceRef: "curius-sabine-farm-yield", kind: "land", label: "Yield of The Sabine farm",
      beneficiaryAccountRef: "curius-purse", amount: 5_000, cadenceDays: 30, counterpartyPolityId: null, active: true,
      reason: "A bumper year, forever.",
    };
    const redirected: WorldDelta = {
      op: "income_source_upsert", incomeSourceRef: "rome-tributum", kind: "tax", label: "The tributum on Roman citizens",
      beneficiaryAccountRef: "carthage-treasury", amount: 1_100, cadenceDays: 30, counterpartyPolityId: null, active: true,
      reason: "Carthage takes Rome's taxes.",
    };
    for (const delta of [handedAnIncome, rewritten, redirected]) {
      const result = applyDeltas(world, [delta], as("manius-curius"));
      expect(result.rejected).toHaveLength(1);
      // An engine refusal, so the repair pass can put it the right way -- an
      // estate, an office, a payment -- rather than a rule of the world.
      expect(result.rejected[0]!.kind).toBe("reference");
    }
    expect(yieldOf(world, "curius-sabine-farm")).toBe(40);

    // A government still levies what it levies; the tick bounds what the land bears.
    const raised: WorldDelta = { ...redirected, beneficiaryAccountRef: "rome-treasury", amount: 1_500, reason: "The Senate raises the tributum." };
    const levied = applyDeltas(world, [raised], as("gaius-genucius"));
    expect(levied.rejected).toEqual([]);
    expect(levied.world.material.incomeSources.find((source) => source.id === "rome-tributum")?.amount).toBe(1_500);
  });

  it("does not let a private man improve his farm out of the treasury", () => {
    const fromTheTreasury: WorldDelta = { ...IMPROVE_THE_FARM, paidFromAccountRef: "rome-treasury" };
    const result = applyDeltas(opening(), [fromTheTreasury], as("manius-curius"));
    const lawful = result.breaches.length === 0 && result.rejected.length === 0;
    expect(lawful).toBe(false);
  });
});
