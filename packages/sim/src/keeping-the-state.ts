import {
  economyOf,
  liveProvinceIds,
  stableHash,
  warsOf,
  type FactProposalDraft,
  type MerchantHouse,
  type MoneyTransaction,
  type Office,
  type PublicWorkContract,
  type StateKeeping,
  type Structure,
  type WorldState,
} from "@chronica/shared";
import { purseOfHouse } from "./merchant-houses";
import type { IdFactory } from "./ports";
import { CONTRACTOR_GAIN_BPS, MADE, planWork, whoLetsTheWorks, worksAYear } from "./public-works";
import { billOf, costsByPolity, upkeepByPolity } from "./the-upkeep-of-a-state";

/**
 * The monthly pass of a state's own spending (docs/economy.md, "Where the money goes"): the upkeep of what it holds, the costs of its government, and
 * the public works it lets. Called once a month from the tick, after the merchant houses (whose purses the contractors' money goes into).
 *
 * **What is paid and in what order.** A power keeps back a floor, three months of what it owes by obligation or one month of what it takes
 * in, whichever is the more, and pays out of what is above it: first the costs of government, then the upkeep, then what is due to the
 * contractors. Below the floor nothing of the three is paid; the army's pay and the offices' (`tick.ts`) come before all of it, from the same chest, on
 * their own days. The month's bills are held to a share of what the power takes in (`UPKEEP_CAP_SHARE`, `COSTS_CAP_SHARE`) and of what is left of it after its obligations (`UPKEEP_SLACK_SHARE`, `COSTS_SLACK_SHARE`): a people who owe their
 * land's keeping in labour and not in silver (the tribes, the allies who send men) are not asked for more silver than they have.
 *
 * **Neglect.** A month in which less than nine tenths of the upkeep was paid counts against the power; two in which it was paid in full take one
 * back. Past six months the ceiling of development of every province the power holds sinks a quarter of a point a month, to six points at the
 * most (`neglectShiftBps`, read by `provinceTargetsFrom`): a slow decay, not a collapse. A year and a half behind, a wall slips a level, once a year.
 *
 * **Works.** When the chest has cover above a reserve (eight months of what is owed, on top of the floor above), the power is at peace, it has begun
 * fewer than its year's share, and somebody who is not the player keeps its works, a contract is let (`public-works.ts`). The treasury pays the price in
 * monthly instalments to the merchant house that took the contract (an ordinary transfer, nothing made), which pays the cost out to the men who do the
 * work and keeps the gain; where no house stands in the power the whole goes to the men nobody names. When the work is done a structure
 * stands, with its lasting effects.
 *
 * No money is made here: every payment is a transfer between two accounts or a passage out through `the_unnamed`.
 */

/** The most of a month's takings the upkeep, and the costs of government, may be. */
export const UPKEEP_CAP_SHARE = 0.15;
export const COSTS_CAP_SHARE = 0.06;
/** And of what is left of the takings once its obligations are met (at least `SLACK_FLOOR_SHARE` of them). */
export const UPKEEP_SLACK_SHARE = 0.5;
export const COSTS_SLACK_SHARE = 0.25;
export const SLACK_FLOOR_SHARE = 0.2;
/** What a power keeps back, in months of what it owes, and in months of what it takes. */
export const FLOOR_OWED_MONTHS = 3;
export const FLOOR_TAKEN_MONTHS = 1;
/** The reserve a work is let above: months of what is owed by obligation, on top of the floor; a half as much again in a war. */
export const WORKS_RESERVE_OWED_MONTHS = 8;
export const WAR_RESERVE_FACTOR = 1.5;
/** How much of the cover above the reserve a single work may take. */
export const WORK_SHARE_OF_COVER = 0.5;
/** Days between one work let by a power and the next. */
export const WORKS_REST_DAYS = 75;
/** The most works a power has in hand at once. */
export const WORKS_IN_HAND = 2;
/** A month's upkeep paid in at least this share does not count against a power. */
const PAID_ENOUGH_BPS = 9_000;
/** Months of neglect before a wall slips, and the days between slips. */
const WALL_SLIPS_AFTER_MONTHS = 18;
const WALL_SLIP_REST_DAYS = 360;
const NEGLECT_NEWS_AFTER_MONTHS = 9;
const NEGLECT_NEWS_REST_DAYS = 360;
/** The days in a month and a year of the world's calendar. */
const MONTH = 30;
const YEAR = 360;

