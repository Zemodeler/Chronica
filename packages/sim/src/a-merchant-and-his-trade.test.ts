import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  buildStation,
  ensureProvinceMaterial,
  ventureTerms,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
void applyDeltas;
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "I am a merchant of Syracuse. I fit out a ship and trade to Messana."
 *
 * A merchant got a purse and nothing else. Trade was an income with a label:
 * the model could write him any figure, lawfully, into his own purse; he could
 * not own a ship without breaching his whole country's authority, and a ship he
 * raised came out as four hundred foot soldiers; lending his own money to his
 * own government was a breach of its treasury; and nothing could cut his trade
 * except a blockade of any port his country had, anywhere.
 *
 * Now his trade is a venture between two places, priced by the engine; a war
 * with the power at its far end or an enemy fleet off one of its own ports
 * stops it, and it resumes when they are gone; he can fit out a ship from his
 * own purse, lend his own money, and his route is his business.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const SYRACUSE = "ita-72843720b81376294924159-sicily-southeast";
const MESSANA = "ita-72843720b81376294924159-sicily-northeast";
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

const as = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`trade-${characterId}`),
  gameId: "game-1",
});
/** Parsed as the engine parses every answer, so each op carries its defaults. */
const apply = (world: WorldState, deltas: readonly unknown[], context: ApplyContext) =>
  applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), context);

/** Two powers at war, as a declared war stands in the world. */
const atWarWith = (world: WorldState, polityId: string, otherPolityId: string): WorldState => ({
  ...world,
  polityAgreements: [...world.polityAgreements, {
    id: `war-${polityId}-${otherPolityId}`, kind: "war", polityId, otherPolityId, terms: "War.", sinceStep: world.elapsedStep,
    untilStep: null, sourceMessageId: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public",
  }],
});

const balance = (world: WorldState, accountId: string) => world.material.accounts.find((account) => account.id === accountId)!.balance;
const tick = (world: WorldState, toDay: number) => runDeterministicTick({ world, toDay, ids: createIdFactory(`trade-tick-${toDay}`), warfare: definition.warfare });

const THE_VENTURE: WorldDelta = {
  op: "trade_venture_open", localId: "the_run", title: "The Messana run", ownerCharacterRef: "leptines-syracuse",
  fromProvinceId: SYRACUSE, toProvinceId: MESSANA, band: "marked", paidFromAccountRef: "leptines-purse",
  reason: "Leptines puts a ship and a cargo of oil on the strait.",
};

function withTheVenture(): WorldState {
  const result = apply(opening(), [THE_VENTURE], as("leptines-syracuse"));
  expect(result.rejected).toEqual([]);
  return result.world;
}

/** Leptines' purse gained this month, less what his estate paid him. */
const tradeReturn = (before: WorldState, after: WorldState): number => balance(after, "leptines-purse") - balance(before, "leptines-purse") - 90;

