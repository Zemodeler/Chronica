import { treasuryOf, type OrderPartyRef, type WorldDelta, type WorldState } from "@chronica/shared";
import { accountOf } from "./normalize-refs";

/**
 * The details a person doing something for himself never has to say.
 *
 * `normalizeRefs` puts right a reference that is nearly right. This is the
 * other half: a reference that is not right at all, in a field whose answer is
 * obvious from who is acting. A merchant who "sets up a stall" pays for it
 * from his own purse and sets it up where he is standing. The model, writing
 * the delta, has to name an account id and a province id it may not have in
 * front of it, and before this every wrong guess was a refused act, a repair
 * call, and -- as often as not -- an order that quietly did less than it said.
 *
 * Only the actor's own acts, and only fields that answer "who pays" or "where":
 * - A payer that names no account is the actor's own: his purse, or his
 *   government's treasury where the name says it is the public's money. The
 *   authority check that follows is unchanged, so a private man charging the
 *   treasury still breaches exactly as he did.
 * - A place that names no province is where the actor is.
 * - A venture whose far end names no province is trade in the one market.
 * - A power that names none is the actor's own.
 * - His own money paid to no account there is is money spent.
 *
 * Never a null. A null in these fields means something -- land granted from
 * the public domain, a project nobody pays for -- and is left alone. Never a
 * recipient, a target or a destination either: who receives money, whom an
 * army attacks and where it marches are the substance of an order, not its
 * paperwork, and guessing them would be putting words in the player's mouth.
 *
 * Each fill is said out loud, so the audit shows what the engine assumed.
 */

/** Who pays, per act: the fields a purse is the obvious answer to. */
const PAYER_FIELDS: Readonly<Record<string, readonly string[]>> = {
  money_transfer: ["fromAccountRef"],
  obligation_upsert: ["payerAccountRef"],
  project_create: ["fundingAccountRef"],
  holding_create: ["priceFromAccountRef"],
  holding_improve: ["paidFromAccountRef"],
  trade_venture_open: ["paidFromAccountRef"],
  service_contract_open: ["employerAccountRef"],
  covert_plot_open: ["fundingAccountRef"],
  contingency_arm: ["fundingAccountRef"],
};

/** Where, per act: the fields "where he is" is the obvious answer to. */
const SITE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  force_create: ["locationId"],
  character_create: ["provinceId"],
  generic_entity_create: ["provinceId"],
  holding_create: ["provinceId"],
  project_create: ["provinceId"],
  trade_venture_open: ["fromProvinceId"],
};

/** Whose, per act: the fields "his own country" is the obvious answer to. */
const POLITY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  force_create: ["polityId"],
  character_create: ["polityId"],
};

/** Words that say the money meant is the public's, not the man's. */
const PUBLIC_MONEY = /treasury|aerarium|public|state|city|republic|kingdom|crown|fisc/i;

/** The province somebody acting is in: a person where he stands, a power at its capital. */
export function whereTheActorIs(world: WorldState, actorRef: OrderPartyRef): string | null {
  const actor = actorRef.kind === "character" ? world.characters.find((character) => character.id === actorRef.id) : undefined;
  if (actor?.locationProvinceId != null && world.map.provinces.some((province) => province.id === actor.locationProvinceId)) return actor.locationProvinceId;
  const polityId = actor?.polityId ?? (actorRef.kind === "polity" ? actorRef.id : null);
  if (polityId === null) return null;
  const polity = world.map.polities.find((candidate) => candidate.id === polityId);
  const capital = polity?.capitalSettlementId == null
    ? undefined
    : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === polity.capitalSettlementId));
  return capital?.id ?? null;
}

export interface FilledGaps {
  readonly delta: WorldDelta;
  /** One line per field the engine answered, in the audit's words. */
  readonly assumed: readonly string[];
}