interface Books {
  readonly treasuryId: string;
  balance: number;
  readonly owed: number;
  readonly takings: number;
}

/** Every power's chest, what it owes a month and what it takes in a month, in one walk of the accounts, the obligations and the sources. */
function readTheBooks(world: WorldState): Map<string, Books> {
  const polityOf = new Map<string, string>();
  const books = new Map<string, Books>();
  const owed = new Map<string, number>();
  const takings = new Map<string, number>();
  for (const account of world.material.accounts) {
    if (account.owner.kind !== "polity" || account.status !== "active") continue;
    polityOf.set(account.id, account.owner.id);
  }
  for (const obligation of world.material.obligations) {
    if (!obligation.active || obligation.cadenceSteps <= 0) continue;
    const polityId = polityOf.get(obligation.payerAccountId);
    if (polityId !== undefined) owed.set(polityId, (owed.get(polityId) ?? 0) + (obligation.amount * MONTH) / obligation.cadenceSteps);
  }
  for (const source of world.material.incomeSources) {
    if (!source.active || source.cadenceSteps <= 0) continue;
    const polityId = polityOf.get(source.beneficiaryAccountId);
    if (polityId !== undefined) takings.set(polityId, (takings.get(polityId) ?? 0) + (source.amount * source.collectionRateBps * MONTH) / (10_000 * source.cadenceSteps));
  }
  for (const account of world.material.accounts) {
    if (account.owner.kind !== "polity" || account.status !== "active" || books.has(account.owner.id)) continue;
    books.set(account.owner.id, { treasuryId: account.id, balance: account.balance, owed: owed.get(account.owner.id) ?? 0, takings: takings.get(account.owner.id) ?? 0 });
  }
  return books;
}

export interface KeepingInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly ids: IdFactory;
  /** The scenario's offices, for the retinues and the priests' share. Absent, only the offices the world has made are counted. */
  readonly offices?: readonly Office[] | undefined;
  /** The man the player is: a power whose works he keeps himself lets none by rule. */
  readonly playerCharacterId?: string | null | undefined;
}

