import { GenericEntitySchema, economyOf, type FactProposalDraft, type MerchantHouse, type WorldState } from "@chronica/shared";
import { capitalOfHouse } from "./merchant-houses";
import { safeLocalId } from "./safe-local-id";

/**
 * A private man's firm bids for the state's contracts (docs/plans/playtest-fixes.md, batch 3).
 *
 * A merchant who tried to bid for the harbour dues was told the money was "not his to promise", and the victualling of an army was let by the engine to a
 * house it picked by lot among those of the power. Rome let both to private men and their companies (*societates publicanorum*): the censors let the works
 * and the contracts at the lustrum to the best bidder, the consuls' armies were fed by the contractors of the Senate (Livy 23.48-49). A man who heads a
 * trading house may now put in a bid, in words the order templates read ("bid for the army's bread", "take the contract for the temple"), a margin over cost; the
 * contract goes by rule to the best bid: the lowest margin, the better for a firm that has not lost its cargoes and for one with the capital to see the
 * work through. A firm that put in no bid is a bidder at the usual margin, so a bid at the usual margin does not beat the old lot. Bids lapse in a year.
 *
 * Not the tribute: the farming of a province's tithe is Hiero's (the lex Hieronica, which Syracuse had and Rome kept in Sicily after 241), and the Roman
 * farming of the provincial dues is not in use in 270; where a power farms its customs or its tithe, its collectors are the engine's and not a bid of the
 * player's.
 */

export const BID_KIND = "contract_bid";
export type BidTarget = "army_bread" | "public_work";
/** The least and most margin over cost a bid may be, in basis points. */
export const LEAST_BID_BPS = 300;
export const MOST_BID_BPS = 3_000;
/** A bid lapses after this long. */
export const BID_DAYS = 365;

export interface Bid {
  readonly entityId: string;
  readonly houseId: string;
  readonly bidderId: string;
  readonly target: BidTarget;
  readonly marginBps: number;
  /** The kind of work asked for ("temple", "road"), or none for any. */
  readonly work: string | null;
}

/** The standing bids for a kind of contract, of the houses that are trading. */
export function standingBids(world: Pick<WorldState, "genericEntities" | "economy" | "elapsedStep">, target: BidTarget, work: string | null = null): Bid[] {
  const houses = new Map((world.economy?.houses ?? []).filter((house) => house.status === "trading").map((house) => [house.id, house]));
  const out: Bid[] = [];
  for (const entity of world.genericEntities) {
    if (entity.kind !== BID_KIND || "retiredAtStep" in (entity.attributes ?? {}) || entity.attributes?.["target"] !== target) continue;
    const until = Number(entity.attributes?.["untilStep"]);
    if (Number.isFinite(until) && until < world.elapsedStep) continue;
    const houseId = String(entity.attributes?.["houseId"] ?? "");
    const asked = entity.attributes?.["work"];
    if (!houses.has(houseId) || (typeof asked === "string" && asked !== "" && work !== null && asked !== work)) continue;
    out.push({ entityId: entity.id, houseId, bidderId: String(entity.attributes?.["bidderId"] ?? ""), target, marginBps: Number(entity.attributes?.["marginBps"]), work: typeof asked === "string" && asked !== "" ? asked : null });
  }
  return out;
}

/** What a house's record counts against its bid: its losses and its want of capital, in basis points. */
function riskOf(world: WorldState, house: MerchantHouse): number {
  const lossShare = house.voyages + house.losses === 0 ? 0 : (house.losses * 10_000) / (house.voyages + house.losses);
  const capital = capitalOfHouse(world, house);
  return Math.round(lossShare / 10) + Math.max(0, 200 - Math.round(capital / 1_000));
}

export interface Awarded {
  readonly house: MerchantHouse;
  readonly marginBps: number;
  readonly bids: number;
  readonly beaten: readonly Bid[];
  readonly bid: Bid | null;
}

/**
 * The house that takes a contract, and at what margin: the best of the standing bids if it beats the usual margin (house for house, the reliable first),
 * else null, and the old lot decides among the houses.
 */
