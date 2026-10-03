import { boundedId, stableHash } from "../determinism";
import type { Force, ForcePost } from "../material-state";
import type { ServiceRecord } from "../characters/character";
import { createCanonicalNpc } from "../characters/canonical-npc";
import { aNameFor } from "../characters/names-by-culture";
import type { WorldState } from "../world/world-state";
import { qualityInWords, type MilitaryEstablishment, type RankTemplate } from "./establishment";
import { doctrinesOf, formationOf, formationTemplateOf, isCombatDoctrine, unitCountOf, unitsOf } from "./formation";

/**
 * A man's place in an army (docs/plans/armies-in-detail.md).
 *
 * A declared legionary was one name in `memberCharacterIds` beside seven
 * thousand others, and his fate was the army's. Now he stands somewhere: a
 * formation, a unit in it, a rank, a centurion over him and men beside him
 * whose names he knows. Kept here, in shared, because declaring a character
 * places him (`player-materialization.ts`) and the tick keeps the place
 * (`sim/ranks.ts`), and the two must agree.
 */

const LEVEL_ORDER: Readonly<Record<RankTemplate["level"], number>> = { ranks: 0, sub: 1, unit: 2, formation: 3, body: 4, army: 5 };

/** How senior a rank is: the level first, then the grade within it (grade 1 above grade 2). */
export function seniorityOf(rank: RankTemplate): number {
  return LEVEL_ORDER[rank.level] * 1_000 - rank.grade;
}

/** The ranks found in a formation of this template, most junior first. */
export function ranksIn(establishment: MilitaryEstablishment, templateId: string): RankTemplate[] {
  return establishment.ranks
    .filter((rank) => rank.formationIds === undefined || rank.formationIds.includes(templateId))
    .sort((a, b) => seniorityOf(a) - seniorityOf(b));
}

/** The rank of a man who holds none: the ranks' own. */
export function soldierRank(establishment: MilitaryEstablishment, templateId: string): RankTemplate | undefined {
  return ranksIn(establishment, templateId).find((rank) => rank.level === "ranks");
}

/** The officer over a unit: the most senior unit-level rank there is (a maniple's prior centurion). */
export function unitOfficerRank(establishment: MilitaryEstablishment, templateId: string): RankTemplate | undefined {
  const units = ranksIn(establishment, templateId).filter((rank) => rank.level === "unit");
  return units[units.length - 1];
}

/** The officer over a body: a legion's tribunes, an ala's prefect, a phalanx's strategos. */
export function bodyOfficerRank(establishment: MilitaryEstablishment, templateId: string): RankTemplate | undefined {
  const bodies = ranksIn(establishment, templateId).filter((rank) => rank.level === "body" || rank.level === "formation");
  return bodies[bodies.length - 1];
}

/** The next rank up from this one in this formation, if there is one a man may be promoted to. */
export function nextRankUp(establishment: MilitaryEstablishment, templateId: string, rankId: string): RankTemplate | undefined {
  const ladder = ranksIn(establishment, templateId).filter((rank) => rank.filledBy !== "elected" && rank.filledBy !== "hereditary" && rank.level !== "army");
  const at = ladder.findIndex((rank) => rank.id === rankId);
  return at < 0 ? ladder[0] : ladder[at + 1];
}

const wordsOf = (text: string): string[] => text.toLowerCase().split(/[^a-z]+/u).filter((word) => word.length > 1);

/**
 * The rank a role names: "a centurion", "optio of the hastati". Two things a
 * role says do not make a rank. A possessive is somebody else's: "a legionary
 * in the consul's army" is a legionary. And a rank that is an office -- the
 * consul, the military tribunes, a king -- is held only by the man who holds
 * the office; saying it does not seat him.
 */
