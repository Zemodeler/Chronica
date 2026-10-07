import { describe, expect, it } from "vitest";
import { economyOf, type WorldState } from "@chronica/shared";
import { applyDecision, atDay, definition, input, logged, opening, withChest, withIncome, withWar } from "./fiscal-test-kit";
import { decideFiscal } from "./fiscal-officers";
import { auditInWords, auditMoney, combineAudits, emptyAudit, unexplainedTotal } from "./money-audit";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "Where did the merchants' money come from, and where did the quaestors' loans go?"
 *
 * Houses buy goods out of the markets, sell them at the far end, pay their crews, their duties and their liturgies, lend to
 * treasuries, die and leave their purses to their heirs; fiscal officers raise taxes, borrow, and set the price of coin. Each of
 * those moves money, and the audit (`money-audit.ts`) must still find every line a transfer between two accounts or a passage
 * through one of its doors. Five years of the Punic world with the houses trading, a war between Carthage and Rome with an
 * empty chest at Carthage, and the officers of every power nobody plays doing as they would each month: nothing unexplained.
 */

describe("the books balance with houses and officers", { timeout: 600_000 }, () => {
  it("explains every drachma across five years of houses at their trade and officers at their books", () => {
    let world: WorldState = opening(0);
    let audit = emptyAudit();
    let acts = 0;
    let loans = 0;
    for (let month = 1; month <= 60; month += 1) {
      const toDay = month * 30;
      // A war from the sixth month between Carthage and Rome, which empties Carthage's chest and its income.
      if (month === 6) world = withIncome(withChest(withWar(world, "carthage", "rome"), "carthage", 5_000, 120_000), "carthage", 0.02);
      const before: WorldState = { ...world, elapsedStep: toDay, instant: { day: toDay, minute: 0 } };
      const ticked = runDeterministicTick({ world: before, toDay, ids: createIdFactory(`houses-tick-${month}`), warfare: definition.warfare, clock: definition.clock, life: definition.life });
      const monthly = auditMoney(before, ticked.world);
      expect(monthly.unexplained, `month ${month}:\n${auditInWords(monthly)}`).toEqual([]);
      audit = combineAudits(audit, monthly);
      world = { ...ticked.world, instant: { day: toDay, minute: 0 }, elapsedStep: toDay };
      // The officers' month: what the statecraft pass would do, applied as the burst applies it.
      for (const decision of decideFiscal(input(world))) {
        const done = applyDecision(world, decision, toDay);
        const decided = auditMoney(world, done.world);
        expect(decided.unexplained, `month ${month}, ${decision.polityId}:\n${auditInWords(decided)}`).toEqual([]);
        audit = combineAudits(audit, decided);
        if (done.applied.length > 0) {
          world = logged(done.world, decision);
          acts += 1;
          loans += done.applied.filter((act) => act.delta.op === "loan_open").length;
        }
      }
    }
    expect(unexplainedTotal(audit), auditInWords(audit)).toBe(0);
    // The houses traded and the officers acted; the war needed credit and it was found.
    const houses = economyOf(world).houses;
    expect(houses.reduce((sum, house) => sum + house.voyages, 0)).toBeGreaterThan(300);
    expect(acts).toBeGreaterThan(5);
    expect(loans).toBeGreaterThan(0);
    expect(world.material.loans.some((loan) => loan.borrowerAccountId === "carthage-treasury")).toBe(true);
    // The doors that should have been used were: the market (cargoes, customs), the unnamed (crews, households), credit.
    expect(audit.doors.market.in).toBeGreaterThan(0);
    expect(audit.doors.the_unnamed.out).toBeGreaterThan(0);
    expect(audit.internal).toBeGreaterThan(0);
    // Nothing runs away: a house's capital, over five years, stays within a few times what it began with.
    const capital = (state: WorldState): number => economyOf(state).houses.reduce((sum, house) => sum + (state.material.accounts.find((account) => account.id === state.characters.find((character) => character.id === house.headCharacterId)?.personalAccountId)?.balance ?? 0), 0);
    expect(capital(world)).toBeLessThan(capital(opening(0)) * 3);
    void atDay;
  });
});
