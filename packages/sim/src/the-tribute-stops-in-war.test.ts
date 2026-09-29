import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldStateSchema,
  atWar,
  economyOf,
  ensureProvinceMaterial,
  openWar,
  type MoneyObligation,
  type PolityAgreement,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";

/**
 * What a treaty pays stops when the treaty does -- and a treaty that is not
 * paid is broken.
 *
 * Only tearing a treaty up by name stopped its payments, so a war that ended a
 * peace left the defeated paying their indemnity to the enemy they were
 * fighting again; a tributary paid nothing at all; a missed tribute was a line
 * in the arrears; and breaking a peace cost the breaker nothing with anyone.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const balance = (world: WorldState, id: string) => world.material.accounts.find((account) => account.id === id)!.balance;
const tick = (world: WorldState, toDay: number) => runDeterministicTick({ world, toDay, ids: createIdFactory(`treaty-${toDay}`), warfare: definition.warfare });
const context = (day = 0): ApplyContext => ({
  now: { day, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices,
  warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory(`apply-${day}`), gameId: "game-1", actsForTheWorld: true,
});

const agreement = (id: string, kind: PolityAgreement["kind"], polityId: string, otherPolityId: string): PolityAgreement => ({
  id, kind, polityId, otherPolityId, terms: "As written.", sinceStep: 0, untilStep: null, sourceMessageId: null,
  status: "active", endedAtStep: null, endedReason: null, visibility: "public",
});
const indemnity = (id: string, payer: string, recipient: string, treatyId: string): MoneyObligation => ({
  id, kind: "tribute", label: "Indemnity owed by Carthage to the Roman Republic", payerAccountId: payer, recipientAccountId: recipient,
  amount: 500, cadenceSteps: 30, nextDueStep: 30, priority: 450, arrears: 0, missedPeriods: 0, active: true, consequenceRef: treatyId, remainingPeriods: 10,
});

/** Carthage at peace with Rome, paying it an indemnity. */
function aPeaceWithAnIndemnity(): WorldState {
  const world = opening();
  return {
    ...world,
    polityAgreements: [...world.polityAgreements, agreement("peace-1", "peace", "carthage", "rome")],
    material: { ...world.material, obligations: [...world.material.obligations, indemnity("indemnity-1", "carthage-treasury", "rome-treasury", "peace-1")] },
  };
}