export function keepTheState(input: KeepingInput): { world: WorldState; facts: FactProposalDraft[] } {
  const { toDay } = input;
  const start = input.world;
  if (start.material.provinceMaterial.length === 0 || start.map.provinces.length === 0) return { world: start, facts: [] };
  const memory = economyOf(start);
  const books = readTheBooks(start);
  // Which powers are due their month: all of them, a month after they were last settled; one never settled is settled now.
  const due: { polityId: string; months: number }[] = [];
  for (const polity of start.map.polities) {
    const book = books.get(polity.id);
    if (book === undefined || book.takings <= 0) continue;
    const row = memory.keeping.find((entry) => entry.polityId === polity.id);
    const months = row === undefined ? 1 : Math.min(3, Math.floor((toDay - row.settledAtStep) / MONTH));
    if (months >= 1) due.push({ polityId: polity.id, months });
  }
  const hasWorks = memory.works.length > 0;
  if (due.length === 0 && !hasWorks) return { world: start, facts: [] };

  const facts: FactProposalDraft[] = [];
  const transactions: MoneyTransaction[] = [];
  const balances = new Map<string, number>();
  const balanceOf = (accountId: string): number => balances.get(accountId) ?? start.material.accounts.find((account) => account.id === accountId)?.balance ?? 0;
  const move = (accountId: string, change: number): void => { balances.set(accountId, balanceOf(accountId) + change); };
  const takingsMap = new Map([...books].map(([polityId, book]) => [polityId, Math.round(book.takings)]));
  const upkeep = due.length === 0 ? new Map() : upkeepByPolity(start);
  const costs = due.length === 0 ? new Map() : costsByPolity(start, input.offices ?? [], takingsMap, toDay);
  const liveHolders = (() => {
    let held: Set<string> | undefined;
    return (polityId: string): boolean => {
      if (held === undefined) {
        const live = liveProvinceIds(start);
        held = new Set(start.map.provinces.filter((province) => province.controllerPolityId !== null && live.has(province.id)).map((province) => province.controllerPolityId!));
      }
      return held.has(polityId);
    };
  })();
  const nameOf = (polityId: string): string => start.map.polities.find((polity) => polity.id === polityId)?.name ?? polityId;
  const told = (localId: string, kind: string, summary: string, polityId: string, provinceId: string | null, significance: number): void => {
    if (!liveHolders(polityId)) return;
    facts.push({
      localId: localId.slice(0, 60), kind, summary: summary.slice(0, 600),
      affectedRefs: [{ kind: "polity", id: polityId }, ...(provinceId === null ? [] : [{ kind: "province" as const, id: provinceId }])],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance,
    });
  };

  // ── 1. The month's bills ─────────────────────────────────────────────
  const rows = new Map<string, StateKeeping>(memory.keeping.map((row) => [row.polityId, row]));
  const slips: { polityId: string }[] = [];
  for (const { polityId, months } of due) {
    const book = books.get(polityId)!;
    const bill = billOf(upkeep, costs, polityId);
    const was = rows.get(polityId);
    const settledAt = was === undefined ? toDay - months * MONTH : was.settledAtStep;
    // What is left of its takings after what it owes (never counted as less than a fifth of them): the bills are held to a share of that as well,
    // so that a power whose pay takes four fifths of its takings, as an ally's does, is not driven under by the roads.
    const slack = Math.max(SLACK_FLOOR_SHARE * book.takings, book.takings - book.owed);
    const upkeepDue = bill === null ? 0 : Math.round(Math.min(bill.upkeep.total, book.takings * UPKEEP_CAP_SHARE, slack * UPKEEP_SLACK_SHARE) * months);
    const costsDue = bill === null ? 0 : Math.round(Math.min(bill.costs.total, book.takings * COSTS_CAP_SHARE, slack * COSTS_SLACK_SHARE) * months);
    const floor = Math.max(FLOOR_OWED_MONTHS * book.owed, FLOOR_TAKEN_MONTHS * book.takings);
    let spendable = Math.max(0, balanceOf(book.treasuryId) - floor);
    const paidCosts = Math.min(costsDue, spendable);
    spendable -= paidCosts;
    const paidUpkeep = Math.min(upkeepDue, spendable);
    const line = (amount: number, explanation: string): void => {
      if (amount <= 0) return;
      move(book.treasuryId, -amount);
      transactions.push({
        id: input.ids.next("txn"), atStep: toDay, kind: "upkeep", amount, sourceAccountId: book.treasuryId, external: "the_unnamed",
        cause: { kind: "obligation", id: `keeping_${polityId}`, explanation: explanation.slice(0, 240) }, visibility: "polity",
      });
    };
    line(paidCosts, `The costs of government of ${nameOf(polityId)}: the apparitores and clerks, the public slaves, the house of the council, the games and rites, the lodging of envoys`);
    line(paidUpkeep, `The upkeep of the roads, walls, harbours, granaries and public buildings of ${nameOf(polityId)}`);
    const paidBps = upkeepDue <= 0 ? 10_000 : Math.round((paidUpkeep * 10_000) / upkeepDue);
    const behind = upkeepDue <= 0 ? Math.max(0, (was?.behindMonths ?? 0) - 2 * months)
      : paidBps < PAID_ENOUGH_BPS ? Math.min(240, (was?.behindMonths ?? 0) + months)
      : Math.max(0, (was?.behindMonths ?? 0) - 2 * months);
    const year = Math.floor(toDay / YEAR);
    let row: StateKeeping = {
      polityId, settledAtStep: settledAt + months * MONTH, behindMonths: behind,
      upkeepDue: Math.round(upkeepDue / months), costsDue: Math.round(costsDue / months), upkeepPaidBps: paidBps,
      worksYear: year, worksBegun: was?.worksYear === year ? was.worksBegun : 0,
      lastWorkStep: was?.lastWorkStep ?? null, toldNeglectAtStep: was?.toldNeglectAtStep ?? null, slippedAtStep: was?.slippedAtStep ?? null,
    };
    // The news of a neglected state: once a year, and only for a power with something live in it.
    if (behind >= NEGLECT_NEWS_AFTER_MONTHS && (row.toldNeglectAtStep === null || toDay - row.toldNeglectAtStep >= NEGLECT_NEWS_REST_DAYS)) {
      row = { ...row, toldNeglectAtStep: toDay };
      told(`neglect_${polityId}_${Math.floor(toDay / MONTH)}`, "state_neglect",
        `The roads, harbours and walls of ${nameOf(polityId)} are falling into disrepair: for ${behind} months its chest could not keep them up.`, polityId, null, 38);
    }
    if (behind >= WALL_SLIPS_AFTER_MONTHS && (row.slippedAtStep === null || toDay - row.slippedAtStep >= WALL_SLIP_REST_DAYS)) {
      row = { ...row, slippedAtStep: toDay };
      slips.push({ polityId });
    }
    rows.set(polityId, row);
  }

  // ── 2. The works in hand: instalments, and what has been finished ─────────────────
  let contracts: PublicWorkContract[] = [...memory.works];
  const houses = memory.houses;
  const purseBalance = (house: MerchantHouse): { id: string; balance: number } | null => {
    const purse = purseOfHouse(start, house);
    return purse === null || !purse.active ? null : { id: purse.id, balance: balanceOf(purse.id) };
  };
  const newStructures: Structure[] = [];
  const wallsRaised: { provinceId: string }[] = [];
  const settled: PublicWorkContract[] = [];
  for (const contract of contracts) {
    const book = books.get(contract.polityId);
    const house = contract.houseId === null ? undefined : houses.find((candidate) => candidate.id === contract.houseId);
    if (book === undefined) continue;
    // What the price should have come to by now: an instalment on the day it is let and one every month after, the last on the month it stands.
    const k = contract.built ? contract.instalments : Math.min(contract.instalments, Math.floor((toDay - contract.letAtStep) / MONTH) + 1);
    const shouldHavePaid = k >= contract.instalments ? contract.price : Math.round((contract.price * k) / contract.instalments);
    const shouldHaveSpent = k >= contract.instalments ? contract.cost : Math.round((contract.cost * k) / contract.instalments);
    const floor = Math.max(FLOOR_OWED_MONTHS * book.owed, FLOOR_TAKEN_MONTHS * book.takings) / 2;
    let toPay = Math.min(shouldHavePaid - contract.paid, Math.max(0, balanceOf(book.treasuryId) - floor));
    let next = contract;
    if (toPay > 0) {
      if (house !== undefined) {
        const purse = purseBalance(house);
        if (purse === null) {
          // The house is gone or its purse closed: the rest goes to the men nobody names.
          next = { ...next, houseId: null, price: Math.max(next.paid, next.cost) };
        } else {
          move(book.treasuryId, -toPay);
          move(purse.id, toPay);
          transactions.push({
            id: input.ids.next("txn"), atStep: toDay, kind: "purchase", amount: toPay, sourceAccountId: book.treasuryId, destinationAccountId: purse.id,
            cause: { kind: "action", id: contract.projectId, explanation: `Paid ${house.name} on the contract for ${contract.name}`.slice(0, 240) }, visibility: "polity",
          });
          next = { ...next, paid: next.paid + toPay };
          toPay = 0;
        }
      }
      if (next.houseId === null && toPay > 0) {
        // No house to take it: the masons, carters and quarrymen nobody names.
        const amount = Math.min(toPay, next.cost - next.spent);
        if (amount > 0) {
          move(book.treasuryId, -amount);
          transactions.push({
            id: input.ids.next("txn"), atStep: toDay, kind: "upkeep", amount, sourceAccountId: book.treasuryId, external: "the_unnamed",
            cause: { kind: "action", id: contract.projectId, explanation: `Paid the masons and carters for ${contract.name}`.slice(0, 240) }, visibility: "polity",
          });
          next = { ...next, paid: next.paid + amount, spent: next.spent + amount };
        }
      }
    }
    // The contractor pays out the cost to the men who do the work, as far as his purse goes.
    const stillHouse = next.houseId === null ? undefined : houses.find((candidate) => candidate.id === next.houseId);
    if (stillHouse !== undefined) {
      const purse = purseBalance(stillHouse);
      const toSpend = Math.min(shouldHaveSpent - next.spent, purse === null ? 0 : purse.balance);
      if (purse !== null && toSpend > 0) {
        move(purse.id, -toSpend);
        transactions.push({
          id: input.ids.next("txn"), atStep: toDay, kind: "upkeep", amount: toSpend, sourceAccountId: purse.id, external: "the_unnamed",
          cause: { kind: "action", id: contract.projectId, explanation: `${stillHouse.name} pays the masons, carters and quarrymen for ${contract.name}`.slice(0, 240) }, visibility: "private",
        });
        next = { ...next, spent: next.spent + toSpend };
      }
    }
    // It stands: the day it was due, and the structure with its lasting effects.
    if (!next.built && toDay >= next.completesAtStep) {
      const province = start.map.provinces.find((candidate) => candidate.id === next.provinceId);
      const plan = MADE[next.kind];
      if (province !== undefined && province.controllerPolityId === next.polityId) {
        newStructures.push({
          id: input.ids.next("structure"), kind: plan.structureKind, name: next.name.slice(0, 120), provinceId: province.id, settlementId: null, ownerPolityId: next.polityId,
          garrisonCapacity: 0, defensiveEffectsBps: next.kind === "walls" ? 500 : 0, supplyRadius: 0, builtAtStep: toDay,
          provenanceProjectId: next.projectId, effects: [...plan.effects], upkeep: null,
        });
        if (next.kind === "walls") wallsRaised.push({ provinceId: province.id });
        told(`works_done_${next.projectId}`, "public_works_finished", `${next.name} stands: ${nameOf(next.polityId)} has finished it.`, next.polityId, province.id, 34);
      }
      next = { ...next, built: true };
    }
    // A contract a year past its day with something still owing (a house wound up, a purse closed) is forgiven, not carried for ever.
    if (next.built && next.paid >= next.price && (next.spent >= next.cost || next.houseId === null)) settled.push(next);
    else if (toDay - next.completesAtStep > YEAR) settled.push(next);
    contracts = contracts.map((candidate) => (candidate.projectId === next.projectId ? next : candidate));
  }
  contracts = contracts.filter((candidate) => !settled.some((done) => done.projectId === candidate.projectId));

  // ── 3. New works ─────────────────────────────────────────────────────
  const year = Math.floor(toDay / YEAR);
  for (const { polityId } of due) {
    const book = books.get(polityId)!;
    const row = rows.get(polityId)!;
    const begun = row.worksYear === year ? row.worksBegun : 0;
    const annual = book.takings * 12;
    // At war a power builds less, and from a deeper chest: the Republic went on building in the Punic wars, but only what it could spare.
    const atWar = warsOf(start.polityAgreements, polityId).length > 0;
    if (begun >= (atWar ? Math.max(1, Math.floor(worksAYear(annual) / 2)) : worksAYear(annual))) continue;
    if (row.lastWorkStep !== null && toDay - row.lastWorkStep < WORKS_REST_DAYS) continue;
    if (contracts.filter((candidate) => candidate.polityId === polityId).length >= WORKS_IN_HAND) continue;
    const letter = whoLetsTheWorks(start, polityId, input.playerCharacterId ?? null);
    if (letter === null) continue;
    const reserve = (WORKS_RESERVE_OWED_MONTHS * book.owed + Math.max(FLOOR_OWED_MONTHS * book.owed, FLOOR_TAKEN_MONTHS * book.takings)) * (atWar ? WAR_RESERVE_FACTOR : 1);
    const cover = balanceOf(book.treasuryId) - reserve;
    if (cover <= 0) continue;
    const plan = planWork(start, polityId, annual, memory.works.length + contracts.length + begun, contracts);
    if (plan === null) continue;
    const house = chooseHouse(start, polityId, `${plan.name}:${toDay}`);
    const price = house === null ? plan.cost : Math.round((plan.cost * (10_000 + CONTRACTOR_GAIN_BPS)) / 10_000);
    if (price > cover * WORK_SHARE_OF_COVER) continue;
    const id = `works:${plan.kind}:${input.ids.next("works")}`;
    const contract: PublicWorkContract = {
      projectId: id, polityId, name: plan.name.slice(0, 160), kind: plan.kind, provinceId: plan.province.id, houseId: house === null ? null : house.id,
      price, cost: plan.cost, instalments: plan.months, letAtStep: toDay, completesAtStep: toDay + plan.months * MONTH, paid: 0, spent: 0, built: false,
    };
    contracts.push(contract);
    rows.set(polityId, { ...row, worksYear: year, worksBegun: begun + 1, lastWorkStep: toDay });
    told(`works_let_${id}`, "public_works_let",
      `${letter.words} let the contract for ${plan.name.charAt(0).toLowerCase()}${plan.name.slice(1)}${house === null ? "" : `, and ${house.name} took it`}: ${plan.months} months' work, ${plan.cost} drachmae.`,
      polityId, plan.province.id, 32);
    // The first instalment goes out the day it is let.
    const first = contractsPay(contract, book, balanceOf, move, transactions, input.ids, toDay, house, start);
    contracts = contracts.map((candidate) => (candidate.projectId === id ? first : candidate));
  }

  // ── 4. What it all did to the world ──────────────────────────────────
  let world: WorldState = start;
  if (balances.size > 0) world = { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (balances.has(account.id) ? { ...account, balance: balances.get(account.id)! } : account)) } };
  if (transactions.length > 0) world = { ...world, material: { ...world.material, transactions: [...world.material.transactions, ...transactions] } };
  if (newStructures.length > 0) world = { ...world, structures: [...world.structures, ...newStructures] };
  const keeping = [...rows.values()].sort((a, b) => a.polityId.localeCompare(b.polityId));
  world = { ...world, economy: { ...economyOf(world), keeping, works: contracts } };
  if (wallsRaised.length > 0 || slips.length > 0) world = fortify(world, wallsRaised.map((entry) => entry.provinceId), slips.map((entry) => entry.polityId), (polityId, provinceId) => {
    told(`walls_slip_${polityId}_${Math.floor(toDay / MONTH)}`, "walls_slip", `A stretch of the walls of ${start.map.provinces.find((province) => province.id === provinceId)?.name ?? provinceId} has been let go: ${nameOf(polityId)} could not pay to keep it.`, polityId, provinceId, 36);
  });
  return { world, facts };
}

