import {
  WorldDeltaSchema,
  newsDaysBetween,
  ownerOf,
  stableHash,
  warStanding,
  type FactProposalDraft,
  type Office,
  type PeaceTable,
  type PeaceTerm,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { diplomaticAnswererOf } from "./letters";
import { concludePeace, provinceWorth, willingToGive, type PeaceClause } from "./peace";

/**
 * The peace table (docs/plans/a-living-world.md §8), after Hearts of Iron IV.
 *
 * A letter asking to discuss peace ("peace_talks"), once accepted, seats the
 * two powers at a table (`openPeaceTable`). The side that is winning can ask
 * for more: what it can ask is what the other will bear (`willingToGive` --
 * how the war stands, how long it has lasted, and the men bargaining), and
 * every term has a price (`termPrice`). The sides take turns. The player puts
 * his power's terms by hand; the other side answers by rule (`putTerms`):
 * terms it can bear are signed, terms a little beyond it are countered with
 * the dearest dropped, and a side asked for far more than it will give, more
 * than twice, walks out. A session takes the days an envoy takes between the
 * two capitals, and the war goes on: a battle won between sessions moves what
 * can be asked at the next. A man who cannot speak for his power may buy a
 * negotiator (`bribeAtTable`): taken, it moves what that side will bear;
 * refused or found out, it costs him.
 */

const delta = (raw: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse(raw);
/** A side asked for more than this many times what it will bear, three sessions in, walks out. */
const WALK_OUT_AT = 2;
const WALK_OUT_AFTER_SESSIONS = 3;
/** Fewest days between sessions, however near the capitals. */
const SESSION_MIN_DAYS = 5;

const nameOf = (world: WorldState, id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

/** What a term costs the side that gives it, by the table's prices. */
export function termPrice(world: WorldState, term: PeaceTerm, giver: string, taker: string): number {
  switch (term.kind) {
    case "cede": return provinceWorth(world, term.provinceId, giver);
    // Giving back ground one holds is the other half of taking it.
    case "return": {
      const province = world.map.provinces.find((candidate) => candidate.id === term.provinceId);
      return province === undefined || province.controllerPolityId !== giver || ownerOf(province) !== taker ? 0 : Math.max(2, Math.round(provinceWorth(world, term.provinceId, taker) / 2));
    }
    case "indemnity": {
      const chest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === giver && account.status === "active");
      return Math.round((25 * term.amount * term.periods) / Math.max(500, chest?.balance ?? 0));
    }
    case "hostage": return 8;
    case "submission": return 100;
    case "tribute": return 25;
    case "break_alliance": return 10;
    case "client": return 40;
    case "demilitarize": return 6;
    case "trade": return 6;
  }
}

/** The price of a whole set of terms to the side that gives them. */
export function termsPrice(world: WorldState, terms: readonly PeaceTerm[], giver: string, taker: string): number {
  return terms.reduce((sum, term) => sum + termPrice(world, term, giver, taker), 0);
}

/** What a side will bear at this table: its war, its weariness, its envoys, and what bribes have bought. */
export function willBear(world: WorldState, table: PeaceTable, giver: string, offices: readonly Office[]): number {
  const taker = table.sides[0] === giver ? table.sides[1] : table.sides[0];
  const envoy = world.characters.find((character) => character.id === diplomaticAnswererOf(world, giver, offices));
  const asker = world.characters.find((character) => character.id === diplomaticAnswererOf(world, taker, offices));
  const bought = table.bribes.filter((bribe) => bribe.outcome === "taken" && world.characters.find((character) => character.id === bribe.toCharacterId)?.polityId === giver).reduce((sum, bribe) => sum + bribe.points, 0);
  const bear = willingToGive(world, giver, taker, envoy, asker);
  return (Number.isFinite(bear) ? bear : 1_000) + bought;
}

/**
 * What a side that is winning asks, by rule: ground it claims or holds of the
 * other's, dearest first, then an indemnity, up to what the other will bear.
 * A beaten small power is asked for itself.
 */
export function demandsOf(world: WorldState, table: PeaceTable, taker: string, offices: readonly Office[]): PeaceTerm[] {
  const giver = table.sides[0] === taker ? table.sides[1] : table.sides[0];
  const standing = warStanding(world, taker, giver);
  if (standing.score <= 0) return [];
  if (standing.dictates && standing.totalDefeat && world.map.provinces.filter((province) => ownerOf(province) === giver).length <= 3) return [{ kind: "submission" }];
  const budget = willBear(world, table, giver, offices);
  const claimed = new Set((world.map.claimRecords ?? []).filter((claim) => claim.status === "active" && claim.claimantPolityId === taker).map((claim) => claim.locationId));
  const ground = world.map.provinces
    .filter((province) => ownerOf(province) === giver && (province.controllerPolityId === taker || claimed.has(province.id)))
    .sort((a, b) => Number(b.controllerPolityId === taker) - Number(a.controllerPolityId === taker) || Number(claimed.has(b.id)) - Number(claimed.has(a.id)) || a.id.localeCompare(b.id));
  const terms: PeaceTerm[] = [];
  let spent = 0;
  for (const province of ground) {
    const price = termPrice(world, { kind: "cede", provinceId: province.id }, giver, taker);
    if (price <= 0 || spent + price > budget || terms.length >= 20) continue;
    terms.push({ kind: "cede", provinceId: province.id });
    spent += price;
  }
  const chest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === giver && account.status === "active");
  const amount = Math.round(Math.max(0, chest?.balance ?? 0) * 0.1);
  if (amount > 0) {
    const indemnity: PeaceTerm = { kind: "indemnity", amount, periods: 3 };
    if (spent + termPrice(world, indemnity, giver, taker) <= budget) terms.push(indemnity);
  }
  return terms;
}

export interface TableTurn {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  readonly answer: "accepted" | "countered" | "refused" | "walked_out";
  readonly words: string;
  readonly refusal: string | null;
}

/** The treaty the terms make: clauses for the peace itself, and the agreements and endings beside it. */
function treatyOf(world: WorldState, terms: readonly PeaceTerm[], giver: string, taker: string): { clauses: PeaceClause[]; besides: WorldDelta[]; returned: string[] } {
  const clauses: PeaceClause[] = [];
  const besides: WorldDelta[] = [];
  const returned: string[] = [];
  for (const term of terms) {
    if (term.kind === "cede") clauses.push({ kind: "cession", provinceId: term.provinceId, toPolityId: taker });
    if (term.kind === "return") returned.push(term.provinceId);
    if (term.kind === "indemnity") clauses.push({ kind: "indemnity", payerPolityId: giver, amount: term.amount, cadenceDays: 365, periods: term.periods });
    if (term.kind === "hostage") clauses.push({ kind: "hostage", characterRef: term.characterId, heldByPolityId: taker });
    if (term.kind === "submission") clauses.push({ kind: "submission", polityId: giver, toPolityId: taker });
    if (term.kind === "demilitarize") clauses.push({ kind: "undertaking", byPolityId: giver, duty: "other", what: `No army of ${nameOf(world, giver)} in ${world.map.provinces.find((province) => province.id === term.provinceId)?.name ?? term.provinceId}`.slice(0, 120), withinDays: 3_650 });
    if (term.kind === "tribute") besides.push(delta({ op: "agreement_open", localId: `tribute_${giver}`.slice(0, 60), kind: "tributary", polityId: giver, otherPolityId: taker, terms: `${nameOf(world, giver)} pays tribute to ${nameOf(world, taker)}.`, forDays: null, sourceMessageRef: null, visibility: "public", reason: "By the peace." }));
    if (term.kind === "client") besides.push(delta({ op: "agreement_open", localId: `client_${giver}`.slice(0, 60), kind: "protectorate", polityId: giver, otherPolityId: taker, terms: `${nameOf(world, giver)} comes under the protection of ${nameOf(world, taker)}.`, forDays: null, sourceMessageRef: null, visibility: "public", reason: "By the peace." }));
    if (term.kind === "trade") besides.push(delta({ op: "agreement_open", localId: `trade_${giver}`.slice(0, 60), kind: "trade_pact", polityId: giver, otherPolityId: taker, terms: `${nameOf(world, giver)} opens its markets to ${nameOf(world, taker)}.`, forDays: null, sourceMessageRef: null, visibility: "public", reason: "By the peace." }));
    if (term.kind === "break_alliance") {
      const alliance = world.polityAgreements.find((agreement) => agreement.status === "active" && agreement.kind === "alliance"
        && [agreement.polityId, agreement.otherPolityId].includes(giver) && [agreement.polityId, agreement.otherPolityId].includes(term.withPolityId));
      if (alliance !== undefined) besides.push(delta({ op: "agreement_close", agreementRef: alliance.id, reason: "Given up by the peace." }));
    }
  }
  return { clauses, besides, returned };
}

/** Plain words for what was agreed. */
function termsInWords(world: WorldState, terms: readonly PeaceTerm[], giver: string, taker: string): string {
  const province = (id: string): string => world.map.provinces.find((candidate) => candidate.id === id)?.name ?? id;
  const parts = terms.map((term) => {
    switch (term.kind) {
      case "cede": return `${province(term.provinceId)} to ${nameOf(world, taker)}`;
      case "return": return `${province(term.provinceId)} given back to ${nameOf(world, taker)}`;
      case "indemnity": return `${term.amount} a year for ${term.periods} years`;
      case "hostage": return `${world.characters.find((character) => character.id === term.characterId)?.name ?? "a hostage"} as a hostage`;
      case "submission": return `${nameOf(world, giver)} gives itself up`;
      case "tribute": return "a yearly tribute";
      case "break_alliance": return `an end to the alliance with ${nameOf(world, term.withPolityId)}`;
      case "client": return `${nameOf(world, giver)} under ${possessive(nameOf(world, taker))} protection`;
      case "demilitarize": return `no army in ${province(term.provinceId)}`;
      case "trade": return "markets opened";
    }
  });
  return parts.length === 0 ? `Peace between ${nameOf(world, taker)} and ${nameOf(world, giver)}, each keeping what it holds.` : `Peace between ${nameOf(world, taker)} and ${nameOf(world, giver)}: ${parts.join("; ")}.`;
}
const possessive = (name: string): string => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/**
 * One side puts its terms; the other answers by rule. Signed when they cost
 * it no more than it will bear; countered with the dearest dropped when a
 * little beyond; refused, or after `WALK_OUT_AFTER_SESSIONS` walked out on,
 * when far beyond. The next session sits after an envoy's journey.
 */
export function putTerms(
  world: WorldState,
  tableId: string,
  byPolityId: string,
  terms: readonly PeaceTerm[],
  context: Omit<ApplyContext, "actorRef">,
  offices: readonly Office[],
  speakerId: string,
): TableTurn {
  const day = world.instant.day;
  const table = world.peaceTables.find((candidate) => candidate.id === tableId);
  const refuse = (refusal: string): TableTurn => ({ world, facts: [], answer: "refused", words: refusal, refusal });
  if (table === undefined || table.status !== "open") return refuse("There is no peace table sitting.");
  if (!table.sides.includes(byPolityId)) return refuse(`${nameOf(world, byPolityId)} is not at this table.`);
  if (day < table.nextSessionStep) return refuse(`The envoys are still on the road: the next session sits in ${table.nextSessionStep - day} days.`);
  const giver = table.sides[0] === byPolityId ? table.sides[1] : table.sides[0];
  const price = termsPrice(world, terms, giver, byPolityId);
  const bear = willBear(world, table, giver, offices);
  const representativeId = diplomaticAnswererOf(world, giver, offices, speakerId);
  const capital = (polityId: string): string | null => {
    const city = world.map.polities.find((polity) => polity.id === polityId)?.capitalSettlementId ?? null;
    return city === null ? null : world.map.provinces.find((province) => province.settlements.some((settlement) => settlement.id === city))?.id ?? null;
  };
  const [here, there] = [capital(byPolityId), capital(giver)];
  const nextSession = day + Math.max(SESSION_MIN_DAYS, here === null || there === null ? 15 : newsDaysBetween(world, here, there));
  const session = (answer: TableTurn["answer"], words: string) => ({ atStep: day, byPolityId, terms: [...terms], price, answer, words: words.slice(0, 400) });
  const withSession = (state: WorldState, answer: TableTurn["answer"], words: string, status: PeaceTable["status"] = "open"): WorldState => ({
    ...state,
    peaceTables: state.peaceTables.map((candidate) => (candidate.id === tableId
      ? { ...candidate, sessions: [...candidate.sessions, session(answer, words)].slice(-40), nextSessionStep: nextSession, status, closedAtStep: status === "open" ? null : day }
      : candidate)),
  });

  if (price <= bear && representativeId !== null) {
    // Signed: occupied ground given back first, then the peace and what stands beside it.
    const { clauses, besides, returned } = treatyOf(world, terms, giver, byPolityId);
    const back = new Set(returned);
    const handedBack: WorldState = back.size === 0 ? world : {
      ...world,
      map: { ...world.map, provinces: world.map.provinces.map((province) => (back.has(province.id) && province.ownerPolityId != null ? { ...province, controllerPolityId: province.ownerPolityId, ownerPolityId: null } : province)) },
    };
    const bought = table.bribes.filter((bribe) => bribe.outcome === "taken" && world.characters.find((character) => character.id === bribe.toCharacterId)?.polityId === giver).reduce((sum, bribe) => sum + bribe.points, 0);
    const outcome = concludePeace(handedBack, {
      proposerPolityId: byPolityId, otherPolityId: giver, clauses, terms: termsInWords(world, terms, giver, byPolityId),
      representativeId, speakerId,
    }, context, offices, bought);
    if (!outcome.made) return { ...refuse(outcome.refusal ?? "The envoys could not agree."), world: withSession(world, "refused", outcome.refusal ?? "The envoys could not agree.") };
    const after = besides.length === 0 ? outcome.world : applyDeltas(outcome.world, besides, { ...context, actorRef: { kind: "character", id: speakerId }, actsForTheWorld: true }).world;
    const words = "These terms we can carry home. It is peace.";
    return { world: withSession(after, "accepted", words, "signed"), facts: [...outcome.facts], answer: "accepted", words, refusal: null };
  }
  if (table.sessions.length + 1 >= WALK_OUT_AFTER_SESSIONS && price > WALK_OUT_AT * Math.max(1, bear)) {
    const words = `${nameOf(world, giver)} will not be insulted a third time. Our envoys are going home, and the war goes on.`;
    return {
      world: withSession(world, "walked_out", words, "walked_out"),
      facts: [{
        localId: `walked_out_${tableId}`.slice(0, 60), kind: "peace_talks_failed",
        summary: `The envoys of ${nameOf(world, giver)} walked out of the peace talks with ${nameOf(world, byPolityId)}: what was asked was more than their war has cost them.`.slice(0, 400),
        affectedRefs: [{ kind: "polity", id: giver }, { kind: "polity", id: byPolityId }],
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 55,
      }],
      answer: "walked_out", words, refusal: words,
    };
  }
  const words = price > bear * 1.5
    ? `Terms like these are for a power that has won. ${nameOf(world, giver)} has not been beaten.`
    : `Less than this, and we can talk. ${nameOf(world, giver)} will not give all of it.`;
  // What they would sign: the asker's terms, dearest dropped until they fit.
  const counter: PeaceTerm[] = [];
  let room = bear;
  for (const term of [...terms].sort((a, b) => termPrice(world, a, giver, byPolityId) - termPrice(world, b, giver, byPolityId))) {
    const cost = termPrice(world, term, giver, byPolityId);
    if (cost <= room) { counter.push(term); room -= cost; }
  }
  const answer = price > bear * 1.5 ? "refused" as const : "countered" as const;
  let next = withSession(world, answer, words);
  next = { ...next, peaceTables: next.peaceTables.map((candidate) => (candidate.id === tableId
    ? { ...candidate, sessions: candidate.sessions.map((entry, index) => (index === candidate.sessions.length - 1 ? { ...entry, counterTerms: counter } : entry)) }
    : candidate)) };
  // And, where the war is going their way, what they ask in turn.
  const theirs = demandsOf(next, next.peaceTables.find((candidate) => candidate.id === tableId)!, giver, offices);
  if (theirs.length > 0) {
    next = { ...next, peaceTables: next.peaceTables.map((candidate) => (candidate.id === tableId
      ? { ...candidate, sessions: [...candidate.sessions, { atStep: day, byPolityId: giver, terms: theirs, price: termsPrice(next, theirs, byPolityId, giver), answer: null, words: `${nameOf(world, giver)} asks this instead.` }].slice(-40) }
      : candidate)) };
  }
  return { world: next, facts: [], answer, words, refusal: null };
}

/**
 * The player's power takes the other side's latest demands: the treaty they
 * asked for is signed, with the player as the man who agreed to it.
 */
export function acceptDemands(world: WorldState, tableId: string, acceptingPolityId: string, context: Omit<ApplyContext, "actorRef">, offices: readonly Office[], acceptorId: string): TableTurn {
  const table = world.peaceTables.find((candidate) => candidate.id === tableId);
  const refuse = (refusal: string): TableTurn => ({ world, facts: [], answer: "refused", words: refusal, refusal });
  if (table === undefined || table.status !== "open") return refuse("There is no peace table sitting.");
  const asker = table.sides[0] === acceptingPolityId ? table.sides[1] : table.sides[0];
  const demand = [...table.sessions].reverse().find((session) => session.byPolityId === asker && session.answer === null);
  if (demand === undefined) return refuse(`${nameOf(world, asker)} has asked for nothing yet.`);
  const speakerId = diplomaticAnswererOf(world, asker, offices) ?? acceptorId;
  const { clauses, besides, returned } = treatyOf(world, demand.terms, acceptingPolityId, asker);
  const back = new Set(returned);
  const handedBack: WorldState = back.size === 0 ? world : {
    ...world,
    map: { ...world.map, provinces: world.map.provinces.map((province) => (back.has(province.id) && province.ownerPolityId != null ? { ...province, controllerPolityId: province.ownerPolityId, ownerPolityId: null } : province)) },
  };
  // What the player agrees to on his own side's behalf is not bargained against him: it bears all of it.
  const outcome = concludePeace(handedBack, {
    proposerPolityId: asker, otherPolityId: acceptingPolityId, clauses, terms: termsInWords(world, demand.terms, acceptingPolityId, asker),
    representativeId: acceptorId, speakerId,
  }, context, offices, 1_000);
  if (!outcome.made) return refuse(outcome.refusal ?? "The treaty could not be made.");
  const after = besides.length === 0 ? outcome.world : applyDeltas(outcome.world, besides, { ...context, actorRef: { kind: "character", id: speakerId }, actsForTheWorld: true }).world;
  const signed: WorldState = {
    ...after,
    peaceTables: after.peaceTables.map((candidate) => (candidate.id === tableId
      ? { ...candidate, status: "signed" as const, closedAtStep: world.instant.day, sessions: candidate.sessions.map((session) => (session === demand ? { ...session, answer: "accepted" as const, words: "Agreed." } : session)) }
      : candidate)),
  };
  return { world: signed, facts: [...outcome.facts], answer: "accepted", words: "Agreed.", refusal: null };
}

/**
 * Money for a man at the table. Who takes it: the greedy always, the honest
 * never, the rest by a roll on their honesty. Taken, it moves what his side
 * will bear by up to fifteen points; refused by an honest man, it is found
 * out; taken carelessly, sometimes found out anyway, and the briber's
 * standing pays for it.
 */
export function bribeAtTable(world: WorldState, tableId: string, briberId: string, targetId: string, amount: number): { world: WorldState; facts: FactProposalDraft[]; outcome: "taken" | "refused" | "found_out"; refusal: string | null } {
  const day = world.instant.day;
  const table = world.peaceTables.find((candidate) => candidate.id === tableId);
  const briber = world.characters.find((character) => character.id === briberId);
  const target = world.characters.find((character) => character.id === targetId && character.alive);
  const nothing = (refusal: string) => ({ world, facts: [], outcome: "refused" as const, refusal });
  if (table === undefined || table.status !== "open") return nothing("There is no peace table sitting.");
  if (briber === undefined || target === undefined) return nothing("There is nobody of that name at the table.");
  if (target.polityId === null || !table.sides.includes(target.polityId)) return nothing(`${target.name} has no voice at this table.`);
  const purse = world.material.accounts.find((account) => account.id === briber.personalAccountId);
  if (purse === undefined || purse.balance < amount || amount <= 0) return nothing("You have not that much to give.");
  const honesty = target.mind.temperament.honesty;
  const roll = stableHash([tableId, briberId, targetId, String(day)]) % 100;
  const greedy = target.traits.includes("greedy") || target.traits.includes("treacherous");
  const takes = greedy || (honesty < 70 && roll >= honesty);
  const caught = !takes || (!greedy && roll % 4 === 0);
  const wealth = world.material.accounts.find((account) => account.id === target.personalAccountId)?.balance ?? 0;
  const points = takes ? Math.min(15, Math.max(1, Math.round((amount / Math.max(100, wealth * 0.2)) * 5))) : 0;
  const outcome: "taken" | "refused" | "found_out" = takes ? (caught ? "found_out" : "taken") : "refused";
  const moved = takes ? world.material.accounts.map((account) => (account.id === purse.id ? { ...account, balance: account.balance - amount }
    : account.id === target.personalAccountId ? { ...account, balance: account.balance + amount } : account)) : world.material.accounts;
  const next: WorldState = {
    ...world,
    material: { ...world.material, accounts: moved },
    characters: caught ? world.characters.map((character) => (character.id === briberId ? { ...character, prestigeBps: Math.max(0, character.prestigeBps - 500) } : character)) : world.characters,
    peaceTables: world.peaceTables.map((candidate) => (candidate.id === tableId
      ? { ...candidate, bribes: [...candidate.bribes, { atStep: day, byCharacterId: briberId, toCharacterId: targetId, amount, outcome, points: outcome === "taken" ? points : 0 }].slice(-20) }
      : candidate)),
  };
  const facts: FactProposalDraft[] = caught ? [{
    localId: `bribe_${tableId}_${day}`.slice(0, 60), kind: "scandal",
    summary: takes
      ? `It is said ${briber.name} paid ${target.name} to soften the terms at the peace table.`.slice(0, 400)
      : `${target.name} refused ${possessive(briber.name)} money at the peace table, and said so.`.slice(0, 400),
    affectedRefs: [{ kind: "character", id: briberId }, { kind: "character", id: targetId }],
    visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 50,
  }] : [];
  return { world: next, facts, outcome, refusal: null };
}

// ── What the player sees of it ───────────────────────────────────────────────

export interface PeaceTermOption {
  /** The term itself, to send back when chosen. */
  readonly term: PeaceTerm;
  readonly label: string;
  /** What it costs the other side, by the table's prices. */
  readonly price: number;
  readonly group: "ground" | "money" | "power" | "people";
}

export interface PeaceSessionView {
  readonly when: string;
  readonly byLabel: string;
  readonly ours: boolean;
  readonly terms: readonly string[];
  readonly price: number;
  readonly answer: string | null;
  readonly words: string | null;
}

export interface PeaceTableView {
  readonly id: string;
  readonly theirLabel: string;
  readonly status: PeaceTable["status"];
  /** How the war stands from our side, -100 to 100, and what it rests on. */
  readonly warScore: number;
  readonly warParts: readonly string[];
  /** What they will bear of what we ask, and we of theirs. */
  readonly weCanAsk: number;
  readonly theyCanAsk: number;
  /** Days until the next session can sit; 0 is now. */
  readonly nextSessionInDays: number;
  readonly sessions: readonly PeaceSessionView[];
  /** Their latest demand of us, unanswered. */
  readonly theirDemand: { readonly terms: readonly string[]; readonly price: number } | null;
  /** What they said they would sign of our last terms. */
  readonly counterOffer: { readonly terms: readonly PeaceTerm[]; readonly labels: readonly string[]; readonly price: number } | null;
  readonly catalogue: readonly PeaceTermOption[];
  /** The men at the table, for a purse that would buy one. */
  readonly negotiators: readonly { readonly id: string; readonly name: string; readonly sideLabel: string; readonly ours: boolean }[];
  readonly bribes: readonly { readonly when: string; readonly toName: string; readonly amount: number; readonly outcome: string }[];
}

export interface PeaceTablesView {
  /** Whether the viewer speaks for his power at the table, or may only watch and pay. */
  readonly speaks: boolean;
  readonly purse: number;
  readonly tables: readonly PeaceTableView[];
  /** Wars his power is in with no table yet: talks may be proposed. */
  readonly wars: readonly { readonly enemyId: string; readonly label: string; readonly warScore: number }[];
}

/** Whether a man may put terms for his power: its ruler, or the man who answers its letters. */
export function speaksForAtTable(world: WorldState, characterId: string, offices: readonly Office[]): boolean {
  const character = world.characters.find((candidate) => candidate.id === characterId);
  if (character?.polityId == null) return false;
  if (world.constitutions?.some((constitution) => constitution.polityId === character.polityId) === true) {
    const ruler = world.constitutions.find((constitution) => constitution.polityId === character.polityId)?.rulerOfficeId ?? null;
    if (ruler !== null && world.material.officeSeats.some((seat) => seat.officeId === ruler && seat.holderCharacterId === characterId && seat.status === "held")) return true;
  }
  return diplomaticAnswererOf(world, character.polityId, offices) === characterId;
}

export function readPeaceTables(world: WorldState, characterId: string, offices: readonly Office[], dateOf: (day: number) => string = (day) => `day ${day}`): PeaceTablesView {
  const character = world.characters.find((candidate) => candidate.id === characterId);
  const ours = character?.polityId ?? null;
  const purse = world.material.accounts.find((account) => account.id === character?.personalAccountId)?.balance ?? 0;
  if (ours === null) return { speaks: false, purse, tables: [], wars: [] };
  const day = world.instant.day;
  const tables = world.peaceTables.filter((table) => table.sides.includes(ours) && (table.status === "open" || (table.closedAtStep !== null && day - table.closedAtStep <= 60)));
  const views: PeaceTableView[] = tables.map((table) => {
    const theirs = table.sides[0] === ours ? table.sides[1] : table.sides[0];
    const standing = warStanding(world, ours, theirs);
    const say = (terms: readonly PeaceTerm[], giver: string, taker: string): string[] => terms.map((term) => termLabel(world, term, giver, taker));
    const demand = [...table.sessions].reverse().find((session) => session.byPolityId === theirs && session.answer === null);
    const lastOurs = [...table.sessions].reverse().find((session) => session.byPolityId === ours);
    const counter = lastOurs?.answer === "countered" && (lastOurs.counterTerms?.length ?? 0) > 0 ? lastOurs.counterTerms! : null;
    const people = [ours, theirs].map((side) => ({ side, id: diplomaticAnswererOf(world, side, offices) })).filter((entry): entry is { side: string; id: string } => entry.id !== null && entry.id !== characterId);
    return {
      id: table.id,
      theirLabel: nameOf(world, theirs),
      status: table.status,
      warScore: standing.score,
      warParts: standing.parts,
      weCanAsk: willBear(world, table, theirs, offices),
      theyCanAsk: willBear(world, table, ours, offices),
      nextSessionInDays: Math.max(0, table.nextSessionStep - day),
      sessions: table.sessions.map((session) => ({
        when: dateOf(session.atStep),
        byLabel: nameOf(world, session.byPolityId),
        ours: session.byPolityId === ours,
        terms: say(session.terms, session.byPolityId === ours ? theirs : ours, session.byPolityId),
        price: session.price,
        answer: session.answer,
        words: session.words,
      })),
      theirDemand: demand === undefined ? null : { terms: say(demand.terms, ours, theirs), price: termsPrice(world, demand.terms, ours, theirs) },
      counterOffer: counter === null ? null : { terms: counter, labels: say(counter, theirs, ours), price: termsPrice(world, counter, theirs, ours) },
      catalogue: catalogueFor(world, ours, theirs),
      negotiators: people.map((entry) => ({ id: entry.id, name: world.characters.find((candidate) => candidate.id === entry.id)?.name ?? entry.id, sideLabel: nameOf(world, entry.side), ours: entry.side === ours })),
      bribes: table.bribes.filter((bribe) => bribe.byCharacterId === characterId).map((bribe) => ({ when: dateOf(bribe.atStep), toName: world.characters.find((candidate) => candidate.id === bribe.toCharacterId)?.name ?? bribe.toCharacterId, amount: bribe.amount, outcome: bribe.outcome })),
    };
  });
  const seated = new Set(world.peaceTables.filter((table) => table.status === "open").map((table) => table.warId));
  const wars = world.polityAgreements
    .filter((agreement) => agreement.status === "active" && agreement.kind === "war" && [agreement.polityId, agreement.otherPolityId].includes(ours) && !seated.has(agreement.id))
    .map((agreement) => {
      const enemy = agreement.polityId === ours ? agreement.otherPolityId : agreement.polityId;
      return { enemyId: enemy, label: nameOf(world, enemy), warScore: warStanding(world, ours, enemy).score };
    });
  return { speaks: speaksForAtTable(world, characterId, offices), purse, tables: views, wars };
}

/** A term in the words the table uses. */
export function termLabel(world: WorldState, term: PeaceTerm, giver: string, taker: string): string {
  const province = (id: string): string => world.map.provinces.find((candidate) => candidate.id === id)?.name ?? id;
  switch (term.kind) {
    case "cede": return `${province(term.provinceId)} to ${nameOf(world, taker)}`;
    case "return": return `${province(term.provinceId)} given back to ${nameOf(world, taker)}`;
    case "indemnity": return `${term.amount} a year for ${term.periods} years from ${nameOf(world, giver)}`;
    case "hostage": return `${world.characters.find((character) => character.id === term.characterId)?.name ?? "a hostage"} as a hostage`;
    case "submission": return `${nameOf(world, giver)} gives itself up to ${nameOf(world, taker)}`;
    case "tribute": return `${nameOf(world, giver)} pays tribute`;
    case "break_alliance": return `${nameOf(world, giver)} gives up its alliance with ${nameOf(world, term.withPolityId)}`;
    case "client": return `${nameOf(world, giver)} under ${possessive(nameOf(world, taker))} protection`;
    case "demilitarize": return `no army of ${possessive(nameOf(world, giver))} in ${province(term.provinceId)}`;
    case "trade": return `${possessive(nameOf(world, giver))} markets opened to ${nameOf(world, taker)}`;
  }
}

/** Everything we might ask of them, priced: the ground we hold of theirs first, then money, power and people. */
function catalogueFor(world: WorldState, ours: string, theirs: string): PeaceTermOption[] {
  const option = (term: PeaceTerm, group: PeaceTermOption["group"]): PeaceTermOption => ({ term, label: termLabel(world, term, theirs, ours), price: termPrice(world, term, theirs, ours), group });
  const options: PeaceTermOption[] = [];
  const claimed = new Set((world.map.claimRecords ?? []).filter((claim) => claim.status === "active" && claim.claimantPolityId === ours).map((claim) => claim.locationId));
  const theirGround = world.map.provinces.filter((province) => ownerOf(province) === theirs);
  const held = theirGround.filter((province) => province.controllerPolityId === ours);
  const wanted = theirGround.filter((province) => province.controllerPolityId !== ours && (claimed.has(province.id) || province.settlements.length > 0)).slice(0, 12);
  for (const province of [...held.slice(0, 24), ...wanted]) options.push(option({ kind: "cede", provinceId: province.id }, "ground"));
  for (const province of world.map.provinces.filter((candidate) => candidate.ownerPolityId === ours && candidate.controllerPolityId === theirs).slice(0, 24)) options.push(option({ kind: "return", provinceId: province.id }, "ground"));
  const chest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === theirs && account.status === "active");
  for (const share of [0.05, 0.15]) {
    const amount = Math.max(10, Math.round(Math.max(0, chest?.balance ?? 0) * share));
    options.push(option({ kind: "indemnity", amount, periods: 3 }, "money"));
  }
  options.push(option({ kind: "tribute" }, "money"), option({ kind: "trade" }, "money"));
  options.push(option({ kind: "client" }, "power"));
  for (const alliance of world.polityAgreements.filter((agreement) => agreement.status === "active" && agreement.kind === "alliance" && [agreement.polityId, agreement.otherPolityId].includes(theirs)).slice(0, 4)) {
    options.push(option({ kind: "break_alliance", withPolityId: alliance.polityId === theirs ? alliance.otherPolityId : alliance.polityId }, "power"));
  }
  if (warStanding(world, ours, theirs).dictates) options.push(option({ kind: "submission" }, "power"));
  const border = theirGround.filter((province) => world.map.edges.some((edge) => (edge.from === province.id || edge.to === province.id)
    && ownerOf(world.map.provinces.find((candidate) => candidate.id === (edge.from === province.id ? edge.to : edge.from)) ?? { controllerPolityId: null, ownerPolityId: null }) === ours)).slice(0, 3);
  for (const province of border) options.push(option({ kind: "demilitarize", provinceId: province.id }, "power"));
  const hostages = world.characters.filter((character) => character.alive && character.polityId === theirs && character.prestigeBps >= 5_000).slice(0, 3);
  for (const hostage of hostages) options.push(option({ kind: "hostage", characterId: hostage.id }, "people"));
  return options.filter((entry) => entry.price > 0);
}
