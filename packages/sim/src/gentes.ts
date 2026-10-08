import {
  allianceBetween,
  computeOpinion,
  dignitasOfGens,
  currentAgeYears,
  gensIdOfNomen,
  gensById,
  masculineNomen,
  ordoOfRomanName,
  parseRomanName,
  pluralOfNomen,
  princepsOf,
  stirpsOf,
  MAX_GENTES,
  type Character,
  type FactProposalDraft,
  type Gens,
  type CurulHonour,
  type WorldState,
} from "@chronica/shared";
import { aGensKeepsItsName } from "./adoption";
import { safeLocalId } from "./safe-local-id";

/**
 * The gentes, kept once a month.
 *
 * The record (`world/gentes.ts`) says what a family is: its branches, its honours, its rites, its
 * grudges and its marriages. This keeps it true as the world moves: every Roman has a gens (one is
 * made for a nomen nobody has borne yet); a man who sits in the curule chair puts one more image in
 * his family's atrium; the first man of the gens is whoever is the best of its living men; the rites
 * pass to him when their keeper dies; grudges cool and are fed by the living; the marriages that bound two
 * families fade unless the next generation renews them. Its men lean together in the Senate (`gens-loyalty.ts`),
 * read straight off `dynastyId` and the head: no political group is made for a gens, since the groups are what the
 * model's slice, the state's own view and the orders' "faction against" read, and eighty households would crowd the
 * factions that matter out of all three.
 *
 * One pass over the characters and one over the gentes, once a month: O(characters + gentes), with a
 * grudge scan only over men who have relations written.
 */

/** Days between passes over one gens. */
export const GENS_PASS_DAYS = 30;
/** How much heat an opinion that bad puts into a feud each month, per point beyond the threshold. */
const FEUD_OPINION_AT = -45;
const FEUD_HEAT_PER_POINT = 6;
const FEUD_HEAT_PER_MONTH_MAX = 420;
/** A feud begins at this heat, and cools by this much a month, which is a generation in twenty years. */
export const FEUD_BEGINS_BPS = 1_800;
export const FEUD_COOLS_BPS_PER_MONTH = 25;
/** An alliance by marriage fades by this much a month, and a new match renews it. */
export const ALLIANCE_FADES_BPS_PER_MONTH = 20;

const CURULE_KIND = (officeId: string): CurulHonour["kind"] | null => (/(^|-)consul$/.test(officeId) ? "consul" : /(^|-)censor$/.test(officeId) ? "censor" : /(^|-)dictator$/.test(officeId) ? "dictator" : null);

const DAY_WINDOW_SAME_HONOUR = 420;

/** A man of the gens who can bear its name forward: alive and a man. */
const isLivingMan = (character: Character): boolean => character.alive && character.gender === "male";

/** The gens a Roman's name says he is of, made if the world has none yet; null for a name with no nomen. */
function gensForName(world: WorldState, character: Character, toDay: number): { world: WorldState; gensId: string } | null {
  const name = parseRomanName(character.name);
  const nomen = character.nomen ?? name.nomen;
  if (nomen === null || nomen === undefined) return null;
  const id = gensIdOfNomen(nomen);
  if (world.gentes.some((gens) => gens.id === id)) return { world, gensId: id };
  if (world.gentes.length >= MAX_GENTES) return null;
  const stem = masculineNomen(nomen);
  const made: Gens = {
    id, kind: "noble", nomen: stem, plural: pluralOfNomen(stem), polityId: character.polityId,
    ordo: ordoOfRomanName(character.name), stirpes: [], honours: [], imagines: 0, sacra: [], sacraKeeperId: null, tomb: null,
    feuds: [], alliances: [], princepsId: null, dignitasBps: 0, keptAtStep: toDay,
  };
  return { world: { ...world, gentes: [...world.gentes, made] }, gensId: id };
}

/** Whether a name belongs to a Roman: his people are the Romans, and he has the form. */
const isRoman = (character: Character): boolean => character.polityId === "rome";

/**
 * Give every Roman a gens and the parts of his name: the people the world has made since the opening
 * (an order's new man, a freedman, a man the narrator wanted) are of the gens their name says, and a
 * freedman bears his patron's, as Rome made him.
 */
