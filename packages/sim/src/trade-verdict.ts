import { agreementsBetween, atWar, economyOf, readTheTrade, tradeTermsBetween, type Character, type DiplomaticMessage, type GoodId, type TradeTerms, type WorldState } from "@chronica/shared";
import type { Disposition } from "./disposition";
import type { Verdict } from "./letter-verdict";
import type { Intent, Reason } from "./letter-craft";

/**
 * What a ruler would say to an offer of trade or a notice of embargo, by who
 * he is and by what his power stands to lose or gain -- before anyone words it.
 *
 * Trade used to be made by decree: `agreement_open` with nobody on the other
 * side. Now it is proposed in a letter and decided by the one it is written to
 * (docs/economy.md, "Proposing trade by letter"), and that answer must be one a
 * reader can see the reasons for, the same every time it is asked. The reasons
 * are the ones a power's own books give:
 *
 * - **Customs given up.** A cap below the rate the answerer's power lays on the
 *   sender's goods is revenue forgone, weighed in basis points of customs, and
 *   the more of its inbound trade comes from the sender (the lanes the monthly
 *   flow records), the more a cap costs. Goods let in free cost the same, unless
 *   they are bread the answerer's own markets are short of: then they are a gain.
 * - **What he can bear.** A greedy man bears little, a sociable one more; trust
 *   and his own liking of the writer count, a fond neighbour is given what a
 *   stranger would not be, and a suspicious man gives less.
 * - **Need.** A power short of grain (`readTheTrade`) wants trade and says yes
 *   to terms it would otherwise haggle over; it does not take an embargo lightly.
 * - **What already stands.** A war closes the border and no pact is signed over
 *   it; an embargo the answerer laid is lifted only on better grace; one laid on
 *   him is a reason to want the pact; a pact in force is revised on what the
 *   change costs over what it already cost.
 *
 * A pact that costs more than he can bear but not out of reach is answered
 * with terms of his own (`counter`): the cap raised until it is one he can
 * keep, most-favoured status dropped, and only the bread free. A counter is
 * not countered again, so a bargain ends in at most two letters.
 */

/** Basis points of customs a middling man will give up for a neighbour he has no feeling about. */
const WILLING_BASE_BPS = 700;
/** How far past what he will bear a man will still answer with terms rather than a refusal. */
const COUNTER_ROOM_BPS = 900;
/** What a good let in free is worth to the power that lays the customs, as a cap's worth of basis points. */
const EXEMPT_COST_BPS = 150;
/** Bread short at home: how much of an answerer's mind it takes. */
const HUNGER_BPS = 350;
const FREE_BREAD_BPS = 250;

export interface TradeMind {
  readonly d: Disposition;
  readonly trust: number;
  readonly liking: number;
  /** What he feels for the sender's power: fond is +25, unforgiving -25. */
  readonly bias: number;
  readonly suspicious: number;
  readonly generous: number;
  readonly stubborn: number;
  readonly unforgiven: boolean;
  readonly fondOf: boolean;
  readonly slowness: number;
}

/** What the answerer's power is made of, as far as this letter touches it. */
export interface TradeStakes {
  /** The customs it lays, in basis points. */
  readonly rate: number;
  /** The share of the goods that come into its markets that comes from the sender, 0 to 1: what a cap on customs costs it. */
  readonly reliance: number;
  /** The share of all its lanes, in and out, that run to the sender: what an embargo cuts. */
  readonly exposure: number;
  /** Its people are short of bread. */
  readonly hungry: boolean;
}

export function stakesOf(world: WorldState, answererPolityId: string, senderPolityId: string): TradeStakes {
  const reading = readTheTrade(world, answererPolityId);
  const lanes = economyOf(world).tradeLanes;
  const valueOf = (filter: (lane: (typeof lanes)[number]) => boolean): number => lanes.filter(filter).reduce((sum, lane) => sum + lane.value, 0);
  const inbound = valueOf((lane) => lane.toPolityId === answererPolityId);
  const fromSender = valueOf((lane) => lane.toPolityId === answererPolityId && lane.fromPolityId === senderPolityId);
  const toSender = valueOf((lane) => lane.fromPolityId === answererPolityId && lane.toPolityId === senderPolityId);
  const all = valueOf((lane) => lane.toPolityId === answererPolityId || lane.fromPolityId === answererPolityId);
  return {
    rate: reading?.customsRateBps ?? 0,
    reliance: inbound <= 0 ? 0 : fromSender / inbound,
    exposure: all <= 0 ? 0 : (fromSender + toSender) / all,
    hungry: reading !== null && reading.shortHubs > 0,
  };
}

