import { buildStation, holdsPolityStanding } from "./station";
import type { Office } from "../characters/character";
import type { WorldState } from "../world/world-state";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

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
  readonly subject: string;
  readonly terms: string;
  readonly replyByLabel: string | null;
  readonly toYou: boolean;
}

const KIND_WORDS: Readonly<Record<string, string>> = {
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
    .filter((message) => message.toCharacterId === characterId || (governs && message.toCharacterId === null && message.toPolityId === station.polityId))
    // The soonest answer due first; an open-ended one last.
    .sort((a, b) => (a.replyDueByStep ?? Number.MAX_SAFE_INTEGER) - (b.replyDueByStep ?? Number.MAX_SAFE_INTEGER))
    .map((message) => {
      const sender = world.characters.find((character) => character.id === message.fromCharacterId)?.name;
      return {
        id: message.id,
        kindLabel: KIND_WORDS[message.kind] ?? "A letter",
        fromLabel: sender === undefined ? polityName(message.fromPolityId) : `${sender}, for ${polityName(message.fromPolityId)}`,
        subject: message.subject,
        terms: message.terms,
        replyByLabel: message.replyDueByStep === null ? null : clock === undefined ? `day ${message.replyDueByStep}` : formatWorldDate({ day: message.replyDueByStep, minute: 0 }, clock),
        toYou: message.toCharacterId === characterId,
      };
    });
}
