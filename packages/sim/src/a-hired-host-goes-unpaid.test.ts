import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, readTheBooks, ensureProvinceMaterial, mercenaryGracePeriods, mercenaryWageBps, modernWordsIn, standardOf, type FactProposalDraft, type WorldState } from "@chronica/shared";
import { auditMoney } from "./money-audit";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { withWar } from "./fiscal-test-kit";
import { readTheBooks as readFiscalBooks } from "./fiscal-officers";
import { coinIsMoved, strainOf } from "./fiscal-strain";

/**
 * "A hired host goes unpaid."
 *
 * Carthage's soldiers were hired men, and the Mercenary War began as pay in arrears after the lost war of 241: twenty thousand of them gathered at Sicca to be paid
 * and offered less than they were promised, and they rose (Polybius 1.65-68). The opening world paid Carthage's armies as standing sums and nothing more, so that no
 * company of its could ever walk out; its two hired hosts are now hired companies (`punic-wars-hired-hosts.ts`), with the rules of one (`mercenary-pay.ts`): the
 * wage follows the silver in the coin, the company waits two late periods in sound coin and fewer in lighter, it sours and its men leave while it waits,
 * and one that is the employer's own and is not paid takes the road with its arms.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const ARMY = "carthaginian-sicilian-army";
const CONTRACT = "contract-carthaginian-sicilian-army-hired";

/** Carthage after a lost war: the chest spent, the harbour dues and the African tribute stopped, and (if asked) its coin struck down to `share` in a hundred. */
function afterTheLostWar(share = 100): WorldState {
  const world = withWar(opening(), "carthage", "rome");
  return {
    ...world,
    economy: { ...world.economy!, coinages: world.economy!.coinages.map((coin) => (coin.issuerPolityId === "carthage" ? { ...coin, standardBps: standardOf(coin), silverBps: Math.round((standardOf(coin) * share) / 100) } : coin)) },
    material: {
      ...world.material,
      // The fleet is lost with its crews' chest.
      forces: world.material.forces.filter((force) => force.id !== "carthaginian-fleet"),
      accounts: world.material.accounts.filter((account) => !(account.owner.kind === "force" && account.owner.id === "carthaginian-fleet")).map((account) => (account.id === "carthage-treasury" ? { ...account, balance: 0 } : account)),
      incomeSources: world.material.incomeSources.map((source) => (source.beneficiaryAccountId === "carthage-treasury" ? { ...source, active: false } : source)),
    },
  };
}

interface Month { world: WorldState; facts: FactProposalDraft[] }
const months = (start: WorldState, count: number): Month[] => {
  const out: Month[] = [];
  let world = start;
  for (let n = 1; n <= count; n += 1) {
    const day = n * 30;
    const ticked = runDeterministicTick({ world: { ...world, elapsedStep: day, instant: { day, minute: 0 } }, toDay: day, ids: createIdFactory(`hired-${day}`), warfare: definition.warfare });
    out.push({ world: ticked.world, facts: [...ticked.factProposals] });
    world = ticked.world;
  }
  return out;
};
const contractOf = (world: WorldState) => world.material.contracts.find((contract) => contract.id === CONTRACT)!;
const armyOf = (world: WorldState) => world.material.forces.find((force) => force.id === ARMY)!;

