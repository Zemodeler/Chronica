import type { MoneyTransaction, ProvinceMaterial } from "../material-state";
import type { WorldState } from "../world/world-state";
import { applyWarDamage, deriveDefaultProvinceMaterial, findProvinceMaterial } from "./province-material";

/**
 * What an army takes, and what taking it costs the place.
 *
 * `capturableValues` and the `"spoils"` transaction kind were both specified
 * with the economy and produced by nothing: winning a battle yielded no money,
 * taking a city yielded no money, and "the spoils of war will be the payment
 * to the soldiers" was an order the engine could narrate and not obey. This is
 * the source those two declarations were waiting for.
 *
 * Nothing here is authored. A province's plunder is derived from the size of
 * the settlements in it, scaled by how productive the place still is and how
 * much of it has already been burnt -- so no scenario has to write a number
 * for 779 provinces, and a province worth sacking is one that was worth
 * something first. The `capturableValues` row is written only once somebody
 * has actually plundered the place, and `remainingValue` is what they left:
 * a city sacked twice yields less the second time, which is the behaviour the
 * field's name has always implied.
 *
 * Taking it is not free for the taker either, at least not in the long run.
 * A sack runs `applyWarDamage` over the province -- population, food, order
 * and productive capacity -- so an army that lives off plunder is eating the
 * ground it will have to hold, and the same province yields less to the next
 * man who takes it. That function has existed and been unit-tested since
 * phase 2 with no caller anywhere in the engine; this is its first one.
 */

/** Coin a settlement of one size unit is worth to whoever sacks it. */
const SPOILS_PER_SETTLEMENT_SIZE = 45;

/** A sack takes this share of what is left, never the last of it. */
const SACK_SHARE = 0.5;

/** How hard a full sack is on the province, in basis points of severity. */
const SACK_SEVERITY_BPS = 4_000;

export interface Seizure {
  readonly world: WorldState;
  /** What actually changed hands. Zero when there was nothing to take, or nowhere to put it. */
  readonly taken: number;
  /** Where it went, for the fact that reports it. */
  readonly intoAccountId: string | null;
}

const noSeizure = (world: WorldState): Seizure => ({ world, taken: 0, intoAccountId: null });

/** Everything a province would be worth to a sacker who found it untouched. */
export function untouchedWorthOf(world: WorldState, provinceId: string): number {
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  if (province === undefined) return 0;
  const material: ProvinceMaterial = findProvinceMaterial(world, provinceId)
    ?? deriveDefaultProvinceMaterial(province, world.elapsedStep);
  const gross = province.settlements.reduce((total, settlement) => total + settlement.size * SPOILS_PER_SETTLEMENT_SIZE, 0);
  const productive = material.productiveCapacityBps / 10_000;
  const spared = Math.max(0, 1 - material.warDamageBps / 10_000);
  return Math.max(0, Math.floor(gross * productive * spared));
}

/** What is left in a province for the next army through it. */
export function worthOf(world: WorldState, provinceId: string): number {
  const stripped = world.material.capturableValues.find(
    (value) => value.sourceKind === "province" && value.sourceId === provinceId,
  );
  return stripped === undefined ? untouchedWorthOf(world, provinceId) : stripped.remainingValue;
}

/** The chest an army carries, if it has been given one. */
export function chestOf(world: WorldState, forceId: string): string | null {
  return world.material.accounts.find(
    (account) => account.owner.kind === "force" && account.owner.id === forceId && account.status === "active",
  )?.id ?? null;
}

/** The chest of the power itself, if it keeps one. */
export function treasuryOf(world: WorldState, polityId: string): string | null {
  return world.material.accounts.find(
    (account) => account.owner.kind === "polity" && account.owner.id === polityId && account.status === "active",
  )?.id ?? null;
}

function credit(world: WorldState, accountId: string, amount: number, transaction: MoneyTransaction): WorldState {
  return {
    ...world,
    material: {
      ...world.material,
      accounts: world.material.accounts.map((account) =>
        account.id === accountId ? { ...account, balance: account.balance + amount } : account),
      transactions: [...world.material.transactions, transaction].slice(-512),
    },
  };
}

export interface SackInput {
  readonly provinceId: string;
  readonly takerPolityId: string;
  /**
   * The army that took it. Its own chest is where the plunder goes when it has
   * one, which is what makes "they will be paid out of what they take" a
   * different arrangement from "the treasury pays them" rather than the same
   * one under another name.
   */
  readonly takingForceId: string | null;
  readonly atStep: number;
  readonly cause: { readonly kind: "battle_result" | "action"; readonly id: string; readonly explanation: string };
  /** Deterministic, so a replay produces the same ledger. */
  readonly transactionId: string;
  /**
   * How much of the province this took, in basis points. A city stormed is
   * its own share of the province's worth and not the whole of it, so taking
   * Messana does not strip the fields of north-eastern Sicily as well.
   * Omitted, the whole province.
   */
  readonly shareBps?: number;
  /**
   * Where the plunder is sent, when somebody said. "Send the loot back to
   * Rome" is the treasury, not the raiders' own chest. Omitted, the army's
   * chest if it keeps one, else its power's treasury.
   */
  readonly intoAccountId?: string;
}