function chooseHouse(world: WorldState, polityId: string, salt: string): MerchantHouse | null {
  const houses = economyOf(world).houses
    .filter((house) => house.status === "trading" && (house.seatPolityId ?? house.polityId) === polityId && purseOfHouse(world, house)?.active === true)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (houses.length === 0) return null;
  return houses[stableHash([polityId, salt]) % houses.length] ?? null;
}

/** The first instalment of a new contract, paid the day it is let. */
function contractsPay(
  contract: PublicWorkContract,
  book: Books,
  balanceOf: (id: string) => number,
  move: (id: string, change: number) => void,
  transactions: MoneyTransaction[],
  ids: IdFactory,
  toDay: number,
  house: MerchantHouse | null,
  world: WorldState,
): PublicWorkContract {
  const instalment = Math.round(contract.price / contract.instalments);
  const amount = Math.min(instalment, Math.max(0, balanceOf(book.treasuryId)));
  if (amount <= 0) return contract;
  if (house !== null) {
    const purse = purseOfHouse(world, house);
    if (purse === null) return contract;
    move(book.treasuryId, -amount);
    move(purse.id, amount);
    transactions.push({
      id: ids.next("txn"), atStep: toDay, kind: "purchase", amount, sourceAccountId: book.treasuryId, destinationAccountId: purse.id,
      cause: { kind: "action", id: contract.projectId, explanation: `Paid ${house.name} on the contract for ${contract.name}`.slice(0, 240) }, visibility: "polity",
    });
    return { ...contract, paid: contract.paid + amount };
  }
  move(book.treasuryId, -amount);
  transactions.push({
    id: ids.next("txn"), atStep: toDay, kind: "upkeep", amount, sourceAccountId: book.treasuryId, external: "the_unnamed",
    cause: { kind: "action", id: contract.projectId, explanation: `Paid the masons and carters for ${contract.name}`.slice(0, 240) }, visibility: "polity",
  });
  return { ...contract, paid: contract.paid + amount, spent: contract.spent + amount };
}

