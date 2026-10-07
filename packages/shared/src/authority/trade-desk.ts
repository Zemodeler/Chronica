import { z } from "zod";
import { buildStation, holdsPolityStanding } from "./station";
import { buildAuthorityIndex } from "./authority-grant";
import { readAbroad } from "./abroad";
import { allOffices, type Office } from "../characters/character";
import { readDepartments } from "../world/departments";
import { GOODS, type GoodId } from "../world/markets";
import { TradeTermsSchema, agreementsBetween, atWar, tradeTermsBetween, type TradeTerms } from "../world/agreements";
import { readTheTrade } from "../material/trade-view";
import type { WorldState } from "../world/world-state";

/**
 * Proposing trade by letter: who is written to, and what the letter proposes.
 *
 * A trade pact and an embargo used to be made by `agreement_open` alone, a
 * decree with nobody on the other side of it. They are now said in a letter
 * (`trade_offer`, `embargo_notice`), the power written to answers it, and only
 * its yes opens the pact. That makes two questions the player's page must
 * answer before a word is written, and this module answers both for the page
 * and for the engine alike, so that what the sheet says and what happens
 * cannot drift apart.
 *
 * - **Who decides.** A trade pact caps the customs a whole power lays and an
 *   embargo shuts its markets: the government's to grant, not a general's.
 *   The person who answers a power's letters is the one who holds its
 *   diplomatic authority (`tradeAddressee`): the head of the department that
 *   writes its letters, failing that whoever holds its diplomatic grant, the
 *   ruler, or the first of its officers. The sheet names him and says why; a
 *   letter to anybody else is answered by pointing the writer to him.
 * - **What is proposed.** The terms start from what stands: a pact in force is
 *   revised from its own terms, a new one from the power's own customs rate,
 *   and an embargo from the goods the markets say matter.
 */

/** Who answers for a power in a matter of trade, and the reason in a sentence. */
export interface TradeAddressee {
  readonly characterId: string;
  readonly name: string;
  readonly officeLabel: string | null;
  /** Why it is he: "he heads the department that writes Carthage's letters". */
  readonly why: string;
  readonly basis: "department" | "diplomat" | "ruler" | "officer";
}

/**
 * Builds, once for a world, the finder of who answers for a power. Reading the
 * authority index and the departments is the cost, so a page that asks for
 * thirty powers asks for it once.
 */
export function tradeAddresseeFinder(world: WorldState, offices: readonly Office[]): (polityId: string, notFrom?: string | null) => TradeAddressee | null {
  const all = allOffices(world, offices);
  const index = buildAuthorityIndex(
    { officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts },
    world.authorityGrants,
    all,
    world.elapsedStep,
  );
  const reader = readDepartments(world);
  const officeLabelOf = (characterId: string): string | null => {
    const person = world.characters.find((character) => character.id === characterId);
    const seat = world.material.officeSeats.find((candidate) => candidate.status === "held" && candidate.holderCharacterId === characterId);
    const officeId = person?.officeId ?? seat?.officeId ?? null;
    return officeId === null ? null : all.find((office) => office.id === officeId)?.label ?? null;
  };
  return (polityId, notFrom = null) => {
    const members = new Set(world.characters.filter((character) => character.alive && character.polityId === polityId && character.id !== notFrom).map((character) => character.id));
    if (members.size === 0) return null;
    const named = (characterId: string, why: (name: string) => string, basis: TradeAddressee["basis"]): TradeAddressee => {
      const name = world.characters.find((character) => character.id === characterId)?.name ?? characterId;
      return { characterId, name, officeLabel: officeLabelOf(characterId), why: why(name), basis };
    };
    const office = reader.holding({ kind: "polity", id: polityId }, "foreign_letters");
    const clerk = office.department === null ? undefined : office.people.find((person) => members.has(person.id));
    if (clerk !== undefined) return named(clerk.id, () => `its letters to other powers are written by the ${office.department!.name}, and he sits at its head`, "department");
    const rulers = new Set(reader.rulers(polityId).map((person) => person.id));
    const diplomats = index.grants
      .filter((grant) => grant.domain === "diplomatic" && grant.scope.kind === "polity" && grant.scope.id === polityId
        && grant.holder.kind === "character" && members.has(grant.holder.id))
      .sort((a, b) => b.powers.length - a.powers.length || Number(rulers.has(b.holder.id)) - Number(rulers.has(a.holder.id)) || a.holder.id.localeCompare(b.holder.id));
    if (diplomats.length > 0) {
      const holder = diplomats[0]!.holder.id;
      return named(holder, () => rulers.has(holder) ? "he rules it, and its treaties are made in its ruler's name" : "his office holds its diplomatic powers", rulers.has(holder) ? "ruler" : "diplomat");
    }
    const ruler = [...rulers].find((id) => members.has(id));
    if (ruler !== undefined) return named(ruler, () => "it has no office that makes treaties but its ruler's", "ruler");
    const officer = world.characters.filter((character) => members.has(character.id) && character.officeId !== null).map((character) => character.id).sort()[0];
    return officer === undefined ? null : named(officer, () => "he is the nearest it has to a minister for foreign affairs", "officer");
  };
}