export function rankForRole(establishment: MilitaryEstablishment, role: string, heldOfficeIds: ReadonlySet<string> = new Set()): RankTemplate | undefined {
  const words = wordsOf(role.replace(/\b[\p{L}-]+['’]s\b/gu, " "));
  const named = establishment.ranks
    .filter((rank) => rank.officeIds === undefined || rank.officeIds.some((officeId) => heldOfficeIds.has(officeId)))
    .filter((rank) => [...rank.words, rank.label].some((word) => wordsOf(word).every((part) => words.some((w) => w.startsWith(part)))));
  return named.sort((a, b) => seniorityOf(b) - seniorityOf(a))[0];
}

const HORSE_WORDS = ["horse", "cavalry", "cavalryman", "horseman", "trooper", "eques", "equites", "rider", "companion", "decurion"];
const LIGHT_WORDS = ["slinger", "archer", "skirmisher", "javelin", "velites", "veles", "peltast", "light"];

/**
 * The formation a man serves in, from what he says he is: a horseman with the
 * horse, a slinger with the skirmishers, "a man of the principes" with the
 * principes; else the first line of the army's first body, where most men stood.
 */
export function formationForRole(force: Force, establishment: MilitaryEstablishment | undefined, role: string): string | null {
  const formations = force.formations ?? [];
  if (formations.length === 0) return null;
  const words = wordsOf(role);
  const has = (list: readonly string[]): boolean => words.some((word) => list.some((target) => word.startsWith(target)));
  const strength = (formationId: string): number => force.personnel.find((row) => row.formationId === formationId)?.fit ?? 0;
  // The body first: "a legionary" serves in a legion, "an allied horseman" in
  // an ala, and a man who says nothing in the body his country raises its own in.
  const bodyOf = (templateId: string) => establishment?.bodies.find((body) => body.formationIds.includes(templateId));
  const namedBody = establishment?.bodies.find((body) => body.matches.some((match) => words.some((word) => word.startsWith(match.toLowerCase()))));
  const home = namedBody ?? establishment?.bodies.find((body) => body.isDefault);
  const inHome = home === undefined ? formations : formations.filter((formation) => bodyOf(formation.templateId)?.id === home.id && strength(formation.id) > 0);
  const pool = inHome.length > 0 ? inHome : formations;
  const labelled = pool.find((formation) => {
    const label = formationTemplateOf(establishment, formation.templateId)?.label ?? formation.bodyLabel;
    return wordsOf(label).some((word) => word.length > 3 && words.some((w) => w.startsWith(word.slice(0, Math.max(4, word.length - 2)))));
  });
  if (labelled !== undefined && strength(labelled.id) > 0) return labelled.id;
  const pick = (line: (formationLine: string) => boolean): string | null =>
    pool.filter((formation) => line(formation.line) && strength(formation.id) > 0).sort((a, b) => strength(b.id) - strength(a.id))[0]?.id
    ?? formations.filter((formation) => line(formation.line) && strength(formation.id) > 0).sort((a, b) => strength(b.id) - strength(a.id))[0]?.id
    ?? null;
  if (has(HORSE_WORDS)) return pick((line) => line === "wing") ?? pick(() => true);
  if (has(LIGHT_WORDS)) return pick((line) => line === "screen") ?? pick(() => true);
  return pick((line) => line === "first") ?? pick(() => true);
}

export interface ServeInput {
  readonly characterId: string;
  readonly forceId: string;
  /** What he says he is: "a legionary", "centurion of the principes", "a Numidian horseman". */
  readonly role: string;
  readonly atStep: number;
  /** Name the men around him -- his officer, his tentmates. For the player, not for every soldier the world makes. */
  readonly nameTheChain: boolean;
  /** Campaigns he has behind him already. */
  readonly priorCampaigns?: number;
}

/** How many tentmates a man knows by name. */
const TENTMATES = 3;

/**
 * Puts a man in his army: a formation, a unit, a rank, and -- for the man the
 * story is about -- a named officer over him and named men beside him.
 * Idempotent: a man already serving where he is told to serve is left as he
 * is, save that a missing officer or comrade is named.
 */
export function serveInArmy(world: WorldState, input: ServeInput): WorldState {
  const force = world.material.forces.find((candidate) => candidate.id === input.forceId);
  const person = world.characters.find((candidate) => candidate.id === input.characterId);
  if (force === undefined || person === undefined || !person.alive) return world;
  const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId);
  if (establishment === undefined || (force.formations ?? []).length === 0) return world;

  let next = world;
  const already = person.service?.forceId === force.id && person.service.formationId !== null && formationOf(force, person.service.formationId) !== undefined
    ? person.service
    : undefined;
  const formationId = already?.formationId ?? formationForRole(force, establishment, input.role);
  const formation = formationOf(force, formationId ?? undefined);
  if (formation === undefined || formationId === null) return world;
  const template = formationTemplateOf(establishment, formation.templateId);
  const fit = force.personnel.find((row) => row.formationId === formationId)?.fit ?? 0;
  const units = unitCountOf(template, fit);
  const held = new Set([
    ...(person.officeId === null ? [] : [person.officeId]),
    ...world.material.officeSeats.filter((seat) => seat.holderCharacterId === person.id && seat.status === "held").map((seat) => seat.officeId),
  ]);
  const named = rankForRole(establishment, input.role, held);
  const rank = already === undefined
    ? (named !== undefined && ranksIn(establishment, formation.templateId).some((candidate) => candidate.id === named.id) ? named : soldierRank(establishment, formation.templateId))
    : establishment.ranks.find((candidate) => candidate.id === already.rankId);
  const posts = force.posts ?? [];
  const isUnitOfficer = rank?.level === "unit" || rank?.level === "sub";
  // An officer takes a unit nobody named holds; a soldier is wherever chance put him.
  let unitIndex = already?.unitIndex ?? stableHash([input.characterId, formationId, "unit"]) % units;
  if (already === undefined && isUnitOfficer) {
    const free = Array.from({ length: units }, (_, index) => (unitIndex + index) % units)
      .find((index) => !posts.some((post) => post.formationId === formationId && post.unitIndex === index && post.rankId === rank?.id));
    unitIndex = free ?? unitIndex;
  }
  const service: ServiceRecord = already ?? {
    forceId: force.id,
    formationId,
    unitIndex: rank?.level === "body" || rank?.level === "formation" || rank?.level === "army" ? null : unitIndex,
    rankId: rank?.id ?? "ranks",
    enlistedAtStep: input.atStep,
    campaigns: 0,
    priorCampaigns: input.priorCampaigns ?? 0,
    battles: 0,
    wounds: 0,
    decorations: [],
    punishments: [],
    conduct: "steady",
  };
  next = setService(next, person.id, service);
  next = withMember(next, force.id, person.id);
  // A rank that is a post is held by him now.
  if (rank !== undefined && rank.level !== "ranks") {
    next = setPost(next, force.id, { formationId, unitIndex: service.unitIndex, rankId: rank.id, characterId: person.id });
  }
  // The unit remembered, now that a named man is in it.
  if (service.unitIndex !== null) next = saveUnit(next, force.id, formationId, service.unitIndex);
  if (!input.nameTheChain || service.unitIndex === null) return next;

  // His officer, where he is not the officer himself.
  const officer = unitOfficerRank(establishment, formation.templateId);
  if (officer !== undefined && officer.id !== rank?.id) {
    next = nameThePost(next, force.id, formationId, service.unitIndex, officer, input.atStep);
  }
  // And the men he shares a tent with.
  const officers = new Set((next.material.forces.find((candidate) => candidate.id === force.id)?.posts ?? []).map((post) => post.characterId));
  const comrades = sharingHisUnit(next, force.id, formationId, service.unitIndex).filter((id) => id !== person.id && !officers.has(id));
  for (let n = comrades.length; n < TENTMATES; n += 1) {
    next = enlistAComrade(next, force.id, formationId, service.unitIndex, person.id, n, input.atStep);
  }
  return next;
}

/** The named men of a unit. */
export function sharingHisUnit(world: WorldState, forceId: string, formationId: string, unitIndex: number): string[] {
  const force = world.material.forces.find((candidate) => candidate.id === forceId);
  if (force === undefined) return [];
  return force.memberCharacterIds.filter((id) => {
    const service = world.characters.find((character) => character.id === id && character.alive)?.service;
    return service?.forceId === forceId && service.formationId === formationId && service.unitIndex === unitIndex;
  });
}

/** Who holds a post, if somebody named does and is alive. */
export function holderOf(world: WorldState, force: Force, formationId: string, unitIndex: number | null, rankId: string): string | null {
  const post = (force.posts ?? []).find((candidate) => candidate.formationId === formationId && candidate.unitIndex === unitIndex && candidate.rankId === rankId);
  if (post === undefined) return null;
  return world.characters.some((character) => character.id === post.characterId && character.alive) ? post.characterId : null;
}

function setService(world: WorldState, characterId: string, service: ServiceRecord): WorldState {
  return { ...world, characters: world.characters.map((character) => (character.id === characterId ? { ...character, service } : character)) };
}

function withForce(world: WorldState, forceId: string, change: (force: Force) => Force): WorldState {
  return { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id === forceId ? change(force) : force)) } };
}

