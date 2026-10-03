import {
  deriveDefaultProvinceMaterial,
  shiftStanding,
  TAX_EXTRACTION_BPS,
  type FactProposalDraft,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import type { ApplyContext } from "./context";

/**
 * Games, feasts, doles and buildings given to the people (`public_benefaction`,
 * L7 of the 2026-10-02 play-test).
 *
 * "Spend 200 of my own drachmae on a feast and games" had no act: it was
 * written as a money transfer to nobody, or an arrangement, and moved nobody's
 * standing -- and the aedile, whose year in office was the games, could not
 * hold them at all without a vote of the Senate. Now it costs what is spent,
 * and buys what it bought in Rome: a name, and a quieter city.
 *
 *  - **Standing** grows with the logarithm of what is spent against what the
 *    city is worth in a month (its capital province's bearable tax), so a
 *    feast for the neighbourhood is noticed and a fortune is not linear;
 *    never past the ceiling games have (`standing-causes.ts`).
 *  - **An aedile** gets half as much again: the games were his office.
 *  - **The second gift in a year** is worth less than the first, the third
 *    less again: the people take a habit for granted.
 *  - **An aedile's allowance**: out of his power's treasury he may spend on
 *    games, without the Senate, up to `AEDILE_ALLOWANCE_MONTHS` of that month's
 *    worth in his term. Past it, what is left is all that is spent.
 */

/** The most standing one gift can buy, and the scale it is bought on. */
const BENEFACTION_STANDING_BPS = 800;
/** What an aedile's games are worth over another man's. */
const AEDILE_FACTOR = 1.5;
/** How long a gift is remembered against the next one. */
const REPEAT_WINDOW_DAYS = 365;
/** An aedile's allowance for games out of the treasury, in months of the capital's bearable tax, per term. */
export const AEDILE_ALLOWANCE_MONTHS = 2;
/** However small the city, a gift is weighed against at least this. */
const MIN_SCALE = 50;
/** The most a gift can calm the city it is given in, in basis points of stability. */
const MAX_CALM_BPS = 400;

/**
 * Whether a seat is an aedileship. By the office's own name, because no
 * scenario field says which office keeps the games, and a constant reaches
 * the saves already being played.
 */
const isAedileship = (officeId: string): boolean => /aedile/i.test(officeId);

/** The province a power is governed from. */
function capitalProvince(world: WorldState, polityId: string | null): string | null {
  if (polityId === null) return null;
  const polity = world.map.polities.find((candidate) => candidate.id === polityId);
  const capital = polity?.capitalSettlementId == null ? undefined : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId));
  return capital?.id ?? world.map.provinces.find((province) => province.controllerPolityId === polityId)?.id ?? null;
}

/** What a gift is weighed against: a month of what the giver's capital province can bear in tax. */
export function benefactionScale(world: WorldState, polityId: string | null): number {
  const provinceId = capitalProvince(world, polityId);
  const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
  // Read as the tax collectors read it: a province no row was written for yet is what it would derive to.
  const material = world.material.provinceMaterial.find((row) => row.provinceId === provinceId) ?? (province === undefined ? undefined : deriveDefaultProvinceMaterial(province, world.elapsedStep));
  const month = material === undefined ? 0 : (material.taxCapacity * material.stabilityBps / 10_000) * (TAX_EXTRACTION_BPS / 10_000);
  return Math.max(MIN_SCALE, Math.round(month));
}

/** The aedileship a man sits in, if he sits in one. */
function aedileSeatOf(world: WorldState, characterId: string) {
  return world.material.officeSeats.find((seat) => seat.holderCharacterId === characterId && seat.status === "held" && isAedileship(seat.officeId));
}

/** What an aedile has left of his term's allowance for games; null for a man who is no aedile. */
export function gamesAllowanceLeft(world: WorldState, characterId: string): number | null {
  const seat = aedileSeatOf(world, characterId);
  const giver = world.characters.find((character) => character.id === characterId);
  if (seat === undefined || giver === undefined) return null;
  const since = seat.termStartedAtStep ?? 0;
  const spent = (giver.benefactions ?? []).filter((gift) => gift.fromTreasury && gift.atStep >= since).reduce((sum, gift) => sum + gift.amount, 0);
  return Math.max(0, AEDILE_ALLOWANCE_MONTHS * benefactionScale(world, giver.polityId) - spent);
}

/** Whose gift it is: the owner of the purse that pays, or, out of a treasury, whoever acts. */
function giverOf(world: WorldState, payerAccountId: string, actorId: string | null): string | null {
  const payer = world.material.accounts.find((account) => account.id === payerAccountId);
  if (payer?.owner.kind === "character") return payer.owner.id;
  return actorId;
}

/** The payer a benefaction names, or the actor's own purse. */
export function benefactionPayer(world: WorldState, delta: Extract<WorldDelta, { op: "public_benefaction" }>, actorId: string | null, resolve: (ref: string) => string | undefined): string | null {
  if (delta.payerAccountRef !== null) return resolve(delta.payerAccountRef) ?? delta.payerAccountRef;
  return world.characters.find((character) => character.id === actorId)?.personalAccountId ?? null;
}

/**
 * Whether it needs nobody's leave: his own money, or an aedile's games out of
 * his treasury while his allowance lasts (`own-business.ts`).
 */