function everyRomanHasAGens(world: WorldState, toDay: number): WorldState {
  let next = world;
  let changed = false;
  const characters = world.characters.map((character) => {
    if (!isRoman(character) || character.dynastyId !== null) return character;
    const parts = parseRomanName(character.name);
    if (parts.nomen === null) return character;
    const made = gensForName(next, character, toDay);
    if (made === null) return character;
    next = made.world;
    changed = true;
    return {
      ...character, dynastyId: made.gensId,
      ...(character.nomen === undefined && parts.nomen !== null ? { nomen: parts.nomen } : {}),
      ...(character.praenomen === undefined && parts.praenomen !== null ? { praenomen: parts.praenomen } : {}),
      ...(character.cognomen === undefined && parts.cognomen !== null ? { cognomen: parts.cognomen } : {}),
      ...(character.ordo === undefined ? { ordo: next.gentes.find((gens) => gens.id === made.gensId)?.ordo ?? ordoOfRomanName(character.name) } : {}),
    };
  });
  return changed ? { ...next, characters } : world;
}

/** The curule honours the world has seen a man win since the last look, from his seats and his record. */
function newHonours(world: WorldState, member: Character, sinceStep: number | null, toDay: number, known: readonly CurulHonour[], stirps: string | null): CurulHonour[] {
  const found: CurulHonour[] = [];
  const has = (kind: CurulHonour["kind"], atStep: number): boolean => [...known, ...found].some((honour) => honour.kind === kind && honour.characterId === member.id && Math.abs(honour.atStep - atStep) < DAY_WINDOW_SAME_HONOUR);
  const since = sinceStep ?? Number.NEGATIVE_INFINITY;
  for (const seat of world.material.officeSeats) {
    if (seat.holderCharacterId !== member.id || seat.status !== "held") continue;
    const kind = CURULE_KIND(seat.officeId);
    const at = seat.termStartedAtStep ?? toDay;
    if (kind === null || at <= since || at > toDay || has(kind, at)) continue;
    found.push({ kind, who: member.name, characterId: member.id, stirps, atStep: at });
  }
  for (const tenure of member.officesHeld) {
    const kind = CURULE_KIND(tenure.officeId);
    if (kind === null || tenure.lastHeldAtStep <= since || tenure.lastHeldAtStep > toDay || has(kind, tenure.lastHeldAtStep)) continue;
    found.push({ kind, who: member.name, characterId: member.id, stirps, atStep: tenure.lastHeldAtStep });
  }
  return found;
}

/** The heat a living man's grudge adds, for the worst of what he feels toward one man. */
function grudgeOf(character: Character, subject: Character): { score: number; label: string } | null {
  const opinion = computeOpinion(character, subject.id);
  if (opinion > FEUD_OPINION_AT) return null;
  const worst = character.relations.find((relation) => relation.subjectCharacterId === subject.id)?.causes.slice().sort((a, b) => a.score - b.score)[0];
  return { score: opinion, label: worst?.label ?? "an old wrong" };
}