function withMember(world: WorldState, forceId: string, characterId: string): WorldState {
  return withForce(world, forceId, (force) => (force.memberCharacterIds.includes(characterId) || force.commanderCharacterId === characterId
    ? force
    : { ...force, memberCharacterIds: [...force.memberCharacterIds, characterId].slice(-40) }));
}

export function setPost(world: WorldState, forceId: string, post: ForcePost): WorldState {
  return withForce(world, forceId, (force) => ({
    ...force,
    posts: [
      ...(force.posts ?? []).filter((candidate) => !(candidate.formationId === post.formationId && candidate.unitIndex === post.unitIndex && candidate.rankId === post.rankId) && candidate.characterId !== post.characterId),
      post,
    ].slice(-80),
  }));
}

/** Who gives a post, where the establishment does not say: a unit's lesser posts its officer, its officers the body's, the rest the general. */
export function appointerKindOf(rank: RankTemplate): NonNullable<RankTemplate["appointedBy"]> {
  if (rank.appointedBy !== undefined) return rank.appointedBy;
  if (rank.level === "sub") return "unit_officer";
  if (rank.level === "unit") return "body_officer";
  return "army_commander";
}

/**
 * The living men who may put a man in this post: whoever the establishment
 * says gives it, and always the army's own commander, over whom nobody in it
 * stands. Where the post's own appointer is not named -- no centurion over the
 * maniple, no tribune with the legion -- it falls to the general.
 */
