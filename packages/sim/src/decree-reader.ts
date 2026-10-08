import { atWar, fitStrengthOf, isNavalForce, readDepartments, sameConfederation, type PoliticalProcedure, type ScenarioWarfareRules, type WorldState } from "@chronica/shared";
import { placeNamed } from "./place-named";

/**
 * What a carried question names, read by rule (docs/economy.md, "Orders, calls and consequences").
 *
 * A question carried in the Senate, a council or an assembly that names a concrete act -- a fleet built, an army sent, men levied, the tribute set at a rate, a man given an
 * army, peace or an alliance sought of a power -- is a decree the engine can carry out through the deltas it already has (`decrees-by-rule.ts`), as the Senate's decree of a
 * hundred and twenty hulls is (`a-fleet-by-decree.ts`). This is only the reading: the words and the world in, the act out, or null where the words name no act or more than one.
 * Nothing is changed here.
 */

export type Decree =
  | { readonly kind: "fleet"; readonly hulls: number | null }
  | { readonly kind: "levy"; readonly men: number; readonly provinceId: string | null }
  | { readonly kind: "march"; readonly forceId: string; readonly provinceId: string }
  | { readonly kind: "tribute"; readonly rateBps: number }
  | { readonly kind: "command"; readonly forceId: string; readonly characterId: string }
  | { readonly kind: "letter"; readonly letter: "peace_offer" | "alliance_offer"; readonly toPolityId: string };

const NUMBER_WORDS: Readonly<Record<string, number>> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100 };
const COUNT = "(\\d[\\d,]*|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|fifty|sixty|hundred)";
/** Men in a legion, in the tale of Polybius (6.20): four thousand two hundred foot. */
const MEN_A_LEGION = 4_200;

const countOf = (word: string): number => (/^\d/.test(word) ? Number(word.replace(/,/g, "")) : NUMBER_WORDS[word.toLowerCase()] ?? 0);

/** The power whose chamber heard the question. */
export function polityOfQuestion(world: WorldState, procedure: PoliticalProcedure): string | null {
  return world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.polityId ?? null;
}

const fleetOf = (text: string): Decree | null => {
  if (!/\b(?:fleet|navy|squadron|ships|quinqueremes|triremes|galleys|warships)\b/i.test(text) || !/\b(?:built|build|raised|raise|laid\s+down|fitted\s+out|fit\s+out|constructed|construct)\b/i.test(text)) return null;
  const hulls = /\b(?:a\s+)?hundred\b/i.test(text) ? 100 : /(\d[\d,]*)\s*(?:war\s*ships?|ships|galleys|quinqueremes|triremes|hulls)/i.exec(text)?.[1];
  const count = typeof hulls === "number" ? hulls : hulls === undefined ? null : countOf(hulls);
  return { kind: "fleet", hulls: count !== null && count >= 5 && count <= 400 ? count : null };
};

const levyOf = (world: WorldState, text: string): Decree | null => {
  if (!/\b(?:levy|levied|raise|raised|muster|mustered|enrol(?:l)?(?:ed)?|recruit(?:ed)?)\b/i.test(text)) return null;
  const legions = new RegExp(`${COUNT}\\s+legions?\\b`, "i").exec(text);
  const men = new RegExp(`${COUNT}\\s*(thousand\\s+)?(?:more\\s+)?men\\b`, "i").exec(text);
  const total = men !== null ? countOf(men[1]!) * (men[2] === undefined ? 1 : 1_000) : legions !== null ? countOf(legions[1]!) * MEN_A_LEGION : 0;
  if (!(total >= 100 && total <= 60_000)) return null;
  return { kind: "levy", men: total, provinceId: placeNamed(world, text)?.provinceId ?? null };
};

/** The land army a question names, or the largest the power has. */
function armyOfQuestion(world: WorldState, polityId: string, text: string, warfare: ScenarioWarfareRules | undefined): string | null {
  const lower = text.toLowerCase();
  const mine = world.material.forces.filter((force) => force.polityId === polityId && force.outlaw !== true && !isNavalForce(force, warfare) && fitStrengthOf(force) > 0)
    .sort((a, b) => fitStrengthOf(b) - fitStrengthOf(a) || a.id.localeCompare(b.id));
  const named = mine.filter((force) => lower.includes(force.name.toLowerCase()));
  if (named.length === 1) return named[0]!.id;
  return mine[0]?.id ?? null;
}

