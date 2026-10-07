import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import {
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  type PolityAgreement,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { auditInWords, auditMoney, combineAudits, emptyAudit, unexplainedTotal } from "./money-audit";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { withMiddlingManagers } from "./middling-managers";

/**
 * "Where did the money come from?"
 *
 * Every income source credited its treasury and debited nobody, a foreign
 * banker's loan was a purse filling from nothing, a tribute paid by a subject
 * that kept a chest left the chest as full as it was, and a payroll to the
 * thousands nobody names simply went. The accounts could not say whether the
 * money in them was the money that had been there. `auditMoney` sorts every
 * line the world writes into what passed between two accounts and what came
 * in or went out through one of the few doors that are real -- the land and
 * its people, the market, plunder, a banker, the unnamed, bread, abroad, a
 * man's own arrival -- and finds whatever changed a balance with no line, or
 * a line with no door. Two years of the Punic world, with a merchant at sea
 * and a loan from abroad, must come out with nothing unexplained.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => withMiddlingManagers(ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0));

const as = (characterId: string): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: characterId },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`books-${characterId}`),
  gameId: "game-books",
});
const apply = (world: WorldState, deltas: readonly unknown[], context: ApplyContext) =>
  applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), context);

const THE_VENTURE: WorldDelta = {
  op: "trade_venture_open", localId: "the_run", title: "The Messana run", ownerCharacterRef: "leptines-syracuse",
  fromProvinceId: PUNIC_IDS.syracuse, toProvinceId: PUNIC_IDS.messana, band: "marked", paidFromAccountRef: "leptines-purse",
  reason: "Leptines puts a ship and a cargo of oil on the strait.",
};
const A_LOAN_FROM_ABROAD: WorldDelta = {
  op: "loan_open", localId: "the_banker", lenderKind: "foreign", lenderRef: null, borrowerAccountRef: "rome-treasury",
  principal: 120_000, interestBps: 100, cadenceDays: 30, terms: "A loan from the bankers of Massalia", collateralHoldingRef: null,
  reason: "The Senate borrows against the war.",
};

const totalMoney = (world: WorldState): number => world.material.accounts.reduce((sum, account) => sum + account.balance, 0);

describe("the books balance", { timeout: 120_000 }, () => {
  it("explains every drachma that came into the Punic world or left it across two years", () => {
    let world = opening();
    let audit = emptyAudit();

    // Orders first: a merchant fits out a ship from his purse, and Rome borrows from a banker nobody names.
    for (const [deltas, actor] of [[[THE_VENTURE], "leptines-syracuse"], [[A_LOAN_FROM_ABROAD], "gaius-genucius"]] as const) {
      const result = apply(world, deltas, as(actor));
      expect(result.rejected).toEqual([]);
      audit = combineAudits(audit, auditMoney(world, result.world));
      world = result.world;
    }

    for (let month = 1; month <= 24; month += 1) {
      const toDay = month * 30;
      const before: WorldState = { ...world, elapsedStep: toDay };
      const ticked = runDeterministicTick({
        world: before, toDay, ids: createIdFactory(`books-tick-${month}`), warfare: definition.warfare, clock: definition.clock, life: definition.life,
      });
      const monthly = auditMoney(before, ticked.world);
      // A month that created or destroyed money says which, at once, not after two years of it.
      expect(monthly.unexplained, `month ${month}:\n${auditInWords(monthly)}`).toEqual([]);
      audit = combineAudits(audit, monthly);
      world = ticked.world;
    }

    expect(unexplainedTotal(audit), auditInWords(audit)).toBe(0);
    expect(audit.unexplained).toEqual([]);

    // And the doors that should have been used were: the land paid, the unnamed were paid, the ship came in, the banker lent and was repaid.
    expect(audit.doors.harvest.in).toBeGreaterThan(0);
    expect(audit.doors.the_unnamed.out).toBeGreaterThan(0);
    expect(audit.doors.market.in).toBeGreaterThan(0);
    expect(audit.doors.credit.in).toBe(120_000);
    expect(audit.doors.credit.out).toBeGreaterThan(0);
    expect(audit.internal).toBeGreaterThan(0);
    // The sum of the world's money moved only by what went through a door.
    const through = Object.values(audit.doors).reduce((sum, door) => sum + door.in - door.out, 0);
    expect(totalMoney(world) - totalMoney(opening())).toBe(through);
  });

  it("takes a tribute out of the chest of the power that pays it, as far as the chest goes", () => {
    const world = opening();
    const bound = (syracuse: number, owed = 40_000): WorldState => ({
      ...world,
      material: {
        ...world.material,
        accounts: world.material.accounts.map((account) => (account.id === "syracuse-treasury" ? { ...account, balance: syracuse } : account)),
        incomeSources: [...world.material.incomeSources, {
          id: "syracuse-tribute", kind: "tribute" as const, label: "Tribute of Syracuse", beneficiaryAccountId: "carthage-treasury", originKind: "polity" as const, originId: "carthage",
          counterpartyPolityId: "syracuse", amount: owed, cadenceSteps: 30, nextDueStep: 30, collectionRateBps: 10_000, active: true,
        }],
      },
    });
    const month = (state: WorldState) => runDeterministicTick({ world: { ...state, elapsedStep: 30 }, toDay: 30, ids: createIdFactory("tribute"), warfare: definition.warfare });
    const paying = bound(520_000);
    const paid = month(paying);
    const line = paid.world.material.transactions.find((transaction) => transaction.cause.id === "syracuse-tribute")!;
    expect(line).toMatchObject({ sourceAccountId: "syracuse-treasury", destinationAccountId: "carthage-treasury", amount: 40_000 });
    expect(line.external).toBeUndefined();
    expect(unexplainedTotal(auditMoney({ ...paying, elapsedStep: 30 }, paid.world))).toBe(0);
    // A chest that holds less pays what it holds (with the tithe that came in the same month): nothing is made up.
    const poor = month(bound(25_000, 200_000));
    expect(poor.world.material.transactions.find((transaction) => transaction.cause.id === "syracuse-tribute")?.amount).toBeLessThanOrEqual(25_000 + 62_000);
  });

  it("explains the customs trade pays too: a year of goods crossing borders under tariffs, a pact and an embargo, nothing unexplained", () => {
    // Every power lays customs, Carthage and Syracuse have a pact capping them, and Rome has embargoed the Ligurians.
    const base = opening();
    const agreementOf = (kind: "trade_pact" | "embargo", polityId: string, otherPolityId: string, trade?: PolityAgreement["trade"]) => ({
      id: `${kind}_${polityId}_${otherPolityId}`, kind, polityId, otherPolityId, terms: `A ${kind}.`, ...(trade === undefined ? {} : { trade }), sinceStep: 0, untilStep: null,
      sourceMessageId: null, status: "active" as const, endedAtStep: null, endedReason: null, visibility: "public" as const,
    });
    let world: WorldState = {
      ...base,
      economy: {
        ...base.economy!,
        customsRates: [{ polityId: "carthage", rateBps: 800 }, { polityId: "rome", rateBps: 250 }, { polityId: "syracuse", rateBps: 1_500 }, { polityId: "mamertines", rateBps: 600 }],
      },
      polityAgreements: [...base.polityAgreements,
        agreementOf("trade_pact", "carthage", "syracuse", { tariffCapBps: 500, mostFavoured: false, exempt: ["grain"], goods: [] }),
        agreementOf("embargo", "rome", "ligurians", { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [] }),
      ],
    };
    let audit = emptyAudit();
    let customs = 0;
    for (let month = 1; month <= 12; month += 1) {
      const toDay = month * 30;
      const before: WorldState = { ...world, elapsedStep: toDay };
      const ticked = runDeterministicTick({ world: before, toDay, ids: createIdFactory(`customs-tick-${month}`), warfare: definition.warfare, clock: definition.clock, life: definition.life });
      const monthly = auditMoney(before, ticked.world);
      expect(monthly.unexplained, `month ${month}:\n${auditInWords(monthly)}`).toEqual([]);
      customs += ticked.world.material.transactions.filter((line) => line.cause.id.startsWith("customs_") && !before.material.transactions.some((known) => known.id === line.id)).reduce((sum, line) => sum + line.amount, 0);
      audit = combineAudits(audit, monthly);
      world = ticked.world;
    }
    expect(unexplainedTotal(audit), auditInWords(audit)).toBe(0);
    // Customs were paid, through the market's door and nowhere else.
    expect(customs).toBeGreaterThan(0);
    expect(audit.doors.market.in).toBeGreaterThanOrEqual(customs);
    const through = Object.values(audit.doors).reduce((sum, door) => sum + door.in - door.out, 0);
    expect(totalMoney(world) - totalMoney(opening())).toBe(through);
  });

  it("finds money made from nowhere", () => {
    const before = opening();
    const rich = { ...before, material: { ...before.material, accounts: before.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance: account.balance + 1_000 } : account)) } };
    const audit = auditMoney(before, rich);
    expect(unexplainedTotal(audit)).toBe(1_000);
    expect(audit.unexplained[0]?.kind).toBe("unrecorded");

    const untagged = { ...rich, material: { ...rich.material, transactions: [...rich.material.transactions, {
      id: "txn-from-nowhere", atStep: 0, kind: "income" as const, amount: 1_000, destinationAccountId: "rome-treasury",
      cause: { kind: "scheduled_income" as const, id: "nothing", explanation: "Income nobody can account for" }, visibility: "polity" as const,
    }] } };
    const written = auditMoney(before, untagged);
    expect(written.unexplained.map((entry) => entry.kind)).toEqual(["untagged"]);
    // The same line naming a door is explained.
    const tagged = { ...untagged, material: { ...untagged.material, transactions: untagged.material.transactions.map((line) => (line.id === "txn-from-nowhere" ? { ...line, external: "harvest" as const } : line)) } };
    expect(unexplainedTotal(auditMoney(before, tagged))).toBe(0);
  });
});