/** Fed by the living, cooled by the years: each gens's grudges against others. */
function keepFeuds(world: WorldState, membersOf: ReadonlyMap<string, Character[]>, toDay: number, facts: FactProposalDraft[], dueIds: ReadonlySet<string>): WorldState {
  const byId = new Map(world.characters.map((character) => [character.id, character]));
  const heat = new Map<string, { gensId: string; againstGensId: string; added: number; reason: string }>();
  for (const [gensId, members] of membersOf) {
    if (!dueIds.has(gensId)) continue;
    for (const member of members) {
      if (!member.alive || member.relations.length === 0) continue;
      for (const relation of member.relations) {
        const subject = byId.get(relation.subjectCharacterId);
        if (subject === undefined || !subject.alive || subject.dynastyId === null || subject.dynastyId === gensId) continue;
        const grudge = grudgeOf(member, subject);
        if (grudge === null) continue;
        const key = `${gensId}|${subject.dynastyId}`;
        const added = Math.min(FEUD_HEAT_PER_MONTH_MAX, Math.round((FEUD_OPINION_AT - grudge.score) * FEUD_HEAT_PER_POINT) + 60);
        const before = heat.get(key);
        if (before === undefined || added > before.added) heat.set(key, { gensId, againstGensId: subject.dynastyId, added, reason: `${member.name} against ${subject.name}: ${grudge.label}`.slice(0, 240) });
      }
    }
  }
  let changed = false;
  const gentes = world.gentes.map((gens) => {
    if (!dueIds.has(gens.id)) return gens;
    let feuds = gens.feuds;
    const fed = [...heat.values()].filter((entry) => entry.gensId === gens.id);
    for (const entry of fed) {
      const index = feuds.findIndex((feud) => feud.againstGensId === entry.againstGensId);
      if (index < 0) {
        feuds = [...feuds, { againstGensId: entry.againstGensId, reason: entry.reason, sinceStep: toDay, renewedAtStep: toDay, intensityBps: Math.min(10_000, FEUD_BEGINS_BPS + entry.added) }];
        const against = gensById(world, entry.againstGensId);
        if (against !== undefined) {
          facts.push({
            localId: safeLocalId(`feud_${gens.id}_${against.id}`).slice(0, 60), kind: "gens_feud",
            summary: `${gens.plural.replace(/^the /, "The ")} have a feud with ${against.plural}: ${entry.reason}.`.slice(0, 600),
            affectedRefs: [...(gens.polityId === null ? [] : [{ kind: "polity" as const, id: gens.polityId }])],
            visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 30,
          });
        }
      } else {
        feuds = feuds.map((feud, at) => (at === index ? { ...feud, intensityBps: Math.min(10_000, feud.intensityBps + entry.added), renewedAtStep: toDay, reason: entry.reason } : feud));
      }
    }
    // Everything cools; what was not fed this month cools only so far as the months go by.
    const cooled = feuds
      .map((feud) => (fed.some((entry) => entry.againstGensId === feud.againstGensId) ? feud : { ...feud, intensityBps: Math.max(0, feud.intensityBps - FEUD_COOLS_BPS_PER_MONTH) }))
      .filter((feud) => feud.intensityBps > 0);
    if (cooled.length !== gens.feuds.length || cooled.some((feud, index) => feud !== gens.feuds[index])) { changed = true; return { ...gens, feuds: cooled }; }
    return gens;
  });
  return changed ? { ...world, gentes } : world;
}

/** Marriages fade with the years unless a new match renews them. */
function keepAlliances(world: WorldState, dueIds: ReadonlySet<string>): WorldState {
  let changed = false;
  const gentes = world.gentes.map((gens) => {
    if (gens.alliances.length === 0 || !dueIds.has(gens.id)) return gens;
    const alliances = gens.alliances
      .map((alliance) => ({ ...alliance, strengthBps: Math.max(0, alliance.strengthBps - ALLIANCE_FADES_BPS_PER_MONTH) }))
      .filter((alliance) => alliance.strengthBps > 0);
    changed = true;
    return { ...gens, alliances };
  });
  return changed ? { ...world, gentes } : world;
}

/**
 * The monthly pass. Cheap to call every tick: it returns the world untouched until some gens's month is due.
 */
