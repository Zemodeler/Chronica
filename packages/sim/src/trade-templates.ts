import { WorldDeltaSchema, type WorldDelta, type WorldState } from "@chronica/shared";
import { receiverOf } from "./defection";
import { BID_KIND, LEAST_BID_BPS, MOST_BID_BPS, houseOfHead, type BidTarget } from "./bids";
import { CONTRACTOR_GAIN_BPS } from "./public-works";
import { MARGIN_BPS } from "./army-victualling";
import { safeLocalId } from "./safe-local-id";

/**
 * Two orders a private man gives that the engine reads by rule (docs/plans/playtest-fixes.md, batch 3):
 *
 *   bid        "bid for the army's bread", "take the contract for the temple", "tender for the road at 9 percent"   -> a bid of the firm he heads (`bids.ts`)
 *   refuge     "seek refuge with Rome", "go over to Carthage"                                                       -> the man goes over: `character_state_set` (`defection.ts`)
 *
 * Both return the same shape the other templates do (`order-templates.ts` reads them as clauses).
 */

export interface TradeClause {
  readonly part: { readonly said: string; readonly whyNot?: string | null };
  readonly note?: string;
  readonly deltas: readonly WorldDelta[];
  readonly delegations: readonly never[];
  readonly template: string;
  readonly domain: string;
}

const WORK_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\btemples?\b/i, "temple"], [/\broads?\b|\bcauseway\b/i, "road"], [/\baqueducts?\b/i, "aqueduct"], [/\bwalls?\b/i, "walls"], [/\bharbou?rs?\b|\bdocks?\b/i, "harbour"],
  [/\bgranar(?:y|ies)\b|\bhorrea\b/i, "granary"], [/\bforum\b|\bbasilica\b/i, "forum"],
];

/** "bid for the army's bread" and "take the contract for the temple": a firm's bid for the state's letting. */
export function bidClause(world: WorldState, playerId: string, text: string): TradeClause | null {
  const said = text.trim();
  if (!/^(?:please\s+)?(?:(?:put\s+in\s+a\s+)?(?:bid|tender)\s+for|tender\s+for|take\s+(?:up\s+)?the\s+contract\s+(?:for|to)|undertake\s+the\s+contract\s+(?:for|to)|contract\s+to)\b/i.test(said)) return null;
  const work = WORK_WORDS.find(([word]) => word.test(said))?.[1] ?? null;
  const bread = /\b(?:bread|grain|victual(?:s|ling)?|supply|supplies|feed|provision(?:s|ing)?|army|armies|legions?)\b/i.test(said);
  if (work === null && !bread) return null;
  const target: BidTarget = work !== null ? "public_work" : "army_bread";
  const player = world.characters.find((character) => character.id === playerId);
  if (player?.polityId == null) return null;
  const house = houseOfHead(world, playerId);
  if (house === undefined) {
    return { part: { said: said.slice(0, 200), whyNot: `${player.name} heads no firm to bid with: the state lets its contracts to companies, and a man alone has no company to let them to. Found a firm first.` }, deltas: [], delegations: [], template: "bid", domain: "trade" };
  }
  const usual = target === "public_work" ? CONTRACTOR_GAIN_BPS : MARGIN_BPS;
  const named = /\bat\s+(\d+(?:\.\d+)?)\s*(?:%|per\s*cent|percent|in\s+a\s+hundred)/i.exec(said);
  const asked = named === null ? usual - 300 : Math.round(Number(named[1]) * 100);
  const margin = Math.max(LEAST_BID_BPS, Math.min(MOST_BID_BPS, asked));
  const label = `${house.name}'s bid for ${target === "army_bread" ? "the army's bread" : `the ${work} works`}`.slice(0, 120);
  return {
    part: { said: said.slice(0, 200) },
    deltas: [WorldDeltaSchema.parse({
      op: "generic_entity_create", localId: safeLocalId(`bid_${house.id}_${target}_${work ?? "any"}`).slice(0, 60), kind: BID_KIND, label,
      ownerRef: { kind: "character", id: playerId }, attributes: { target, houseId: house.id, bidderId: playerId, marginBps: margin, work: work ?? "", untilStep: world.elapsedStep + 365 },
      reason: `${house.name} puts in a bid for ${target === "army_bread" ? "feeding the army" : `the ${work} the state lets`}, at ${(margin / 100).toFixed(margin % 100 === 0 ? 0 : 1)} in the hundred over cost.`.slice(0, 240),
    })],
    delegations: [], template: "bid", domain: "trade",
    note: `${house.name} has put in a bid at ${(margin / 100).toFixed(margin % 100 === 0 ? 0 : 1)} in the hundred over cost; the state takes the best bid when it lets the work, and you will be told how it went.`,
  };
}

/** "Seek refuge with Rome": a man goes over to another power, to be received or turned away by its ruler (`defection.ts`). */
export function refugeClause(world: WorldState, playerId: string, text: string): TradeClause | null {
  const said = text.trim();
  if (!/^(?:please\s+)?(?:(?:seek|ask\s+for|claim|take|find)\s+(?:refuge|asylum|shelter|protection|sanctuary)|go\s+over|defect|desert|flee)\b/i.test(said)) return null;
  const player = world.characters.find((character) => character.id === playerId);
  if (player?.polityId == null) return null;
  // A power is named by its own name, its id, or its capital ("Rome", "the Roman Republic", "Carthage").
  const phrasesOf = (polity: WorldState["map"]["polities"][number]): string[] => {
    const capital = polity.capitalSettlementId == null ? undefined : world.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === polity.capitalSettlementId)?.name;
    return [polity.id, polity.name, polity.name.replace(/^(?:the\s+)?(?:Roman\s+Republic|Republic of|Kingdom of|City of)\s*/i, ""), capital ?? ""].filter((phrase) => phrase.length >= 3);
  };
  const padded = ` ${said} `;
  const named = world.map.polities
    .filter((polity) => polity.id !== player.polityId && polity.endedAtStep == null && phrasesOf(polity).some((phrase) => padded.toLowerCase().includes(phrase.toLowerCase())))
    .sort((a2, b2) => b2.name.length - a2.name.length)[0];
  if (named === undefined) return null;
  if (receiverOf(world, named.id, playerId) === undefined) {
    return { part: { said: said.slice(0, 200), whyNot: `${named.name} has nobody to receive ${player.name}.` }, deltas: [], delegations: [], template: "refuge", domain: "diplomacy" };
  }
  return {
    part: { said: said.slice(0, 200) },
    deltas: [WorldDeltaSchema.parse({ op: "character_state_set", characterRef: playerId, polityId: named.id, reason: `${player.name} seeks refuge with ${named.name}, and goes over.`.slice(0, 240) })],
    delegations: [], template: "refuge", domain: "diplomacy",
  };
}