/** What a proposal may be: the four things the page's "Propose" can say. */
export type TradeProposalKind = "pact" | "revise" | "lift" | "embargo";

/** The goods an embargo may name, in the order the markets list them. */
export const TRADE_GOODS: readonly { readonly id: GoodId; readonly name: string }[] = GOODS.map((spec) => ({ id: spec.id, name: spec.name }));

const goodWords = (ids: readonly GoodId[]): string => ids.map((id) => GOODS.find((spec) => spec.id === id)?.name.toLowerCase() ?? id.replace(/_/g, " ")).join(", ");
const percent = (bps: number): string => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)} in a hundred`;

/**
 * The terms of a pact or an embargo as a letter says them, one plain sentence
 * to a term. The words are what a model reads and what the answerer's letter
 * quotes; the numbers are what the engine reads, so the two are written together.
 */
export function tradeTermsInWords(trade: TradeTerms, kind: "pact" | "embargo", days: number | null = null): string {
  const lasting = days === null ? "" : ` This holds for ${days >= 330 ? `${Math.round(days / 365)} ${Math.round(days / 365) === 1 ? "year" : "years"}` : `${Math.round(days / 30)} months`}.`;
  if (kind === "embargo") {
    return `${trade.goods.length === 0 ? "Every good would be forbidden between our markets." : `Forbidden between our markets: ${goodWords(trade.goods)}.`}${lasting}`;
  }
  return [
    trade.tariffCapBps === null ? "Neither power would be held to a cap on customs." : `Customs on either power's goods would not pass ${percent(trade.tariffCapBps)}.`,
    trade.mostFavoured ? "Each would give the other the best terms it gives anybody." : null,
    trade.exempt.length > 0 ? `Free of customs: ${goodWords(trade.exempt)}.` : null,
  ].filter((term): term is string => term !== null).join(" ") + lasting;
}

/** The pact in force between two powers, as the terms the form starts from. */
export interface TradeDeskPact {
  readonly tariffCapBps: number | null;
  readonly mostFavoured: boolean;
  readonly exempt: readonly GoodId[];
  readonly heldByWar: boolean;
}

export interface TradeDeskPower {
  readonly polityId: string;
  readonly label: string;
  /** Who answers for it in trade, and why; null where it has nobody left to answer. */
  readonly addressee: TradeAddressee | null;
  readonly atWar: boolean;
  /** The pact in force with it. */
  readonly pact: TradeDeskPact | null;
  /** An embargo we have laid on it (goods named, or all), and one it has laid on us. */
  readonly embargoByUs: { readonly goods: readonly GoodId[] } | null;
  readonly embargoOnUs: { readonly goods: readonly GoodId[] } | null;
  /** What each of the four proposals would start from, or why it may not be made. */
  readonly proposals: Readonly<Record<TradeProposalKind, { readonly allowed: boolean; readonly why: string | null; readonly start: TradeTerms }>>;
}

export interface TradeDesk {
  /** The customs the player's own power lays, in basis points: what a cap is measured against. */
  readonly ourCustomsBps: number;
  /** Whether the player may write for his power in these matters, and if not, why not. */
  readonly speaksForUs: { readonly yes: boolean; readonly why: string | null };
  readonly powers: readonly TradeDeskPower[];
}

