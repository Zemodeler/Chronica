import { WorldDeltaSchema, type Force, type RequestAsk, type ScenarioWarfareRules, type WorldDelta, type WorldState } from "@chronica/shared";
import { armyNamed, forcesUnder } from "./order-templates";
import { escapeForPattern, placeNamed } from "./place-named";

/**
 * The march template (docs/economy.md, "Orders, calls and consequences"): "march to Rhegium", "hold at Messana", "withdraw to Capua", "winter in Latium", for the army the
 * player names (or "my army", his only one). Read by rule like the supply, levy and build templates: no orchestrator call.
 *
 * The man who commands the army marches it by his own word. A man who has the army's control or heads its power and does not command it hands the march to the man who
 * does (a delegation with a `march` ask, carried out by `requests.ts` when that man says yes: a man of no account is answered by his temper, `order-by-rule.ts`). A man who
 * is only in the ranks has no army to march, and is told so.
 */

/** What a march order asks of the army. */
export type MarchKind = "march" | "withdraw" | "hold" | "winter";

export interface MarchClause {
  readonly part: { readonly said: string; readonly whyNot?: string | null };
  readonly note?: string;
  readonly deltas: readonly WorldDelta[];
  readonly delegations: readonly { readonly recipientId: string; readonly instruction: string; readonly ask: RequestAsk }[];
  readonly goals: readonly { readonly kind: "force_at"; readonly ref: string; readonly at: string }[];
  readonly template: string;
  readonly domain: string;
}

/** `bare`: a verb that is the army's alone ("withdraw to Capua"); the others ("go", "return", "stay") are a man's own movements unless an army is named. */
const VERBS: readonly { readonly kind: MarchKind; readonly word: RegExp; readonly bare: boolean }[] = [
  { kind: "march", word: /^(?:march|advance)\b/i, bare: true },
  { kind: "march", word: /^(?:proceed|ride|go|move|send)\b/i, bare: false },
  { kind: "withdraw", word: /^(?:withdraw|fall\s+back|retreat|pull\s+back)\b/i, bare: true },
  { kind: "withdraw", word: /^(?:retire|return)\b/i, bare: false },
  { kind: "hold", word: /^(?:hold|stand\s+fast|halt)\b/i, bare: true },
  { kind: "hold", word: /^(?:stay|remain|camp|encamp)\b/i, bare: false },
  { kind: "winter", word: /^(?:winter|go\s+into\s+winter\s+quarters|take\s+up\s+winter\s+quarters|take\s+winter\s+quarters|quarter)\b/i, bare: true },
];
const ARMYISH = /\b(?:army|armies|legions?|legio|troops|soldiers|men|host|forces?)\b/i;

/** Words that may stand in a march order besides the verb, the army and the place: nothing that asks for more than the walking. */
const FILLER = new Set(["please", "the", "my", "our", "of", "an", "a", "army", "armies", "legion", "legions", "legio", "troops", "soldiers", "men", "host", "force", "forces", "field",
  "to", "on", "at", "in", "into", "toward", "towards", "from", "now", "once", "immediately", "there", "here", "camp", "quarters", "winter", "for", "all", "whole", "back", "up", "down", "and", "go", "fast", "stand", "and", "with", "it", "them", "march", "advance", "proceed", "ride", "move", "send", "withdraw", "fall", "retire", "retreat", "pull", "return", "hold", "halt", "stay", "remain", "encamp", "take", "quarter", "us", "town", "city", "province", "country", "land", "winters", "season", "this", "that"]);

const escape = escapeForPattern;

export { placeNamed };