describe("a merchant and his trade", () => {
  it("opens a venture between two ports from his own purse, lawfully, at the engine's price", () => {
    const world = opening();
    const terms = ventureTerms(world, SYRACUSE, MESSANA, "marked")!;
    const result = apply(world, [THE_VENTURE], as("leptines-syracuse"));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
    expect(balance(result.world, "leptines-purse")).toBe(balance(world, "leptines-purse") - terms.price);
    const venture = result.world.material.ventures[0]!;
    expect(venture.bySea).toBe(true);
    const income = result.world.material.incomeSources.find((source) => source.id === venture.incomeSourceId)!;
    // The far end is the Mamertines' city, so a war with them can cut it.
    expect(income.counterpartyPolityId).toBe("mamertines");
    expect(income.amount).toBe(terms.monthlyReturn);
  });

  it("sells in the streets of one city: one province named twice is trade in one market", () => {
    const world = opening();
    const stall: WorldDelta = { ...THE_VENTURE, localId: "the_stall", title: "Knives and spoons in the streets of Syracuse", toProvinceId: SYRACUSE, band: "slight", reason: "Leptines sets up a stall." };
    const result = apply(world, [stall], as("leptines-syracuse"));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
    const terms = ventureTerms(world, SYRACUSE, SYRACUSE, "slight")!;
    expect(balance(result.world, "leptines-purse")).toBe(balance(world, "leptines-purse") - terms.price);
    const venture = result.world.material.ventures[0]!;
    expect(venture.fromProvinceId).toBe(venture.toProvinceId);
    // His own city: no foreign power at the far end to cut it.
    expect(result.world.material.incomeSources.find((source) => source.id === venture.incomeSourceId)!.counterpartyPolityId).toBeNull();
    const month = tick(result.world, 30).world;
    expect(tradeReturn(result.world, month)).toBe(terms.monthlyReturn);
  });

  it("pays him every month while the sea is open", () => {
    const opened = withTheVenture();
    const month = tick(opened, 30).world;
    expect(tradeReturn(opened, month)).toBe(ventureTerms(opened, SYRACUSE, MESSANA, "marked")!.monthlyReturn);
  });

  it("stops when his country is at war with the power at its far end, says so, and resumes at peace", () => {
    const opened = withTheVenture();
    const atWar = atWarWith(opened, "syracuse", "mamertines");
    const month = tick(atWar, 30);
    expect(tradeReturn(atWar, month.world)).toBe(0);
    expect(month.factProposals.some((fact) => fact.kind === "venture_interrupted" && fact.summary.includes("war"))).toBe(true);
    expect(month.world.material.ventures[0]!.interruptedBy).toBe("war");

    const peace: WorldState = { ...month.world, polityAgreements: month.world.polityAgreements.map((agreement) => ({ ...agreement, status: "ended" as const })) };
    const resumed = tick(peace, 60);
    expect(resumed.factProposals.some((fact) => fact.kind === "venture_resumed")).toBe(true);
    expect(resumed.world.material.ventures[0]!.interruptedBy).toBeNull();
  });

  it("stops when an enemy fleet sits off one of its own ports -- and only its own", () => {
    const opened = withTheVenture();
    const war = atWarWith(opened, "carthage", "syracuse");
    // The Carthaginian fleet at Lilybaeum, far from his route: his trade goes on.
    const elsewhere = tick(war, 30);
    expect(tradeReturn(war, elsewhere.world)).toBeGreaterThan(0);
    // The fleet off Syracuse itself: it stops.
    const blockaded: WorldState = {
      ...elsewhere.world,
      material: { ...elsewhere.world.material, forces: elsewhere.world.material.forces.map((force) => (force.id === "carthaginian-fleet" ? { ...force, locationId: SYRACUSE } : force)) },
    };
    const shut = tick(blockaded, 60);
    expect(tradeReturn(blockaded, shut.world)).toBe(0);
    expect(shut.world.material.ventures[0]!.interruptedBy).toBe("blockade");
  });

  it("makes his route his business", () => {
    const station = buildStation({ world: withTheVenture(), characterId: "leptines-syracuse", offices: definition.government.offices });
    expect(station.provinceIds.has(MESSANA)).toBe(true);
  });

  it("lets him fit out a ship of his own, as a ship, paid from his purse, without breaching his country", () => {
    const deltas = [
      { op: "obligation_upsert", localId: "crew_pay", obligationRef: null, kind: "army_pay", label: "Wages of the Eagle's crew", payerAccountRef: "leptines-purse", recipientAccountRef: null, amount: 12, cadenceDays: 30, priority: 700, active: true, reason: "He pays his own crew." },
      { op: "force_create", localId: "the_eagle", name: "The Eagle", polityId: "syracuse", commanderCharacterRef: "leptines-syracuse", controllerCharacterRef: "leptines-syracuse", locationId: SYRACUSE, authorizedStrength: 1, payObligationRef: "local:crew_pay", categoryId: "warship", reason: "A merchantman armed against pirates." },
    ];
    const result = apply(opening(), deltas, as("leptines-syracuse"));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
    const ship = result.world.material.forces.find((force) => force.name === "The Eagle")!;
    expect(ship.personnel[0]!.categoryId).toBe("warship");
  });

  it("lets him lend his own money to his government, lawfully for the lender", () => {
    const loan = {
      op: "loan_open", localId: "the_loan", lenderKind: "character", lenderRef: "leptines-syracuse", borrowerAccountRef: "syracuse-treasury",
      principal: 500, interestBps: 100, cadenceDays: 30, terms: "Five hundred at one part in a hundred a month.", reason: "Leptines lends to the king.",
    };
    const world = opening();
    const result = apply(world, [loan], as("leptines-syracuse"));
    expect(result.rejected).toEqual([]);
    expect(result.breaches).toEqual([]);
    expect(balance(result.world, "leptines-purse")).toBe(balance(world, "leptines-purse") - 500);
  });

  it("does not let a finished project pay a private purse a figure, and bounds what one pays a treasury", () => {
    const privately: WorldDelta = {
      op: "project_create", localId: "the_mill", kind: "construction", label: "A mill", sponsorRef: { kind: "character", id: "leptines-syracuse" },
      fundingAccountRef: "leptines-purse", milestones: [{ label: "Built", dueInDays: 10, costAmount: 0 }],
      completionOutcome: { kind: "income_source", label: "The mill's takings", amount: 100_000, provinceId: SYRACUSE, beneficiaryAccountRef: "leptines-purse", cadenceDays: 30 },
      reason: "He builds a mill.",
    } as unknown as WorldDelta;
    const refused = apply(opening(), [privately], as("leptines-syracuse"));
    expect(refused.rejected.map((rejection) => rejection.kind)).toContain("reference");

    const forTheCity = { ...(privately as unknown as Record<string, unknown>), localId: "the_harbour", label: "A harbour", sponsorRef: { kind: "polity", id: "syracuse" }, fundingAccountRef: "syracuse-treasury", completionOutcome: { kind: "income_source", label: "Harbour dues", amount: 100_000, provinceId: SYRACUSE, beneficiaryAccountRef: "syracuse-treasury", cadenceDays: 30 } } as unknown as WorldDelta;
    const built = apply(opening(), [forTheCity], as("hieron-ii"));
    expect(built.rejected).toEqual([]);
    const finished = tick(built.world, 30).world;
    const dues = finished.material.incomeSources.find((source) => source.label === "Harbour dues")!;
    // A great market's share of Syracuse, not the hundred thousand the answer promised.
    expect(dues.amount).toBeLessThan(5_000);
  });
});
