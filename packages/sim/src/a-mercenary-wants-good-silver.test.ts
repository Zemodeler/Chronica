import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  MERCENARY_GRACE_PERIODS, ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, coinageOfPolity, ensureProvinceMaterial, mercenaryGracePeriods, mercenaryWageBps, silverDeficitBps, standardOf,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { auditMoney } from "./money-audit";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "A mercenary wants good silver."
 *
 * Carthage paid its soldiers in Sicily in coin struck for the purpose, kept the
 * Attic weight because Greek and Italian mercenaries would take nothing lighter,
 * and ended the Mercenary War (241-238) striking billon with the treasury empty.
 * The war began with wages in arrears. A hired company here is paid in its
 * employer's coin: the sum passes the money-changers into the captain's purse,
 * the wage it asks follows what the coin is worth in silver (at once, where
 * prices follow slowly), it asks more for each period it has waited, and it
 * waits less and sours faster the worse the coin (`world/mercenary-pay.ts`).
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);

/** Rome with its coin struck to hold `share` in a hundred of the silver it was struck at. */
const romeCoinedAt = (share: number, state: WorldState = opening()): WorldState => ({
  ...state,
  economy: {
    ...state.economy!,
    coinages: state.economy!.coinages.map((coinage) => (coinage.polityIds.includes("rome") ? { ...coinage, standardBps: standardOf(coinage), silverBps: Math.round((standardOf(coinage) * share) / 100) } : coinage)),
  },
});

/** Rome hires the Campanians' company for a wage, out of its treasury. */
function romeHires(state: WorldState, monthlyPay: number): { world: WorldState; contractId: string; forceId: string; obligationId: string } {
  const company = state.material.forces.find((force) => force.commanderCharacterId === "decius-vibellius")!;
  const deltas = [WorldDeltaSchema.parse({
    op: "service_contract_open", localId: "campanians", role: "mercenary", label: "The Campanians in Roman pay",
    employerAccountRef: "rome-treasury", employeeRef: "decius-vibellius", monthlyPay, termDays: 720, duties: "Fight for Rome in Sicily.", forceRef: company.id, reason: "Rome needs men across the strait.",
  })];
  const context: ApplyContext = {
    now: { day: 0, minute: 540 }, actorRef: { kind: "character", id: "gaius-genucius" }, offices: definition.government.offices, warfare: definition.warfare,
    terrains: definition.map.terrains, ids: createIdFactory("merc-hire"), gameId: "game-merc", actsForTheWorld: true, orderDeltas: new Set(deltas),
  };
  const hired = applyDeltas(state, deltas, context);
  expect(hired.rejected).toEqual([]);
  const contract = hired.world.material.contracts.at(-1)!;
  return { world: hired.world, contractId: contract.id, forceId: company.id, obligationId: contract.obligationId! };
}

const tickTo = (state: WorldState, day: number): WorldState =>
  runDeterministicTick({ world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`merc-${day}`), warfare: definition.warfare }).world;
const emptied = (state: WorldState): WorldState => ({ ...state, material: { ...state.material, accounts: state.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance: 0 } : account)) } });
/** A wage no month of Rome's revenue can meet, so the company goes unpaid month after month. */
const UNPAYABLE = 60_000_000;
const contractOf = (state: WorldState, id: string) => state.material.contracts.find((contract) => contract.id === id)!;
const forceOf = (state: WorldState, id: string) => state.material.forces.find((force) => force.id === id)!;

describe("a mercenary wants good silver", () => {
  it("reads a coin's silver deficit and what the soldiers ask because of it", () => {
    const sound = opening();
    expect(silverDeficitBps(sound, "rome")).toBe(0);
    const debased = romeCoinedAt(80);
    expect(coinageOfPolity(debased, "rome").silverBps).toBeLessThan(standardOf(coinageOfPolity(debased, "rome")));
    expect(coinageOfPolity(sound, "rome").silverBps).toBe(7_300);
    expect(silverDeficitBps(debased, "rome")).toBe(2_000);
    const { world } = romeHires(sound, 5_000);
    const contract = world.material.contracts.at(-1)!;
    // Sound coin: the wage as written; a coin a fifth short in silver, a quarter more of it (a sound unit's silver over what this holds).
    expect(mercenaryWageBps(sound, contract, 0)).toBe(10_000);
    expect(mercenaryWageBps(debased, contract, 0)).toBe(12_500);
    // And five in a hundred more for each period gone unpaid, to a half more at most.
    expect(mercenaryWageBps(sound, contract, 2)).toBe(11_000);
    expect(mercenaryWageBps(sound, contract, 40)).toBe(15_000);
    // Two periods of grace in sound silver; none when a fifth of it has gone.
    expect(mercenaryGracePeriods(sound, contract)).toBe(MERCENARY_GRACE_PERIODS);
    expect(mercenaryGracePeriods(romeCoinedAt(90), contract)).toBe(1);
    expect(mercenaryGracePeriods(debased, contract)).toBe(0);
  });

  it("pays the wage as written in sound coin, and a quarter more of the silver when the coin is a fifth short", () => {
    const paid = (state: WorldState): number => {
      const { world, obligationId } = romeHires(state, 5_000);
      const next = tickTo(world, 30);
      return next.material.transactions.filter((transaction) => transaction.cause.id === obligationId).reduce((sum, transaction) => sum + transaction.amount, 0);
    };
    const sound = paid(opening());
    const short = paid(romeCoinedAt(80));
    expect(sound).toBeGreaterThan(0);
    // Whatever passes the money-changers is taken from the wage in either case; the debased coin's wage is a quarter bigger before it.
    expect(short / sound).toBeGreaterThan(1.2);
    expect(short / sound).toBeLessThan(1.3);
  });

  it("keeps the books balanced when soldiers' pay passes the money-changers", () => {
    const { world } = romeHires(opening(), 5_000);
    const after = tickTo(world, 30);
    expect(auditMoney({ ...world, elapsedStep: 0 }, after).unexplained).toEqual([]);
  });

  it("waits two periods for a late wage in sound coin, and walks on the third", () => {
    const { world, contractId } = romeHires(emptied(opening()), UNPAYABLE);
    const one = tickTo(world, 30);
    expect(contractOf(one, contractId).status).toBe("active");
    const two = tickTo(one, 60);
    expect(contractOf(two, contractId).status).toBe("active");
    const three = tickTo(two, 90);
    expect(contractOf(three, contractId).status).toBe("lapsed");
  });

  it("walks at the first late wage when the coin is a fifth short in silver, and its force goes back to its captain", () => {
    const { world, contractId, forceId } = romeHires(emptied(romeCoinedAt(80)), UNPAYABLE);
    const company = opening().material.forces.find((force) => force.id === forceId)!;
    const one = tickTo(world, 30);
    expect(contractOf(one, contractId).status).toBe("lapsed");
    expect(forceOf(one, forceId).polityId).toBe(company.polityId);
  });

  it("sours faster in debased coin than in sound, while it waits", () => {
    const moraleAfterOneMiss = (share: number): number => {
      const { world, forceId } = romeHires(emptied(romeCoinedAt(share)), UNPAYABLE);
      return forceOf(tickTo(world, 30), forceId).moraleBps;
    };
    const start = romeHires(opening(), 5_000).world.material.forces.find((force) => force.commanderCharacterId === "decius-vibellius")!.moraleBps;
    const soundLoss = start - moraleAfterOneMiss(100);
    const debasedLoss = start - moraleAfterOneMiss(90);
    expect(soundLoss).toBeGreaterThan(0);
    expect(debasedLoss).toBeGreaterThan(soundLoss);
  });
});