export const EMPTY_TRADE_DESK: TradeDesk = { ourCustomsBps: 0, speaksForUs: { yes: false, why: null }, powers: [] };

/** A cap a power could offer and live with: about half its own rate, in whole points, never under three nor over ten in a hundred. */
export function suggestedCapBps(ownRateBps: number): number {
  if (ownRateBps <= 0) return 500;
  return Math.max(300, Math.min(1_000, Math.round(ownRateBps / 2 / 100) * 100));
}

/** The six goods' ids that the power's own market is short of: what it would ask to have let in free. */
function hungryFor(world: WorldState, polityId: string): GoodId[] {
  const reading = readTheTrade(world, polityId);
  return reading !== null && reading.shortHubs > 0 ? ["grain"] : [];
}

/**
 * What the player may propose to each power he knows of, and whom he writes to.
 * Station-filtered through `readAbroad`: a power he has never heard of is not here.
 */
export function readTradeDesk(world: WorldState, characterId: string | null, offices: readonly Office[] = []): TradeDesk {
  if (characterId === null) return EMPTY_TRADE_DESK;
  const station = buildStation({ world, characterId, offices });
  const ours = station.polityId;
  if (ours === null) return EMPTY_TRADE_DESK;
  const abroad = readAbroad(world, characterId, offices);
  const find = tradeAddresseeFinder(world, offices);
  const ourRate = readTheTrade(world, ours)?.customsRateBps ?? 0;
  const governs = holdsPolityStanding(station);
  const speaks = station.grants.some((grant) => grant.domain === "diplomatic" && grant.scope.kind === "polity" && grant.scope.id === ours && grant.powers.includes("negotiate"));
  const wanted = hungryFor(world, ours);
  // The powers he has dealings with, and every power whose people he knows: a pact is proposed to a power he has never treated with.
  const known = new Map<string, string>(abroad.powers.map((power) => [power.polityId, power.label]));
  for (const person of world.characters) {
    // A government knows of every power with people in it; a private man, only of those whose people he has met.
    if (!person.alive || person.polityId === null || person.polityId === ours || known.has(person.polityId) || !(governs || station.knownCharacterIds.has(person.id))) continue;
    known.set(person.polityId, world.map.polities.find((polity) => polity.id === person.polityId)?.name ?? "another power");
  }
  const powers: TradeDeskPower[] = [];
  for (const [other, label] of [...known].sort((a, b) => a[1].localeCompare(b[1]))) {
    const power = { polityId: other, label };
    if (other === ours) continue;
    const addressee = find(other);
    const standing = agreementsBetween(world.polityAgreements, ours, other);
    const pactRecord = standing.find((agreement) => agreement.kind === "trade_pact");
    const terms = tradeTermsBetween(world, ours, other);
    const war = atWar(world.polityAgreements, ours, other);
    const embargoOf = (by: string): { goods: readonly GoodId[] } | null => {
      const found = standing.find((agreement) => agreement.kind === "embargo" && agreement.polityId === by);
      return found === undefined ? null : { goods: found.trade?.goods ?? [] };
    };
    const pact: TradeDeskPact | null = pactRecord === undefined ? null : {
      tariffCapBps: pactRecord.trade?.tariffCapBps ?? null,
      mostFavoured: pactRecord.trade?.mostFavoured ?? false,
      exempt: pactRecord.trade?.exempt ?? [],
      heldByWar: terms.pactSuspended,
    };
    const byUs = embargoOf(ours);
    const onUs = embargoOf(other);
    const fresh: TradeTerms = { tariffCapBps: suggestedCapBps(ourRate), mostFavoured: false, exempt: wanted, goods: [] };
    const revised: TradeTerms = pact === null ? fresh : {
      // One step tighter than what stands, or a first cap where there was none.
      tariffCapBps: pact.tariffCapBps === null ? suggestedCapBps(ourRate) : Math.max(0, pact.tariffCapBps - 100),
      mostFavoured: pact.mostFavoured,
      exempt: [...new Set([...pact.exempt, ...wanted])],
      goods: [],
    };
    const embargo: TradeTerms = { tariffCapBps: null, mostFavoured: false, exempt: [], goods: [] };
    const gone = addressee === null ? "Nobody is left there to write to." : null;
    const proposals: TradeDeskPower["proposals"] = {
      pact: { allowed: war ? false : pact === null && gone === null, why: gone ?? (war ? `You are at war with ${power.label}: nothing crosses the border, and a pact would wait for the peace.` : pact !== null ? "A pact already stands between you: revise it instead." : null), start: fresh },
      revise: { allowed: pact !== null && gone === null, why: gone ?? (pact === null ? "No pact stands between you to revise." : null), start: revised },
      lift: { allowed: onUs !== null && !war && gone === null, why: gone ?? (onUs === null ? `${power.label} has laid no embargo on you.` : war ? "Nothing crosses while the war lasts." : null), start: fresh },
      embargo: { allowed: !war && byUs === null && gone === null, why: gone ?? (byUs !== null ? `You have already laid an embargo on ${power.label}.` : war ? "War has closed the border already." : null), start: embargo },
    };
    powers.push({ polityId: other, label: power.label, addressee, atWar: war, pact, embargoByUs: byUs, embargoOnUs: onUs, proposals });
  }
  return {
    ourCustomsBps: ourRate,
    speaksForUs: speaks ? { yes: true, why: null } : { yes: false, why: "Your office does not let you treat in your government's name. A proposal from you would be a private man's, and bind nobody until your government makes it its own." },
    powers,
  };
}