const nameOfProvince = (world: WorldState, id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;

/** The words of an order left once the verb, the place and the army are taken out: empty where it asks for nothing but the march. */
function leftOver(text: string, remove: readonly string[]): string[] {
  let rest = text.toLowerCase();
  for (const name of remove) rest = rest.replace(new RegExp(escape(name.toLowerCase()), "g"), " ");
  return rest.split(/[^a-z]+/).filter((word) => word.length > 0 && !FILLER.has(word));
}

/** What the engine does with a march, for the commander's hand and for the delegate's (`requests.ts`): the act, in the army's own name. */
export function marchDeltas(force: Force, provinceId: string, kind: MarchKind, byName: string): WorldDelta[] {
  const stays = kind === "hold" || kind === "winter";
  return [WorldDeltaSchema.parse({
    op: "force_modify", forceRef: force.id, ...(provinceId === force.locationId ? {} : { locationId: provinceId }), ...(stays ? { hold: true } : {}),
    reason: `${byName} ${kind === "withdraw" ? "withdraws" : stays ? "holds" : "marches"} ${force.name}${provinceId === force.locationId ? "" : " to"} its ground.`.slice(0, 240),
  })];
}

/** The ask a delegated march carries: the army, and in the instruction the place (read by `requests.ts`). */
export const marchAsk = (force: Force): RequestAsk => ({ kind: "march", ref: force.id });

/** The place a delegated march names, read from the instruction the player's words were turned into. */
export function placeOfInstruction(world: WorldState, instruction: string): string | null {
  return placeNamed(world, instruction)?.provinceId ?? null;
}

/** Whether the instruction asks the army to stay where it goes (to hold, to winter). */
export const staysAfterwards = (instruction: string): boolean => /\b(?:hold|holds|winter|wintering|quarters|remain|stay)\b/i.test(instruction);

export function marchClause(world: WorldState, playerId: string, text: string, warfare?: ScenarioWarfareRules): MarchClause | null {
  const trimmed = text.trim();
  const opening = trimmed.replace(/^(?:please\s+)?/i, "");
  const verb = VERBS.find((candidate) => candidate.word.test(opening));
  if (verb === undefined) return null;
  const place = placeNamed(world, trimmed);
  if (place === null) return null;
  const withoutPlace = trimmed.replace(new RegExp(`\\b${escape(place.name)}\\b`, "i"), " ");
  const { force, ambiguous } = armyNamed(world, playerId, withoutPlace, warfare);
  if (force === null || ambiguous) return null;
  const named = [force.name, ...(force.name.toLowerCase().split(/[^a-z0-9]+/))].filter((word) => word.length >= 3 && withoutPlace.toLowerCase().includes(word.toLowerCase()));
  if (leftOver(withoutPlace, [place.name, ...named]).length > 0) return null;
  if (!verb.bare && !ARMYISH.test(withoutPlace) && named.length === 0) return null;
  // "Hold" where it stands is the hold template's; "winter" here is the same with the winter said.
  if (verb.kind === "hold" && place.provinceId === force.locationId) return null;
  const player = world.characters.find((character) => character.id === playerId);
  if (player === undefined) return null;
  const alive = (id: string | null | undefined): id is string => id != null && id !== playerId && world.characters.some((character) => character.id === id && character.alive);
  const commands = force.commanderCharacterId === playerId;
  const controls = force.controllerCharacterId === playerId;
  const heads = player.polityId === force.polityId && !commands && !controls && force.memberCharacterIds.includes(playerId) === false;
  const toPlace = nameOfProvince(world, place.provinceId);
  const said = trimmed.slice(0, 200);
  const standing = verb.kind === "hold" || verb.kind === "winter";
  const goals = [{ kind: "force_at" as const, ref: force.id, at: place.provinceId }];
  if (place.provinceId === force.locationId && !standing) {
    return { part: { said, whyNot: `${force.name} already stands at ${toPlace}.` }, deltas: [], delegations: [], goals: [], template: "march", domain: "military" };
  }
  if (!commands && !controls && !heads) {
    return {
      part: { said, whyNot: `${player.name} is a man in the ranks of ${force.name}, not its commander: nobody marches an army on a private soldier's word.` },
      deltas: [], delegations: [], goals: [], template: "march", domain: "military", note: `${player.name} has no army to march.`,
    };
  }
  const instruction = `${verb.kind === "withdraw" ? "Withdraw" : verb.kind === "winter" ? "Winter" : verb.kind === "hold" ? "Hold" : "March"} ${force.name} ${verb.kind === "winter" ? "in" : verb.kind === "hold" ? "at" : "to"} ${toPlace}${standing ? ", and keep it there" : ""}.`;
  // The man who leads it marches it; where he is not the player the order is his to carry out or refuse.
  const commander = force.commanderCharacterId;
  if (!commands && alive(commander)) {
    return { part: { said }, deltas: [], delegations: [{ recipientId: commander, instruction, ask: marchAsk(force) }], goals, template: "march", domain: "military" };
  }
  return {
    part: { said }, deltas: marchDeltas(force, place.provinceId, verb.kind, player.name), delegations: [], goals, template: "march", domain: "military",
    note: `${force.name} is ordered ${standing ? `to stand at ${toPlace}` : `to ${toPlace}`}.`,
  };
}

/** The land armies the player may march: for a test or a hint, the same set the other templates read. */
export const marchableBy = (world: WorldState, playerId: string, warfare?: ScenarioWarfareRules): Force[] => forcesUnder(world, playerId, warfare);