describe("a hired host goes unpaid", () => {
  it("opens with Carthage's two hosts hired, in the treasury's pay", () => {
    const hired = opening().material.contracts.filter((contract) => contract.role === "mercenary" && contract.employerAccountId === "carthage-treasury");
    expect(hired.map((contract) => contract.forceId).sort()).toEqual(["carthaginian-garrison", ARMY]);
    expect(hired.every((contract) => contract.status === "active" && contract.obligationId !== null)).toBe(true);
  });

  it("is paid and quiet while the chest holds: no arrears, no walking out", () => {
    const run = months(withWar(opening(), "carthage", "rome"), 4);
    expect(contractOf(run.at(-1)!.world).status).toBe("active");
    expect(run.flatMap((month) => month.facts).some((fact) => fact.kind === "obligation_unpaid" || fact.kind === "mercenary_revolt")).toBe(false);
  });

  it("falls into arrears when a lost war has emptied the chest, and the men lose heart while the company waits its two periods", () => {
    const run = months(afterTheLostWar(), 3);
    const pay = (month: Month) => month.world.material.obligations.find((obligation) => obligation.id === "carthage-sicilian-hired-men")!;
    expect(pay(run[0]!).missedPeriods).toBe(1);
    expect(pay(run[0]!).arrears).toBeGreaterThan(0);
    expect(contractOf(run[0]!.world).status).toBe("active");
    expect(contractOf(run[1]!.world).status).toBe("active");
    expect(armyOf(run[1]!.world).moraleBps).toBeLessThan(armyOf(opening()).moraleBps);
    expect(run.flatMap((month) => month.facts).some((fact) => fact.kind === "obligation_unpaid")).toBe(true);
  });

  it("rises on the third missed wage: the company walks out, and takes the road as a band of nobody's, with the arrears it is owed", () => {
    const run = months(afterTheLostWar(), 4);
    const last = run.at(-1)!;
    expect(contractOf(last.world).status).toBe("lapsed");
    expect(armyOf(last.world).outlaw).toBe(true);
    expect(armyOf(last.world).payObligationId).toBeNull();
    const revolt = run.flatMap((month) => month.facts).find((fact) => fact.kind === "mercenary_revolt");
    expect(revolt).toBeDefined();
    expect(revolt!.summary).toMatch(/owed|behind/);
    expect(modernWordsIn(revolt!.summary)).toEqual([]);
    expect(run.flatMap((month) => month.facts).some((fact) => fact.kind === "contract_lapsed")).toBe(true);
  });

  it("walks out sooner, and asks more, when its pay is in lighter coin: a fifth short and it will not wait at all", () => {
    const sound = afterTheLostWar(100);
    const lighter = afterTheLostWar(78);
    const contract = contractOf(sound);
    expect(mercenaryGracePeriods(sound, contract)).toBe(2);
    expect(mercenaryGracePeriods(lighter, contract)).toBe(0);
    expect(mercenaryWageBps(lighter, contract, 0)).toBeGreaterThan(mercenaryWageBps(sound, contract, 0));
    // Paid a month late in coin a fifth short, the company is gone at the first miss.
    const run = months(lighter, 1);
    expect(contractOf(run[0]!.world).status).toBe("lapsed");
    expect(armyOf(run[0]!.world).outlaw).toBe(true);
  });

  it("keeps the books balanced through the arrears and the walking out", () => {
    const start = afterTheLostWar();
    let world = start;
    for (const month of months(start, 5)) {
      expect(auditMoney({ ...world, elapsedStep: world.elapsedStep }, month.world).unexplained).toEqual([]);
      world = month.world;
    }
  });

  it("shows in the treasurer's books: the silver the coin holds, and the pay that is behind", () => {
    const booksOf = (world: WorldState) => world.characters.filter((character) => character.polityId === "carthage" && character.alive)
      .map((character) => readTheBooks(world, character.id, definition.government.offices)).find((candidate) => candidate.coin != null);
    const lighter = booksOf(months(afterTheLostWar(78), 1)[0]!.world);
    expect(lighter).toBeDefined();
    expect(lighter!.coin!.silverBps).toBeLessThan(lighter!.coin!.standardBps);
    const waiting = booksOf(months(afterTheLostWar(), 1)[0]!.world);
    expect(waiting!.behind.some((line) => line.arrears > 0 && line.missedPeriods === 1)).toBe(true);
    expect(waiting!.arrears).toBeGreaterThan(0);
  });

  it("counts a rising of its own hired men as the war that moves the coin, even when no foreign war is on", () => {
    const run = months(afterTheLostWar(), 4);
    // The foreign war is over (peace of 241): what is left is the men on the road and the empty chest.
    const world = { ...run.at(-1)!.world, polityAgreements: [] };
    const strain = strainOf(world, readFiscalBooks(world).get("carthage")!, "carthage");
    expect(strain.atWar).toBe(false);
    expect(strain.revolt).toBe(true);
    expect(coinIsMoved(strain, true)).toBe(true);
    // And a peace with its men paid is not the case: no revolt, no strain on the coin.
    const quiet = withWar(opening(), "carthage", "rome");
    const calm = strainOf({ ...quiet, polityAgreements: [] }, readFiscalBooks(quiet).get("carthage")!, "carthage");
    expect(calm.revolt).toBe(false);
    expect(coinIsMoved(calm, false)).toBe(false);
  });
});