export function keepGentes(start: WorldState, toDay: number): { world: WorldState; facts: FactProposalDraft[] } {
  if (start.gentes.length === 0 && !start.characters.some((character) => isRoman(character) && character.dynastyId === null)) return { world: start, facts: [] };
  const due = start.gentes.length === 0 || start.gentes.some((gens) => gens.keptAtStep === null || toDay - gens.keptAtStep >= GENS_PASS_DAYS)
    || start.characters.some((character) => isRoman(character) && character.dynastyId === null && parseRomanName(character.name).nomen !== null);
  if (!due) return { world: start, facts: [] };

  const facts: FactProposalDraft[] = [];
  let world = everyRomanHasAGens(start, toDay);
  const membersOf = new Map<string, Character[]>();
  for (const character of world.characters) {
    if (character.dynastyId === null) continue;
    const list = membersOf.get(character.dynastyId);
    if (list === undefined) membersOf.set(character.dynastyId, [character]);
    else list.push(character);
  }

  const dueIds = new Set(world.gentes.filter((gens) => gens.keptAtStep === null || toDay - gens.keptAtStep >= GENS_PASS_DAYS).map((gens) => gens.id));
  world = keepFeuds(keepAlliances(world, dueIds), membersOf, toDay, facts, dueIds);

  const gentes = world.gentes.map((gens) => {
    if (gens.keptAtStep !== null && toDay - gens.keptAtStep < GENS_PASS_DAYS) return gens;
    const members = membersOf.get(gens.id) ?? [];
    const living = members.filter((member) => member.alive);
    // A man who has taken a curule chair since the last look has put an image in the atrium.
    const won: CurulHonour[] = [];
    for (const member of members) {
      if (member.officesHeld.length === 0 && !world.material.officeSeats.some((seat) => seat.holderCharacterId === member.id)) continue;
      won.push(...newHonours(world, member, gens.keptAtStep, toDay, [...gens.honours, ...won], stirpsOf(gens, member)));
    }
    const honours = won.length === 0 ? gens.honours : [...gens.honours, ...won].slice(-300);
    const withHonours = honours === gens.honours ? gens : { ...gens, honours };
    const first = princepsOf(withHonours, living, toDay);
    const keeper = withHonours.sacra.length === 0 ? null
      : living.some((member) => member.id === gens.sacraKeeperId && isLivingMan(member)) ? gens.sacraKeeperId
        : (heirWithin(world, members, gens.sacraKeeperId) ?? first?.id ?? null);
    if (first !== undefined && gens.princepsId !== null && gens.princepsId !== first.id && living.length >= 3) {
      facts.push({
        localId: safeLocalId(`princeps_${gens.id}_${toDay}`).slice(0, 60), kind: "gens_head",
        summary: `${first.name} is now the first man of ${gens.plural}.`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: first.id }, ...(gens.polityId === null ? [] : [{ kind: "polity" as const, id: gens.polityId }])],
        visibility: "polity", discoveryState: "polity", knowableInDays: 0, significance: 25,
      });
    }
    const imagines = new Set(withHonours.honours.map((honour) => honour.characterId ?? honour.who)).size;
    return { ...withHonours, imagines: Math.min(400, imagines), princepsId: first?.id ?? null, sacraKeeperId: keeper, dignitasBps: dignitasOfGens(withHonours, living), keptAtStep: toDay };
  });
  world = { ...world, gentes };
  // A first man with no son looks about for one, rarely, once a year (`adoption.ts`).
  const kept = aGensKeepsItsName(world, toDay);
  facts.push(...kept.facts);
  return { world: kept.world, facts };
}

/** The heir a dead keeper named, if he is of the same gens and living. */
function heirWithin(world: WorldState, members: readonly Character[], keeperId: string | null): string | null {
  if (keeperId === null) return null;
  const heirId = world.characters.find((character) => character.id === keeperId)?.heirCharacterId ?? null;
  return heirId !== null && members.some((member) => member.id === heirId && isLivingMan(member)) ? heirId : null;
}

/**
 * Two gentes tied by a marriage: recorded on both sides, or renewed to a firmer hold if they were already tied.
 * The match is the groom's gens (his father's) to the bride's (her father's, which she keeps).
 */
export function bindGentes(world: WorldState, groom: Character, bride: Character, atStep: number): WorldState {
  const a = groom.dynastyId;
  const b = bride.dynastyId;
  if (a === null || b === null || a === b) return world;
  if (gensById(world, a) === undefined || gensById(world, b) === undefined) return world;
  const strength = Math.min(10_000, Math.max(allianceBetween(world, a, b), 2_000) + 2_500);
  const upsert = (gens: Gens, otherId: string): Gens => {
    const existing = gens.alliances.find((alliance) => alliance.withGensId === otherId);
    const entry = { withGensId: otherId, sinceStep: existing?.sinceStep ?? atStep, renewedAtStep: atStep, strengthBps: strength, groomId: groom.id, brideId: bride.id };
    return { ...gens, alliances: (existing === undefined ? [...gens.alliances, entry] : gens.alliances.map((alliance) => (alliance === existing ? entry : alliance))).slice(-24) };
  };
  return { ...world, gentes: world.gentes.map((gens) => (gens.id === a ? upsert(gens, b) : gens.id === b ? upsert(gens, a) : gens)) };
}