/** What the page sends when a letter proposes trade: the choice, the terms, how long it holds, and what an embargo asks. */
export const TradeProposalRequestSchema = z.object({
  kind: z.enum(["pact", "revise", "lift", "embargo"]),
  trade: TradeTermsSchema,
  forDays: z.number().int().positive().max(36_600).nullable().default(null),
  /** For a notice of embargo: what is asked, so that it may be yielded to. */
  demand: z.string().trim().max(300).optional(),
}).strict();
export type TradeProposalRequest = z.infer<typeof TradeProposalRequestSchema>;

/** Days a proposal waits for its answer: a pact is a matter of weeks, a notice of embargo is given a month. */
export const PROPOSAL_REPLY_DAYS: Readonly<Record<TradeProposalKind, number>> = { pact: 60, revise: 60, lift: 60, embargo: 30 };

/**
 * The letter a proposal is: its subject, and its words, the writer's own first and the terms after them, as a letter says them.
 * The engine reads the terms from the structured fields; these are what the one written to reads, and what a model is shown.
 */
export function composeProposal(request: TradeProposalRequest, toLabel: string, words: string): { subject: string; terms: string; letterKind: "trade_offer" | "embargo_notice" } {
  const embargo = request.kind === "embargo";
  const opening = {
    pact: `I propose a pact of trade between our two powers, ${toLabel} and mine.`,
    revise: `I would have the terms of the pact of trade between ${toLabel} and my power set down anew.`,
    lift: `I ask that you lift your embargo, and open your markets to my people once more, on a pact of trade between us.`,
    embargo: `${request.demand !== undefined && request.demand.length > 0 ? `I ask ${request.demand.replace(/^that\s+/i, "that ")}.` : "I ask that our merchants be dealt with more fairly in your markets."} If it is not done, my markets will be shut to yours.`,
  }[request.kind];
  const subject = {
    pact: "A pact of trade", revise: "The terms of our pact of trade", lift: "That the embargo be lifted", embargo: "A notice of embargo",
  }[request.kind];
  const terms = tradeTermsInWords(request.trade, embargo ? "embargo" : "pact", request.forDays);
  const own = words.trim();
  const head = own.length > 0 ? `${own}\n\n` : "";
  const full = `${head}${opening} ${terms}`;
  return { subject, terms: full.length <= 1_200 ? full : `${own.slice(0, Math.max(0, 1_200 - opening.length - terms.length - 4))}\n\n${opening} ${terms}`.slice(0, 1_200), letterKind: embargo ? "embargo_notice" : "trade_offer" };
}
