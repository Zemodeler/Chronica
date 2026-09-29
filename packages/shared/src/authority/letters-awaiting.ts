import { buildStation, holdsPolityStanding } from "./station";
import type { Office } from "../characters/character";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import { AGREEMENT_KIND_IN_WORDS, type PolityAgreementKind } from "../world/agreements";
import { isDelivered, offeredAgreementKinds, type DiplomaticMessageKind } from "../world/diplomacy";

/**
 * Letters from other powers waiting on the player's answer.
 *
 * Offers, ultimatums and tribute demands sit in the world with a reply-by
 * date, and the model is shown them every turn; the player was not. Those
 * addressed to the player by name, and -- for someone who speaks for the
 * government -- those addressed to the power at large.
 */

export interface AwaitingLetter {
  readonly id: string;
  /** "An offer of alliance", "An ultimatum". */
  readonly kindLabel: string;
  readonly fromLabel: string;
  readonly fromPolityId: string;
  readonly fromCharacterId: string;
  readonly subject: string;
  readonly terms: string;
  readonly replyByLabel: string | null;
  readonly toYou: boolean;
  /** The agreements accepting it would make, so the reply can name the one taken up. */
  readonly offers: readonly { readonly kind: PolityAgreementKind; readonly label: string }[];
  /**
   * Whether it asks for a yes or a no -- an offer, a demand, a request -- and
   * not only for an answer. A letter that only says something is written back to.
   */
  readonly asksYesOrNo: boolean;
}

/** Kinds that ask for something, and are accepted or refused rather than only answered. */
const ASKS: ReadonlySet<DiplomaticMessageKind> = new Set([
  "alliance_offer", "peace_offer", "trade_offer", "marriage_offer", "military_aid_request", "tribute_demand", "ultimatum",
]);

const KIND_WORDS: Readonly<Record<DiplomaticMessageKind, string>> = {
  letter: "A letter",
  alliance_offer: "An offer of alliance",
  peace_offer: "An offer of peace",
  trade_offer: "An offer of trade",
  marriage_offer: "An offer of marriage",
  military_aid_request: "A request for troops",
  tribute_demand: "A demand for tribute",
  ultimatum: "An ultimatum",
  warning: "A warning",
  protest: "A protest",
  congratulation: "Congratulations",
};

/** "An offer of alliance", "A letter". */
export function letterKindLabel(kind: DiplomaticMessageKind): string {
  return KIND_WORDS[kind] ?? "A letter";
}

export function lettersAwaitingYou(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): readonly AwaitingLetter[] {
  if (characterId === null) return [];
  const station = buildStation({ world, characterId, offices });
  const governs = holdsPolityStanding(station);
  const polityName = (id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? "another power";
  return world.diplomacy
    .filter((message) => message.status === "awaiting_reply")
    // A letter still on the road has not reached the desk.
    .filter((message) => isDelivered(message, world.elapsedStep))
    .filter((message) => message.toCharacterId === characterId || (governs && message.toCharacterId === null && message.toPolityId === station.polityId))
    // The soonest answer due first; an open-ended one last.
    .sort((a, b) => (a.replyDueByStep ?? Number.MAX_SAFE_INTEGER) - (b.replyDueByStep ?? Number.MAX_SAFE_INTEGER))
    .map((message) => {
      const sender = world.characters.find((character) => character.id === message.fromCharacterId)?.name;
      return {
        id: message.id,
        kindLabel: letterKindLabel(message.kind),
        fromLabel: sender === undefined ? polityName(message.fromPolityId) : `${sender}, for ${polityName(message.fromPolityId)}`,
        fromPolityId: message.fromPolityId,
        fromCharacterId: message.fromCharacterId,
        subject: message.subject,
        terms: message.terms,
        replyByLabel: message.replyDueByStep === null ? null : clock === undefined ? `day ${message.replyDueByStep}` : formatWorldDate({ day: message.replyDueByStep, minute: 0 }, clock),
        toYou: message.toCharacterId === characterId,
        offers: offeredAgreementKinds(message).map((kind) => ({ kind, label: AGREEMENT_KIND_IN_WORDS[kind] })),
        asksYesOrNo: ASKS.has(message.kind) || offeredAgreementKinds(message).length > 0 || message.onRefusal != null,
      };
    });
}