export function appointersOf(world: WorldState, force: Force, rank: RankTemplate, formationId: string, unitIndex: number | null): string[] {
  const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId);
  const formation = formationOf(force, formationId);
  const alive = (id: string | null | undefined): id is string => id != null && world.characters.some((character) => character.id === id && character.alive);
  const general = [force.commanderCharacterId, force.controllerCharacterId].filter(alive);
  if (establishment === undefined || formation === undefined) return [...new Set(general)];
  const kind = appointerKindOf(rank);
  const posts = force.posts ?? [];
  const named = ((): string[] => {
    if (kind === "army_commander") return [];
    if (kind === "unit_officer") {
      const officer = unitOfficerRank(establishment, formation.templateId);
      return posts.filter((post) => post.formationId === formationId && post.unitIndex === unitIndex && post.rankId === officer?.id && post.rankId !== rank.id).map((post) => post.characterId);
    }
    if (kind === "body_officer") {
      const officer = bodyOfficerRank(establishment, formation.templateId);
      return posts.filter((post) => post.unitIndex === null && post.rankId === officer?.id && formationOf(force, post.formationId)?.bodyId === formation.bodyId).map((post) => post.characterId);
    }
    return world.material.officeSeats.filter((seat) => seat.status === "held" && kind.officeIds.includes(seat.officeId)).flatMap((seat) => (seat.holderCharacterId === null ? [] : [seat.holderCharacterId]));
  })().filter(alive);
  return [...new Set([...named, ...general])];
}

/**
 * A man put in a post: his rank, and the post his. Whoever held it before is
 * out of it, and so is any other post he held -- a man is one thing at a time.
 */