/** An army takes what a province still has, and leaves it the worse for it. */
export function sackTheProvince(world: WorldState, input: SackInput): Seizure {
  const province = world.map.provinces.find((candidate) => candidate.id === input.provinceId);
  if (province === undefined) return noSeizure(world);

  const destination = input.intoAccountId
    ?? (input.takingForceId === null ? null : chestOf(world, input.takingForceId))
    ?? treasuryOf(world, input.takerPolityId);
  // Nowhere to put it is not the same as nothing to take: a power with no
  // chest anywhere cannot bank plunder, and pretending otherwise would mint
  // money into an account that does not exist.
  if (destination === null) return noSeizure(world);

  const remaining = worthOf(world, input.provinceId);
  const share = Math.max(0, Math.min(10_000, input.shareBps ?? 10_000)) / 10_000;
  const taken = Math.floor(remaining * SACK_SHARE * share);
  if (taken <= 0) return noSeizure(world);

  const withMoney = credit(world, destination, taken, {
    id: input.transactionId,
    atStep: input.atStep,
    kind: "spoils",
    amount: taken,
    destinationAccountId: destination,
    cause: input.cause,
    // A sacked city is not a secret from anybody, least of all from the people
    // it happened to.
    visibility: "public",
  });

  const left = remaining - taken;
  const rowId = `capture:province:${input.provinceId}`;
  const existing = withMoney.material.capturableValues.some((value) => value.id === rowId);
  const capturableValues = existing
    ? withMoney.material.capturableValues.map((value) => (value.id === rowId ? { ...value, remainingValue: left } : value))
    : [
      ...withMoney.material.capturableValues,
      {
        id: rowId,
        sourceKind: "province" as const,
        sourceId: input.provinceId,
        remainingValue: left,
        currencyId: withMoney.material.currency.id,
      },
    ];

  // And what it did to the place. Proportional to how much of what was left
  // they actually carried off, so a token levy is not a sack.
  const severity = Math.round(SACK_SEVERITY_BPS * (remaining <= 0 ? 0 : taken / remaining));

  const material = findProvinceMaterial(withMoney, input.provinceId)
    ?? deriveDefaultProvinceMaterial(province, input.atStep);
  const damaged = applyWarDamage(material, { severityBps: severity }, input.atStep);
  const provinceMaterial = withMoney.material.provinceMaterial.some((row) => row.provinceId === input.provinceId)
    ? withMoney.material.provinceMaterial.map((row) => (row.provinceId === input.provinceId ? damaged : row))
    : [...withMoney.material.provinceMaterial, damaged];

  return {
    world: { ...withMoney, material: { ...withMoney.material, capturableValues, provinceMaterial } },
    taken,
    intoAccountId: destination,
  };
}

/**
 * A settlement's share of its own province's worth, in basis points.
 *
 * Derived from size, the same figure the province's worth is derived from, so
 * storming every city in a province takes exactly what storming the province
 * would have taken and no more.
 */
export function settlementShareBps(world: WorldState, settlementId: string): number {
  const province = world.map.provinces.find((candidate) =>
    candidate.settlements.some((settlement) => settlement.id === settlementId));
  if (province === undefined) return 0;
  const total = province.settlements.reduce((sum, settlement) => sum + settlement.size, 0);
  if (total <= 0) return 0;
  const size = province.settlements.find((settlement) => settlement.id === settlementId)?.size ?? 0;
  return Math.round((size / total) * 10_000);
}

export interface ChestCaptureInput {
  readonly beatenForceId: string;
  readonly victorForceId: string | null;
  readonly victorPolityId: string;
  readonly atStep: number;
  readonly cause: { readonly kind: "battle_result" | "action"; readonly id: string; readonly explanation: string };
  readonly transactionId: string;
}

/**
 * The beaten army's pay chest, which is `sourceKind: "force_pay_chest"` and the
 * reason that value was in the enum.
 *
 * This is the risk that makes paying an army from plunder a decision rather
 * than free money: the wages of a force that lives off what it takes travel
 * with it, and a force that loses a battle loses them.
 */
export function takeTheChest(world: WorldState, input: ChestCaptureInput): Seizure {
  const lostChestId = chestOf(world, input.beatenForceId);
  if (lostChestId === null) return noSeizure(world);
  const lost = world.material.accounts.find((account) => account.id === lostChestId)!;
  if (lost.balance <= 0) return noSeizure(world);

  const destination = (input.victorForceId === null ? null : chestOf(world, input.victorForceId))
    ?? treasuryOf(world, input.victorPolityId);
  if (destination === null || destination === lostChestId) return noSeizure(world);

  const taken = lost.balance;
  const moved: WorldState = {
    ...world,
    material: {
      ...world.material,
      accounts: world.material.accounts.map((account) => {
        if (account.id === lostChestId) return { ...account, balance: 0 };
        if (account.id === destination) return { ...account, balance: account.balance + taken };
        return account;
      }),
      transactions: [...world.material.transactions, {
        id: input.transactionId,
        atStep: input.atStep,
        kind: "spoils" as const,
        amount: taken,
        sourceAccountId: lostChestId,
        destinationAccountId: destination,
        cause: input.cause,
        visibility: "public" as const,
      }].slice(-512),
    },
  };
  return { world: moved, taken, intoAccountId: destination };
}