describe("the tribute stops in war", () => {
  it("is paid while the peace holds", () => {
    const world = aPeaceWithAnIndemnity();
    const paid = tick(world, 30).world;
    expect(paid.material.obligations.find((obligation) => obligation.id === "indemnity-1")!.remainingPeriods).toBe(9);
  });

  it("stops the day a war ends the peace it was owed under, when the war is declared", () => {
    const world = aPeaceWithAnIndemnity();
    const war: WorldDelta = { op: "agreement_open", localId: "carthage_breaks", kind: "war", polityId: "carthage", otherPolityId: "rome", terms: "Carthage takes up arms again.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Carthage will pay no more." };
    const declared = applyDeltas(world, [war], context());
    expect(declared.rejected).toEqual([]);
    expect(declared.world.material.obligations.find((obligation) => obligation.id === "indemnity-1")!.active).toBe(false);
  });

  it("stops however the war was opened -- by the calendar too, before a coin is paid", () => {
    const world = aPeaceWithAnIndemnity();
    // A war the engine opens itself (an ultimatum's term running out) ends the peace and touches nothing else.
    const atWarAgain: WorldState = {
      ...world,
      polityAgreements: openWar(world.polityAgreements, { id: "war-2", polityId: "carthage", otherPolityId: "rome", terms: "Again.", atStep: 0, sourceMessageId: null, reason: "No answer came." }),
    };
    const romeBefore = balance(atWarAgain, "rome-treasury");
    const ticked = tick(atWarAgain, 30).world;
    expect(ticked.material.obligations.find((obligation) => obligation.id === "indemnity-1")!.active).toBe(false);
    expect(ticked.material.transactions.some((transaction) => transaction.cause.id === "indemnity-1")).toBe(false);
    expect(balance(ticked, "rome-treasury")).toBeLessThanOrEqual(romeBefore + 5_000);
  });

  it("makes a tributary pay: a tenth of what its lands yield, every month", () => {
    const world = opening();
    const bound: WorldState = { ...world, polityAgreements: [...world.polityAgreements, agreement("tribute-1", "tributary", "syracuse", "carthage")] };
    const first = tick(bound, 1).world;
    const tribute = first.material.obligations.find((obligation) => obligation.consequenceRef === "tribute-1");
    expect(tribute).toBeDefined();
    expect(tribute!.payerAccountId).toBe("syracuse-treasury");
    expect(tribute!.recipientAccountId).toBe("carthage-treasury");
    expect(tribute!.amount).toBeGreaterThan(0);
    const month = tick(first, 31).world;
    expect(month.material.transactions.some((transaction) => transaction.cause.id === tribute!.id)).toBe(true);
    // Once: a second tick makes no second tribute.
    expect(tick(month, 40).world.material.obligations.filter((obligation) => obligation.consequenceRef === "tribute-1")).toHaveLength(1);
    // And a war between them ends the tribute with it.
    const war = { ...month, polityAgreements: openWar(month.polityAgreements, { id: "revolt", polityId: "syracuse", otherPolityId: "carthage", terms: "No more.", atStep: 40, sourceMessageId: null, reason: "Syracuse revolts." }) };
    expect(tick(war, 45).world.material.obligations.find((obligation) => obligation.consequenceRef === "tribute-1")!.active).toBe(false);
  });

  it("breaks the treaty when it goes unpaid three times, and a creditor strong enough goes to collect", () => {
    // The Mamertines pay Carthage tribute out of an empty chest.
    const world = opening();
    let current: WorldState = {
      ...world,
      polityAgreements: [...world.polityAgreements, agreement("tribute-m", "tributary", "mamertines", "carthage")],
      material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "mamertine-treasury" ? { ...account, balance: 0 } : account)), incomeSources: world.material.incomeSources.filter((source) => source.beneficiaryAccountId !== "mamertine-treasury") },
    };
    const kinds: string[] = [];
    const summaries: string[] = [];
    for (let day = 1; day <= 130; day += 30) {
      const ticked = tick(current, day);
      current = ticked.world;
      kinds.push(...ticked.factProposals.map((fact) => String(fact.kind)));
      summaries.push(...ticked.factProposals.map((fact) => fact.summary));
    }
    expect(kinds).toContain("treaty_breached");
    expect(kinds.filter((kind) => kind === "treaty_breached")).toHaveLength(1);
    expect(current.polityStances.find((stance) => stance.polityId === "carthage" && stance.towardPolityId === "mamertines")!.trustScore).toBeLessThanOrEqual(-30);
    expect(economyOf(current).grievances.some((grievance) => grievance.polityId === "carthage" && grievance.againstPolityId === "mamertines")).toBe(true);
    // Carthage has twice their men, and goes to collect -- which breaks no faith: it had cause.
    expect(atWar(current.polityAgreements, "carthage", "mamertines")).toBe(true);
    expect(summaries.some((summary) => summary.includes("to collect the tribute"))).toBe(true);
    expect(kinds).not.toContain("peace_broken");
  });

  it("costs a power that breaks its peace, at home and with everybody it deals with", () => {
    const world = opening();
    const atPeace: WorldState = {
      ...world,
      polityAgreements: [...world.polityAgreements, agreement("peace-cs", "peace", "carthage", "syracuse"), agreement("trade-cm", "trade_pact", "carthage", "mamertines")],
    };
    const seen = tick(atPeace, 1).world;
    const legitimacy = (state: WorldState) => state.material.polityLegitimacy.find((entry) => entry.polityId === "carthage")?.legitimacyBps ?? 5_000;
    const before = legitimacy(seen);
    const war: WorldDelta = { op: "agreement_open", localId: "carthage_strikes", kind: "war", polityId: "carthage", otherPolityId: "syracuse", terms: "Carthage marches on Syracuse.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Greed." };
    const declared = applyDeltas(seen, [war], context(1));
    expect(declared.rejected).toEqual([]);
    const after = tick(declared.world, 2);
    expect(after.factProposals.some((fact) => fact.kind === "peace_broken")).toBe(true);
    expect(legitimacy(after.world)).toBeLessThan(before);
    const trust = (from: string) => after.world.polityStances.find((stance) => stance.polityId === from && stance.towardPolityId === "carthage")?.trustScore ?? 0;
    expect(trust("syracuse")).toBeLessThanOrEqual(-40);
    expect(trust("mamertines")).toBeLessThan(0);
    // Once.
    expect(tick(after.world, 3).factProposals.some((fact) => fact.kind === "peace_broken")).toBe(false);
  });
});