export function putInPost(world: WorldState, forceId: string, post: ForcePost, atStep: number): WorldState {
  const person = world.characters.find((character) => character.id === post.characterId);
  if (person === undefined) return world;
  const service: ServiceRecord = person.service?.forceId === forceId
    ? { ...person.service, formationId: post.formationId, unitIndex: post.unitIndex ?? person.service.unitIndex, rankId: post.rankId, promotedAtStep: atStep }
    : {
      forceId, formationId: post.formationId, unitIndex: post.unitIndex, rankId: post.rankId, enlistedAtStep: atStep, promotedAtStep: atStep,
      campaigns: 0, priorCampaigns: 0, battles: 0, wounds: 0, decorations: [], punishments: [], conduct: "steady",
    };
  return setPost(withMember(setService(world, person.id, service), forceId, person.id), forceId, post);
}

/**
 * One unit of a formation set to drill, or let off it. A man in the ranks who
 * drills his comrades drills his own maniple, not the legion: before, his word
 * set the whole army drilling (M4).
 */
export function drillOneUnit(world: WorldState, forceId: string, formationId: string, unitIndex: number, drilling: boolean): WorldState {
  return withForce(saveUnit(world, forceId, formationId, unitIndex), forceId, (force) => ({
    ...force,
    formations: (force.formations ?? []).map((formation) => (formation.id === formationId
      ? { ...formation, units: formation.units.map((unit) => (unit.index === unitIndex ? { ...unit, drilling } : unit)) }
      : formation)),
  }));
}

function saveUnit(world: WorldState, forceId: string, formationId: string, unitIndex: number): WorldState {
  const force = world.material.forces.find((candidate) => candidate.id === forceId);
  const formation = force === undefined ? undefined : formationOf(force, formationId);
  if (force === undefined || formation === undefined || formation.units.some((unit) => unit.index === unitIndex)) return world;
  const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId);
  const fit = force.personnel.find((row) => row.formationId === formationId)?.fit ?? 0;
  const reading = unitsOf(formation, formationTemplateOf(establishment, formation.templateId), fit)[unitIndex];
  if (reading === undefined) return world;
  return withForce(world, forceId, (candidate) => ({
    ...candidate,
    formations: (candidate.formations ?? []).map((entry) => (entry.id === formationId
      ? { ...entry, units: [...entry.units, { index: unitIndex, fit: reading.fit }].slice(-40) }
      : entry)),
  }));
}

function usedNames(world: WorldState): Set<string> {
  return new Set(world.characters.map((character) => character.name));
}

/** A named holder for a post that has none: the centurion over the player's maniple. */
export function nameThePost(world: WorldState, forceId: string, formationId: string, unitIndex: number | null, rank: RankTemplate, atStep: number): WorldState {
  const force = world.material.forces.find((candidate) => candidate.id === forceId);
  if (force === undefined || holderOf(world, force, formationId, unitIndex, rank.id) !== null) return world;
  const characterId = boundedId(formationId, String(unitIndex ?? "all"), rank.id, String(atStep));
  if (world.characters.some((character) => character.id === characterId)) return world;
  const made = createCanonicalNpc(world, {
    characterId,
    name: aNameFor(force.polityId, `${rank.id}:${formationId}:${unitIndex ?? ""}:${atStep}`, usedNames(world)),
    locationProvinceId: force.locationId,
    polityId: force.polityId,
    createdAtStep: atStep,
    creationReason: `${rank.label} in ${force.name}.`,
    ageYearsAtStart: 30 + (stableHash([characterId, "age"]) % 16),
    skills: { martial: 55 + (stableHash([characterId, "martial"]) % 20), intrigue: 30, learning: 25, piety: 40, stewardship: 35, diplomacy: 30, body: 60, subSkills: {} },
    prestigeBps: 2_500,
  });
  if (made === null) return world;
  let next = setService(made.world, characterId, {
    forceId, formationId, unitIndex, rankId: rank.id, enlistedAtStep: Math.max(0, atStep - 3_650),
    campaigns: 8 + (stableHash([characterId, "campaigns"]) % 6), priorCampaigns: 0, battles: 3 + (stableHash([characterId, "battles"]) % 8), wounds: stableHash([characterId, "wounds"]) % 3,
    decorations: [], punishments: [], conduct: "steady",
  });
  next = withMember(next, forceId, characterId);
  return setPost(next, forceId, { formationId, unitIndex, rankId: rank.id, characterId });
}