export function isOwnBenefaction(delta: WorldDelta, world: WorldState, actorId: string, resolve: (ref: string) => string | undefined): boolean {
  if (delta.op !== "public_benefaction") return false;
  const payerId = benefactionPayer(world, delta, actorId, resolve);
  const payer = world.material.accounts.find((account) => account.id === payerId);
  if (payer === undefined) return false;
  if (payer.owner.kind === "character") return payer.owner.id === actorId;
  const actor = world.characters.find((character) => character.id === actorId);
  return delta.kind === "games" && payer.owner.kind === "polity" && payer.owner.id === actor?.polityId && (gamesAllowanceLeft(world, actorId) ?? 0) > 0;
}

export type BenefactionOutcome =
  | { readonly world: WorldState; readonly fact: FactProposalDraft }
  | { readonly refusal: string; readonly kind: "world" | "reference" };

/** A gift given, or why it could not be. */
export function giveToThePeople(
  world: WorldState,
  delta: Extract<WorldDelta, { op: "public_benefaction" }>,
  context: Pick<ApplyContext, "actorRef" | "ids">,
  resolve: (ref: string) => string | undefined,
): BenefactionOutcome {
  const actorId = context.actorRef.kind === "character" ? context.actorRef.id : null;
  const payerId = benefactionPayer(world, delta, actorId, resolve);
  const payer = payerId === null ? undefined : world.material.accounts.find((account) => account.id === payerId);
  if (payerId === null || payer === undefined) return { refusal: `No account "${payerId ?? "(none)"}" exists to pay for it.`, kind: "reference" };
  const giverId = giverOf(world, payerId, actorId);
  const giver = giverId === null ? undefined : world.characters.find((character) => character.id === giverId);
  if (giver === undefined) return { refusal: "A gift to the people is given in somebody's name; nobody's was named.", kind: "reference" };
  if (!giver.alive) return { refusal: `${giver.name} is dead.`, kind: "world" };
  const atStep = world.elapsedStep;
  const fromTreasury = payer.owner.kind === "polity";
  // An aedile's games out of the treasury are held on what is left of his allowance.
  const allowance = fromTreasury && delta.kind === "games" && payer.owner.id === giver.polityId ? gamesAllowanceLeft(world, giver.id) : null;
  if (allowance !== null && allowance <= 0) return { refusal: `${giver.name}'s allowance for games this term is spent; more out of the treasury wants the Senate's vote.`, kind: "world" };
  const spent = Math.min(delta.amount, Math.max(0, payer.balance), allowance ?? Number.POSITIVE_INFINITY);
  if (spent <= 0) return { refusal: `The purse that was to pay for it is empty.`, kind: "world" };

  const scale = benefactionScale(world, giver.polityId);
  const aedile = aedileSeatOf(world, giver.id) !== undefined;
  const repeats = (giver.benefactions ?? []).filter((gift) => atStep - gift.atStep < REPEAT_WINDOW_DAYS).length;
  const raw = BENEFACTION_STANDING_BPS * Math.log2(1 + spent / scale) * (aedile ? AEDILE_FACTOR : 1) / (1 + repeats);
  const gain = Math.min(BENEFACTION_STANDING_BPS, Math.round(raw));
  const named = delta.provinceId !== null && world.map.provinces.some((province) => province.id === delta.provinceId) ? delta.provinceId : null;
  const provinceId = named ?? giver.locationProvinceId ?? capitalProvince(world, giver.polityId);
  const calm = Math.min(MAX_CALM_BPS, Math.round(gain / 2));

  let next: WorldState = {
    ...world,
    characters: world.characters.map((character) => (character.id === giver.id
      ? { ...character, benefactions: [...(character.benefactions ?? []), { atStep, kind: delta.kind, amount: spent, fromTreasury }].slice(-12) }
      : character)),
    material: {
      ...world.material,
      accounts: world.material.accounts.map((account) => (account.id === payerId ? { ...account, balance: account.balance - spent } : account)),
      transactions: [...world.material.transactions, {
        id: context.ids.next("txn"), atStep, kind: "purchase" as const, amount: spent, sourceAccountId: payerId,
        cause: { kind: "action" as const, id: giver.id, explanation: `${delta.kind === "building" ? "A building" : delta.kind === "dole" ? "A dole" : delta.kind === "feast" ? "A feast" : "Games"} for the people: ${delta.reason}`.slice(0, 240) },
        visibility: "public" as const,
      }],
      provinceMaterial: world.material.provinceMaterial.map((row) => (row.provinceId === provinceId && calm > 0 ? { ...row, stabilityBps: Math.min(10_000, row.stabilityBps + calm) } : row)),
    },
  };
  next = shiftStanding(next, giver.id, gain, "games");
  const place = world.map.provinces.find((province) => province.id === provinceId)?.name ?? "the city";
  const what = delta.kind === "games" ? "games" : delta.kind === "feast" ? "a feast" : delta.kind === "dole" ? "a dole" : "a building";
  return {
    world: next,
    fact: {
      localId: `benefaction_${context.ids.next("gift").replace(/[^a-z0-9_-]/gi, "_").toLowerCase()}`.slice(0, 60),
      kind: "public_benefaction",
      summary: `${giver.name} gave the people of ${place} ${what}${fromTreasury ? " out of the treasury" : " at his own cost"}, ${spent} spent${spent < delta.amount ? ` of the ${delta.amount} meant` : ""}: ${delta.reason.replace(/[.\s]+$/, "")}. ${gain > 0 ? `His name is the better for it${repeats > 0 ? ", if less than the first time" : ""}.` : "It was hardly noticed."}`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: giver.id }, ...(provinceId === null ? [] : [{ kind: "province" as const, id: provinceId }])],
      knownToRefs: [{ kind: "character", id: giver.id }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: aedile || spent >= scale ? 45 : 30,
    },
  };
}