export function fillGaps(
  delta: WorldDelta,
  world: WorldState,
  actorRef: OrderPartyRef,
  resolve: (ref: string) => string | undefined,
): FilledGaps {
  const actor = actorRef.kind === "character" ? world.characters.find((character) => character.id === actorRef.id) : undefined;
  const actorPolityId = actor?.polityId ?? (actorRef.kind === "polity" ? actorRef.id : null);
  const record = delta as unknown as Record<string, unknown>;
  const assumed: string[] = [];
  const out: Record<string, unknown> = { ...record };

  const idOf = (value: string): string => resolve(value) ?? value;
  const isAccount = (value: string): boolean => world.material.accounts.some((account) => account.id === idOf(value));
  const isProvince = (value: string): boolean => world.map.provinces.some((province) => province.id === idOf(value));
  const isPolity = (value: string): boolean => world.map.polities.some((polity) => polity.id === idOf(value));
  /** A handle for something made earlier in this answer is not a gap: it resolves when it is reached. */
  const pending = (value: string): boolean => value.startsWith("local:") && resolve(value) !== undefined;

  const payer = (written: string): string | null => {
    const publicMoney = PUBLIC_MONEY.test(written) && actorPolityId !== null ? treasuryOf(world, actorPolityId) : null;
    return publicMoney ?? (actorRef.kind === "character" || actorRef.kind === "polity" ? accountOf(world, actorRef.id) : null);
  };
  const here = (): string | null => whereTheActorIs(world, actorRef);
  const fill = (field: string, answer: string | null, why: string): void => {
    const written = out[field];
    if (answer === null || typeof written !== "string") return;
    out[field] = answer;
    assumed.push(`${field} "${written}" is not ${why}; took ${answer}.`);
  };

  for (const field of PAYER_FIELDS[delta.op] ?? []) {
    const value = out[field];
    if (typeof value === "string" && !isAccount(value) && !pending(value)) fill(field, payer(value), "an account");
  }
  // An arrangement's keep, which sits one level down.
  if ((delta.op === "generic_entity_create" || delta.op === "generic_entity_update") && delta.upkeep != null) {
    const written = delta.upkeep.fromAccountRef;
    if (!isAccount(written) && !pending(written)) {
      const answer = payer(written);
      if (answer !== null) {
        out.upkeep = { ...delta.upkeep, fromAccountRef: answer };
        assumed.push(`upkeep.fromAccountRef "${written}" is not an account; took ${answer}.`);
      }
    }
  }
  for (const field of SITE_FIELDS[delta.op] ?? []) {
    const value = out[field];
    if (typeof value === "string" && !isProvince(value) && !pending(value)) fill(field, here(), "a province");
  }
  for (const field of POLITY_FIELDS[delta.op] ?? []) {
    const value = out[field];
    if (typeof value === "string" && !isPolity(value) && !pending(value)) fill(field, actorPolityId, "a power");
  }
  // His own money paid to something the world keeps no books for -- "the
  // forum stall's fund", "the smith" -- is money spent. Not a recipient
  // guessed: none invented, the schema's own null for money that leaves.
  if (delta.op === "money_transfer") {
    const to = out.toAccountRef;
    const from = out.fromAccountRef;
    const own = typeof from === "string" && world.material.accounts.some((account) => account.id === idOf(from)
      && account.owner.kind === actorRef.kind && account.owner.id === actorRef.id);
    if (typeof to === "string" && own && !isAccount(to) && !pending(to)) {
      out.toAccountRef = null;
      assumed.push(`toAccountRef "${to}" is not an account; the money is spent.`);
    }
  }
  // "Selling in the streets of Rome": the far end of a venture that names no
  // place is the market it started in.
  if (delta.op === "trade_venture_open") {
    const to = out.toProvinceId;
    const from = out.fromProvinceId;
    if (typeof to === "string" && typeof from === "string" && !isProvince(to) && isProvince(from)) fill("toProvinceId", idOf(from), "a province");
  }

  return assumed.length === 0 ? { delta, assumed } : { delta: out as unknown as WorldDelta, assumed };
}