function enlistAComrade(world: WorldState, forceId: string, formationId: string, unitIndex: number, besideId: string, n: number, atStep: number): WorldState {
  const force = world.material.forces.find((candidate) => candidate.id === forceId);
  if (force === undefined || force.memberCharacterIds.length >= 38) return world;
  const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId);
  const formation = formationOf(force, formationId);
  if (establishment === undefined || formation === undefined) return world;
  const rank = soldierRank(establishment, formation.templateId);
  const characterId = boundedId(besideId, "comrade", String(n));
  if (world.characters.some((character) => character.id === characterId)) return world;
  const made = createCanonicalNpc(world, {
    characterId,
    name: aNameFor(force.polityId, `comrade:${besideId}:${n}`, usedNames(world)),
    locationProvinceId: force.locationId,
    polityId: force.polityId,
    createdAtStep: atStep,
    creationReason: `Shares a tent with ${world.characters.find((character) => character.id === besideId)?.name ?? "a comrade"} in ${force.name}.`,
    ageYearsAtStart: 18 + (stableHash([characterId, "age"]) % 14),
    skills: { martial: 35 + (stableHash([characterId, "martial"]) % 25), intrigue: 25, learning: 15, piety: 40, stewardship: 25, diplomacy: 30, body: 50 + (stableHash([characterId, "body"]) % 25), subSkills: {} },
    prestigeBps: 800,
  });
  if (made === null) return world;
  const next = setService(made.world, characterId, {
    forceId, formationId, unitIndex, rankId: rank?.id ?? "ranks", enlistedAtStep: atStep,
    campaigns: stableHash([characterId, "campaigns"]) % 5, priorCampaigns: 0, battles: stableHash([characterId, "battles"]) % 4, wounds: 0,
    decorations: [], punishments: [], conduct: "steady",
  });
  return withMember(next, forceId, characterId);
}

/** Campaigns a man has to his name, the years before the world began included. */
export function campaignsOf(character: { readonly service?: ServiceRecord | undefined; readonly ageYearsAtStart: number }): number {
  if (character.service === undefined) return Math.max(0, Math.min(10, character.ageYearsAtStart - 18));
  return character.service.campaigns + character.service.priorCampaigns;
}

export interface ServicePerson {
  readonly id: string;
  readonly name: string;
  readonly rank: string;
}

/** A soldier's place, read for his own sheet (`readService`). */
export interface ServiceReading {
  readonly forceId: string;
  readonly forceName: string;
  readonly commander: ServicePerson | null;
  readonly formationId: string;
  readonly formationLabel: string;
  readonly bodyLabel: string;
  readonly line: string;
  readonly unitLabel: string | null;
  readonly unitMen: number | null;
  readonly formationMen: number;
  readonly rank: string;
  readonly officers: readonly ServicePerson[];
  readonly comrades: readonly ServicePerson[];
  readonly quality: string;
  /** The ways of fighting his formation has, and the other ways its army is kept by. */
  readonly fightsBy: readonly string[];
  readonly keptBy: readonly string[];
  readonly drilling: boolean;
  readonly campaigns: number;
  readonly campaignsOwed: number | null;
  readonly battles: number;
  readonly wounds: number;
  readonly decorations: readonly { readonly label: string; readonly reason: string }[];
  readonly punishments: readonly { readonly label: string; readonly reason: string }[];
  readonly conduct: ServiceRecord["conduct"];
  /** What an establishment's honours are given for, so he knows what is prized and what is punished. */
  readonly honours: readonly { readonly label: string; readonly kind: "decoration" | "punishment"; readonly for: string }[];
  /** Campaigns before he may stand for office, where his country has a rule. */
  readonly campaignsForOffice: number;
}

const LINE_NAMES: Readonly<Record<string, string>> = {
  screen: "the skirmish screen", first: "the first line", second: "the second line", third: "the third line", wing: "the wings", reserve: "the reserve", afloat: "the fleet",
};
const FOR_WORDS: Readonly<Record<string, string>> = {
  saving_a_comrade: "saving a comrade's life", first_over_the_wall: "being first over an enemy wall", valour: "valour in the line",
  sleeping_on_watch: "sleeping on watch", flight: "running from the line", disobedience: "disobeying an order",
};