export function awardByBids(world: WorldState, target: BidTarget, houses: readonly MerchantHouse[], usualMarginBps: number, work: string | null = null): Awarded | null {
  const bids = standingBids(world, target, work).filter((bid) => houses.some((house) => house.id === bid.houseId));
  if (bids.length === 0) return null;
  const scored = bids
    .map((bid) => ({ bid, house: houses.find((house) => house.id === bid.houseId)!, score: bid.marginBps + riskOf(world, houses.find((house) => house.id === bid.houseId)!) }))
    .sort((a, b) => a.score - b.score || a.bid.marginBps - b.bid.marginBps || a.bid.houseId.localeCompare(b.bid.houseId));
  const best = scored[0]!;
  if (best.bid.marginBps >= usualMarginBps) return null;
  return { house: best.house, marginBps: best.bid.marginBps, bids: bids.length + Math.max(0, houses.length - bids.length), beaten: scored.slice(1).map((entry) => entry.bid), bid: best.bid };
}

/** Puts a bid on the record; a house has one bid for one kind of contract at a time. */
export function putInABid(world: WorldState, house: MerchantHouse, target: BidTarget, marginBps: number, work: string | null, atStep: number): WorldState {
  const margin = Math.max(LEAST_BID_BPS, Math.min(MOST_BID_BPS, Math.round(marginBps)));
  const id = safeLocalId(`bid_${house.id}_${target}_${work ?? "any"}`).slice(0, 100);
  const entity = GenericEntitySchema.parse({
    id, kind: BID_KIND, label: `${house.name}'s bid for ${target === "army_bread" ? "the army's bread" : `the ${work ?? "public"} works`}`.slice(0, 120), ownerRef: { kind: "character", id: house.headCharacterId },
    attributes: { target, houseId: house.id, bidderId: house.headCharacterId, marginBps: margin, work: work ?? "", untilStep: atStep + BID_DAYS }, createdAtStep: atStep,
  });
  return { ...world, genericEntities: [...world.genericEntities.filter((candidate) => candidate.id !== id), entity] };
}

/** The bids of a lot are spent: the winner's is retired, and every man who bid is told how it went. */
export function settleBids(world: WorldState, awarded: Awarded, what: string, atStep: number): { world: WorldState; facts: FactProposalDraft[] } {
  const spent = new Set([awarded.bid?.entityId, ...awarded.beaten.map((bid) => bid.entityId)].filter((id): id is string => id !== undefined));
  const facts: FactProposalDraft[] = [];
  const lost = awarded.beaten;
  if (awarded.bid !== null) {
    facts.push({
      localId: safeLocalId(`bid_won_${awarded.bid.entityId}_${atStep}`).slice(0, 60), kind: "bid_won",
      summary: `${awarded.house.name} won ${what}: its bid of ${(awarded.marginBps / 100).toFixed(awarded.marginBps % 100 === 0 ? 0 : 1)} in the hundred over cost was the best of ${awarded.bids}.`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: awarded.house.headCharacterId }],
      knownToRefs: [{ kind: "character", id: awarded.house.headCharacterId }], visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 40,
    });
  }
  for (const bid of lost) {
    facts.push({
      localId: safeLocalId(`bid_lost_${bid.entityId}_${atStep}`).slice(0, 60), kind: "bid_lost",
      summary: `Your bid for ${what}, at ${(bid.marginBps / 100).toFixed(bid.marginBps % 100 === 0 ? 0 : 1)} in the hundred, was beaten: ${awarded.house.name} bid ${(awarded.marginBps / 100).toFixed(awarded.marginBps % 100 === 0 ? 0 : 1)}.`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: bid.bidderId }], knownToRefs: [{ kind: "character", id: bid.bidderId }], visibility: "private", discoveryState: "private", knowableInDays: 0, significance: 35,
    });
  }
  return {
    world: { ...world, genericEntities: world.genericEntities.map((entity) => (spent.has(entity.id) ? { ...entity, attributes: { ...entity.attributes, retiredAtStep: atStep } } : entity)) },
    facts,
  };
}

/** A house of a character's: the one he heads, if it is trading. */
export function houseOfHead(world: WorldState, characterId: string): MerchantHouse | undefined {
  return economyOf(world).houses.find((house) => house.status === "trading" && house.headCharacterId === characterId);
}