/** Walls raised add a level to the best-fortified-short settlement of the place; neglected powers lose one level in one place. */
function fortify(world: WorldState, raised: readonly string[], slipped: readonly string[], noteSlip: (polityId: string, provinceId: string) => void): WorldState {
  const raise = new Set(raised);
  const slip = new Set(slipped);
  let slippedIn = new Map<string, string>();
  const provinces = world.map.provinces.map((province) => {
    if (raise.has(province.id)) {
      const target = [...province.settlements].filter((settlement) => (settlement.kind === "city" || settlement.kind === "port" || settlement.kind === "fortress") && settlement.fortificationLevel < 10)
        .sort((a, b) => a.fortificationLevel - b.fortificationLevel || b.size - a.size || a.id.localeCompare(b.id))[0];
      if (target === undefined) return province;
      return { ...province, settlements: province.settlements.map((settlement) => (settlement.id === target.id ? { ...settlement, fortificationLevel: settlement.fortificationLevel + 1 } : settlement)) };
    }
    return province;
  });
  if (slip.size === 0) return { ...world, map: { ...world.map, provinces } };
  // The most fortified place of each neglectful power loses a level; ties by id.
  const best = new Map<string, { provinceId: string; settlementId: string; level: number }>();
  for (const province of provinces) {
    const holder = province.controllerPolityId;
    if (holder === null || !slip.has(holder)) continue;
    for (const settlement of province.settlements) {
      const known = best.get(holder);
      if (settlement.fortificationLevel > 0 && (known === undefined || settlement.fortificationLevel > known.level || (settlement.fortificationLevel === known.level && settlement.id < known.settlementId))) {
        best.set(holder, { provinceId: province.id, settlementId: settlement.id, level: settlement.fortificationLevel });
      }
    }
  }
  slippedIn = new Map([...best].map(([polityId, entry]) => [entry.settlementId, polityId]));
  if (slippedIn.size === 0) return { ...world, map: { ...world.map, provinces } };
  const lowered = provinces.map((province) => {
    if (!province.settlements.some((settlement) => slippedIn.has(settlement.id))) return province;
    return { ...province, settlements: province.settlements.map((settlement) => {
      const polityId = slippedIn.get(settlement.id);
      if (polityId === undefined) return settlement;
      noteSlip(polityId, province.id);
      return { ...settlement, fortificationLevel: settlement.fortificationLevel - 1 };
    }) };
  });
  return { ...world, map: { ...world.map, provinces: lowered } };
}