/**
 * A soldier's own sheet: where he stands, who is over him and beside him,
 * what he has done and what he is owed. Null for anyone not serving.
 */
export function readService(world: WorldState, characterId: string): ServiceReading | null {
  const person = world.characters.find((character) => character.id === characterId);
  const service = person?.service;
  if (person === undefined || service === undefined || service.forceId === null || service.formationId === null) return null;
  const force = world.material.forces.find((candidate) => candidate.id === service.forceId);
  const formation = force === undefined ? undefined : formationOf(force, service.formationId);
  if (force === undefined || formation === undefined) return null;
  const establishment = world.establishments.find((candidate) => candidate.polityId === force.polityId);
  const template = formationTemplateOf(establishment, formation.templateId);
  const fit = force.personnel.find((row) => row.formationId === formation.id)?.fit ?? 0;
  const unit = service.unitIndex === null ? undefined : unitsOf(formation, template, fit)[service.unitIndex];
  const rankLabel = (rankId: string): string => establishment?.ranks.find((rank) => rank.id === rankId)?.label ?? "soldier";
  const named = (id: string, rankId: string): ServicePerson | null => {
    const who = world.characters.find((character) => character.id === id && character.alive);
    return who === undefined ? null : { id, name: who.name, rank: rankLabel(rankId) };
  };
  const posts = force.posts ?? [];
  const officers = posts
    .filter((post) => post.characterId !== characterId && (post.formationId === formation.id || (post.unitIndex === null && formationOf(force, post.formationId)?.bodyId === formation.bodyId)) && (post.unitIndex === null || post.unitIndex === service.unitIndex))
    .flatMap((post) => { const person2 = named(post.characterId, post.rankId); return person2 === null ? [] : [person2]; });
  const comrades = service.unitIndex === null ? [] : sharingHisUnit(world, force.id, formation.id, service.unitIndex)
    .filter((id) => id !== characterId && !posts.some((post) => post.characterId === id))
    .flatMap((id) => { const other = world.characters.find((character) => character.id === id); return other?.service === undefined ? [] : [{ id, name: other.name, rank: rankLabel(other.service.rankId) }]; });
  const commander = world.characters.find((character) => character.id === force.commanderCharacterId);
  const owed = establishment === undefined ? null : formation.line === "wing" ? establishment.serviceCampaigns.horse : establishment.serviceCampaigns.foot;
  const row = force.personnel.find((candidate) => candidate.formationId === formation.id);
  const doctrines = row === undefined ? [] : doctrinesOf({ establishments: world.establishments, doctrines: world.doctrines, today: world.elapsedStep }, force, row);
  return {
    forceId: force.id,
    forceName: force.name,
    commander: commander === undefined ? null : { id: commander.id, name: commander.name, rank: "commander" },
    formationId: formation.id,
    formationLabel: template?.label ?? formation.bodyLabel,
    bodyLabel: formation.bodyLabel,
    line: LINE_NAMES[formation.line] ?? formation.line,
    unitLabel: unit?.label ?? null,
    unitMen: unit?.fit ?? null,
    formationMen: fit,
    rank: rankLabel(service.rankId),
    officers,
    comrades,
    quality: qualityInWords(formation.trainingBps, formation.experienceBps),
    fightsBy: doctrines.filter(isCombatDoctrine).map((doctrine) => doctrine.label),
    keptBy: doctrines.filter((doctrine) => !isCombatDoctrine(doctrine)).map((doctrine) => doctrine.label),
    drilling: force.drilling === true || formation.drilling === true,
    campaigns: campaignsOf(person),
    campaignsOwed: owed,
    battles: service.battles,
    wounds: service.wounds,
    decorations: service.decorations.map((entry) => ({ label: entry.label, reason: entry.reason })),
    punishments: service.punishments.map((entry) => ({ label: entry.label, reason: entry.reason })),
    conduct: service.conduct,
    honours: (establishment?.honours ?? []).map((honour) => ({ label: honour.label, kind: honour.kind, for: FOR_WORDS[honour.for] ?? honour.for })),
    campaignsForOffice: establishment?.campaignsForOffice ?? 0,
  };
}