/** The customs a pact would cost the answerer, in basis points; below zero where it is a gain. */
export function costOfPact(world: WorldState, answererPolityId: string, terms: TradeTerms, stakes: TradeStakes): number {
  let cap = terms.tariffCapBps;
  if (terms.mostFavoured) {
    // The best terms he gives anybody: the lowest cap in any other pact of his.
    for (const other of world.polityAgreements) {
      if (other.status !== "active" || other.kind !== "trade_pact" || other.trade?.tariffCapBps == null) continue;
      if (other.polityId !== answererPolityId && other.otherPolityId !== answererPolityId) continue;
      cap = cap === null ? other.trade.tariffCapBps : Math.min(cap, other.trade.tariffCapBps);
    }
  }
  const weight = 0.6 + 0.8 * stakes.reliance;
  const forgone = cap === null ? 0 : Math.max(0, stakes.rate - cap);
  const freeGoods = terms.exempt.filter((good) => !(good === "grain" && stakes.hungry));
  const freeBread = stakes.hungry && terms.exempt.includes("grain") ? FREE_BREAD_BPS : 0;
  return Math.round((forgone + freeGoods.length * EXEMPT_COST_BPS) * weight) - freeBread;
}

const same = (a: TradeTerms, b: TradeTerms): boolean => a.tariffCapBps === b.tariffCapBps && a.mostFavoured === b.mostFavoured
  && [...a.exempt].sort().join() === [...b.exempt].sort().join();

const verdict = (accepted: boolean, intent: Intent, reason: Reason, why: string, mind: TradeMind, extra: Verdict["extra"] = {}, more: Partial<Verdict> = {}): Verdict =>
  ({ accepted, intent, reason, why, extra, weak: false, slowness: mind.slowness, ...more });

/** Whether the person written to is not the one who decides it, and who is: the engine's reading, stamped when it was sent. */
function redirectOf(world: WorldState, message: DiplomaticMessage, answerer: Character): { readonly characterId: string; readonly name: string } | null {
  if (message.decidedBy == null || message.decidedBy === answerer.id) return null;
  const decider = world.characters.find((character) => character.id === message.decidedBy && character.alive && character.polityId === message.toPolityId);
  return decider === undefined ? null : { characterId: decider.id, name: decider.name };
}

