import { treasuryOf, type FactProposal, type OrderPartyRef, type WorldDelta, type WorldState } from "@chronica/shared";
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

/**
 * What only the engine can make true, and the act that makes it so.
 *
 * A model writes history as prose, and some of that prose is the engine's to
 * say. "Hieron's army laid siege to Messana" stood in the record on day 9 with
 * no siege behind it: nothing starved the city, nothing reported on it, and the
 * siege the world actually held began on day 28. A battle told with no battle
 * fought, an army said to have moved that stands where it stood, a city said
 * to have fallen that its old masters still hold -- each is a fact the world
 * then contradicts. So a fact of one of these kinds stands only beside the act
 * that makes it true. Without one it becomes that act where the fact says
 * plainly which army -- a siege is laid by an army standing at the walls, and
 * the engine judges it like any other -- and is otherwise left out. The act,
 * once carried out, tells itself.
 */
const ENGINE_OWNED: readonly { readonly kinds: RegExp; readonly op: WorldDelta["op"]; readonly also?: WorldDelta["op"] }[] = [
  { kinds: /^(siege|siege_laid|siege_begun|siege_opened|siege_started|besieged|city_besieged|investment)$/, op: "siege_lay" },
  { kinds: /^(battle|battle_fought|battle_won|battle_lost|engagement|pitched_battle|clash|skirmish|defeat_in_battle|victory_in_battle)$/, op: "force_engage" },
  { kinds: /^(province_taken|province_captured|province_conquered|province_control_change|city_taken|city_captured|city_fell|city_falls|city_surrendered|conquest)$/, op: "province_control_set", also: "settlement_control_set" },
  { kinds: /^(capital_relocated|capital_restored|capital_designated|capital_moved)$/, op: "capital_set" },
  { kinds: /^(force_moved|force_movement|army_moved|army_marched|army_arrived|fleet_moved|fleet_movement|fleet_arrived|troop_movement|march|march_begun|crossing|crossing_begun)$/, op: "force_modify" },
];

export interface FactsAndTheirActs {
  /** The facts that stand: every one not of an engine-owned kind, and those whose act is in the answer. */
  readonly facts: readonly FactProposal[];
  /** Acts made from facts that named their army, to be judged with the rest. */
  readonly acts: readonly WorldDelta[];
  /** What was left out, and why, for the audit. */
  readonly dropped: readonly string[];
  /**
   * What was said with nothing behind it, kept as what it is: somebody's
   * report, not the world's (`asClaim`). A camp that says the city fell is
   * news of the camp; that the city fell is the engine's to say.
   */
  readonly claims: readonly FactProposal[];
}

/**
 * A fact nothing stands behind, as a report of it: its own kind, marked, its
 * weight capped, its words said as said. Never a thing the Chronicle must
 * tell, and never read as the event -- the engine's record is where the event
 * is, when it comes.
 */
export function asClaim(fact: FactProposal): FactProposal {
  const said = fact.summary.trim();
  return {
    ...fact,
    kind: `claim_${fact.kind}`.slice(0, 80),
    // A name keeps its capital; only "The", "A", "His" and their kind lose it.
    summary: /^(it was said|word came|it was reported)/i.test(said) ? said
      : `It was said that ${/^(The|A|An|His|Her|Their|Its|Our|Some|Many)\b/.test(said) ? `${said.charAt(0).toLowerCase()}${said.slice(1)}` : said}`.slice(0, 600),
    significance: Math.min(fact.significance, 30),
  };
}

/** Whether a fact is a report of something rather than the thing (`asClaim`). */
export const isClaim = (kind: string): boolean => kind.startsWith("claim_");

export function actsBehindFacts(
  facts: readonly FactProposal[],
  deltas: readonly WorldDelta[],
  world: WorldState,
  /** The player's armies are moved by the player: a fact about them is never made into an act. */
  playerCharacterId: string | null,
): FactsAndTheirActs {
  const kept: FactProposal[] = [];
  const acts: WorldDelta[] = [];
  const dropped: string[] = [];
  const claims: FactProposal[] = [];
  const mentions = (delta: WorldDelta, id: string): boolean => JSON.stringify(delta).includes(`"${id}"`);
  for (const fact of facts) {
    const owned = ENGINE_OWNED.find((entry) => entry.kinds.test(fact.kind.trim().toLowerCase()));
    if (owned === undefined) {
      kept.push(fact);
      continue;
    }
    const forces = fact.affectedRefs.filter((ref) => ref.kind === "force").map((ref) => world.material.forces.find((force) => force.id === ref.id)).filter((force) => force !== undefined);
    const behind = deltas.some((delta) => (delta.op === owned.op || delta.op === owned.also)
      && (delta.op !== "force_modify" || delta.locationId !== undefined)
      && (forces.length === 0 || forces.some((force) => mentions(delta, force.id))));
    if (behind) {
      kept.push(fact);
      continue;
    }
    const theirs = forces.length === 1 && forces[0]!.controllerCharacterId !== playerCharacterId && forces[0]!.commanderCharacterId !== playerCharacterId;
    if (owned.op === "siege_lay" && theirs) {
      acts.push({ op: "siege_lay", localId: `siege_${fact.localId}`.slice(0, 60), forceRef: forces[0]!.id, settlementId: null, reason: fact.summary.slice(0, 300) });
      dropped.push(`"${fact.kind}" is the engine's to tell: made into the siege it describes, for ${forces[0]!.name}.`);
      continue;
    }
    dropped.push(`"${fact.kind}" ("${fact.summary.slice(0, 80)}") asserted what only the engine makes true, with no "${owned.op}" behind it; kept as a report.`);
    claims.push(asClaim(fact));
  }
  return { facts: kept, acts, dropped, claims };
}