const marchOf = (world: WorldState, polityId: string, text: string, warfare: ScenarioWarfareRules | undefined): Decree | null => {
  if (!/\b(?:send|sent|despatch(?:ed)?|dispatch(?:ed)?|march(?:ed)?)\b/i.test(text) || !/\b(?:army|armies|legions?|consul|forces?|host)\b/i.test(text)) return null;
  const place = placeNamed(world, text);
  const forceId = armyOfQuestion(world, polityId, text, warfare);
  const force = world.material.forces.find((candidate) => candidate.id === forceId);
  if (place === null || force === undefined || place.provinceId === force.locationId) return null;
  return { kind: "march", forceId: force.id, provinceId: place.provinceId };
};

const tributeOf = (text: string): Decree | null => {
  const match = /\b(?:tribute|tax|taxes|tithe)\b.*?\b(?:to|at)\s+(\d+(?:\.\d+)?)\s*(?:%|per\s*cent|percent|in\s+a\s+hundred)/i.exec(text);
  if (match === null) return null;
  const rateBps = Math.round(Number(match[1]) * 100);
  return rateBps >= 0 && rateBps <= 5_000 ? { kind: "tribute", rateBps } : null;
};

const commandOf = (world: WorldState, polityId: string, text: string, warfare: ScenarioWarfareRules | undefined): Decree | null => {
  if (!/\b(?:command|commander|general)\b/i.test(text) || !/\b(?:give[nsv]?|entrust(?:ed)?|appoint(?:ed)?|assign(?:ed)?|name[d]?|put\s+in)\b/i.test(text)) return null;
  const lower = text.toLowerCase();
  const men = world.characters.filter((character) => character.alive && character.polityId === polityId && character.name.length >= 6 && lower.includes(character.name.toLowerCase()));
  const forceId = armyOfQuestion(world, polityId, text, warfare);
  if (men.length !== 1 || forceId === null || world.material.forces.find((force) => force.id === forceId)?.commanderCharacterId === men[0]!.id) return null;
  return { kind: "command", forceId, characterId: men[0]!.id };
};

const letterOf = (world: WorldState, polityId: string, text: string): Decree | null => {
  const lower = text.toLowerCase();
  const peace = /\bpeace\b/i.test(text) && !/\bwar\s+be\s+made\b/i.test(text);
  const alliance = /\b(?:alliance|treaty\s+of\s+(?:friendship|alliance)|friendship\s+and\s+aid)\b/i.test(text);
  if (peace === alliance) return null;
  const named = world.map.polities.filter((polity) => polity.id !== polityId && lower.includes(polity.name.toLowerCase()));
  if (named.length !== 1) return null;
  const other = named[0]!.id;
  if (peace) return atWar(world.polityAgreements, polityId, other) ? { kind: "letter", letter: "peace_offer", toPolityId: other } : null;
  return atWar(world.polityAgreements, polityId, other) || sameConfederation(world.polityAgreements, polityId, other) ? null : { kind: "letter", letter: "alliance_offer", toPolityId: other };
};

/** The act a carried question names, or null where its words name none, or two. */
export function readDecree(world: WorldState, procedure: Pick<PoliticalProcedure, "label" | "institutionId">, warfare?: ScenarioWarfareRules): Decree | null {
  const polityId = world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.polityId ?? null;
  if (polityId === null) return null;
  const text = procedure.label.replace(/^Motion of [^:]+:\s*/i, "");
  const readings = [fleetOf(text), levyOf(world, text), marchOf(world, polityId, text, warfare), tributeOf(text), commandOf(world, polityId, text, warfare), letterOf(world, polityId, text)]
    .filter((reading): reading is Decree => reading !== null);
  return readings.length === 1 ? readings[0]! : null;
}

/** Whether a power's chief men are alive to carry a decree out: the man who put the question, else a ruler of the power. */
export function carrierOf(world: WorldState, procedure: Pick<PoliticalProcedure, "sponsorCharacterId">, polityId: string): string | null {
  const alive = (id: string | null | undefined): id is string => id != null && world.characters.some((character) => character.id === id && character.alive && character.polityId === polityId);
  if (alive(procedure.sponsorCharacterId)) return procedure.sponsorCharacterId;
  return readDepartments(world).rulers(polityId).find((ruler) => alive(ruler.id))?.id ?? null;
}