export function tradeVerdict(world: WorldState, message: DiplomaticMessage, answerer: Character, mind: TradeMind): Verdict {
  const R = message.toPolityId;
  const S = message.fromPolityId;
  const { d } = mind;
  const nameOf = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

  // Not his to decide: a general is asked for a customs cap. He says who decides, kindly, and nothing is opened or refused.
  const redirect = redirectOf(world, message, answerer);
  if (redirect !== null) {
    return verdict(false, "trade_redirect", "not_mine", `not his to decide: ${redirect.name} answers for ${nameOf(R)}`, mind,
      { ask: `write to ${redirect.name}, who answers for ${nameOf(R)} in such matters`, matter: message.subject }, { redirect });
  }

  const between = tradeTermsBetween(world, R, S);
  const stakes = stakesOf(world, R, S);
  const warring = atWar(world.polityAgreements, R, S);

  if (message.kind === "embargo_notice") {
    // How hard the shutting would fall on him, and how much he will stand before he bows to it.
    const forbidden = message.trade?.goods ?? [];
    const whole = forbidden.length === 0;
    const grainShut = whole || forbidden.includes("grain");
    const pain = 100 * stakes.exposure * (whole ? 1 : 0.5) + (stakes.hungry && grainShut ? 30 : 0);
    const pride = d.pride + 0.15 * mind.stubborn + (mind.unforgiven ? 0.15 : 0) - (mind.fondOf ? 0.15 : 0);
    const resolve = 25 + 55 * pride - mind.liking / 6 - 20 * (d.fear - 0.5);
    if (warring || between.closed === "embargo" && between.embargoedBy === S && whole) {
      return verdict(false, "embargo_protest", "at_war", "nothing crosses already", mind, { matter: message.subject });
    }
    const yields = pain >= resolve;
    return verdict(yields, yields ? "embargo_yield" : "embargo_protest", yields ? (stakes.hungry && grainShut ? "grain" : "price") : "none",
      yields ? "would not see the markets shut" : "will not be threatened", mind, { matter: message.subject });
  }

  // An offer of a pact: new, a revision of the one that stands, or the price of an embargo's lifting.
  const offered = message.trade ?? { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [] };
  if (warring) return verdict(false, "trade_refuse", "at_war", "at war: nothing crosses", mind, { matter: message.subject });
  if (mind.trust <= -40) return verdict(false, "trade_refuse", "distrust", "does not trust him", mind, { matter: message.subject });

  const standing = agreementsBetween(world.polityAgreements, R, S).find((agreement) => agreement.kind === "trade_pact");
  const current: TradeTerms = standing?.trade ?? { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [] };
  if (standing !== undefined && same(offered, current)) return verdict(true, "trade_accept", "friendship", "already agreed", mind, { matter: message.subject });
  // What the change costs over what already stands: a revision that only lowers his burden is no price at all.
  const costOf = (terms: TradeTerms): number => Math.max(0, costOfPact(world, R, terms, stakes) - (standing === undefined ? 0 : costOfPact(world, R, current, stakes)));
  const embargoByHim = between.embargoedBy === R;
  const embargoOnHim = between.embargoedBy === S;
  const hungerBonus = stakes.hungry ? HUNGER_BPS : 0;
  const willing = WILLING_BASE_BPS + 6 * mind.trust + 5 * mind.liking + 8 * mind.bias + 700 * (0.5 - d.greed) + 300 * (d.sociability - 0.5)
    + hungerBonus + 200 * mind.generous - 250 * mind.suspicious - 100 * mind.stubborn
    - (embargoByHim ? 500 : 0) + (embargoOnHim ? 300 : 0);
  const cost = costOf(offered);
  if (cost <= willing) return verdict(true, "trade_accept", embargoOnHim || stakes.hungry ? "grain" : "friendship", `customs given up (${cost}) are within what he will bear (${Math.round(willing)})`, mind, { matter: message.subject });

  const reason: Reason = embargoByHim ? "embargoed" : "customs";
  // He would deal, on terms he can keep: unless this is already such a counter, or he is too cold to haggle.
  const answeringACounter = message.inReplyToMessageId !== null && world.diplomacy.find((earlier) => earlier.id === message.inReplyToMessageId)?.kind === "trade_offer";
  if (!answeringACounter && cost <= willing + COUNTER_ROOM_BPS && !embargoByHim) {
    const counter = counterTerms(offered, stakes, willing, costOf);
    if (counter !== null) {
      return verdict(false, "trade_counter", reason, `would sign on other terms: customs capped at ${counter.tariffCapBps ?? "no cap"}`, mind, { matter: message.subject }, { counter });
    }
  }
  return verdict(false, "trade_refuse", reason, embargoByHim ? "his embargo stands" : "the customs given up are too dear", mind, { matter: message.subject });
}

/**
 * The terms he would sign when he cannot sign these: most-favoured status gone,
 * free goods cut to the bread he is short of, and the cap raised a hundred basis
 * points at a time until what it costs him is what he will bear. Null when the
 * only terms he could bear concede nothing -- a pact that changes nothing is a
 * refusal, not a counter.
 */
function counterTerms(offered: TradeTerms, stakes: TradeStakes, willing: number, costOf: (terms: TradeTerms) => number): TradeTerms | null {
  const exempt: GoodId[] = stakes.hungry && offered.exempt.includes("grain") ? ["grain"] : [];
  const from = offered.tariffCapBps ?? stakes.rate;
  for (let cap = Math.min(from, stakes.rate); cap <= stakes.rate; cap += 100) {
    const terms: TradeTerms = { tariffCapBps: cap, mostFavoured: false, exempt, goods: [] };
    if (costOf(terms) <= willing) {
      return cap >= stakes.rate && exempt.length === 0 ? null : terms;
    }
  }
  return null;
}
