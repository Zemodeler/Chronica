import { buildStation, factsKnownToStation, holdsPolityStanding } from "../authority/station";
import { readAbroad, type TreatyPosture } from "../authority/abroad";
import { readPerson } from "../characters/acquaintance";
import { lettersDirectory } from "../characters/directory";
import { allOffices, allSuccessionRules, type Office, type SuccessionRule } from "../characters/character";
import { admissionRefusal, electableFor, isBeneath, officeRequirements } from "../characters/candidates";
import { standingGateOf } from "../characters/standing";
import { formatStanding } from "../characters/standing-causes";
import { describeOfficePowers } from "./office-powers-text";
import { labelNamesOffice } from "../characters/player-materialization";
import type { CharacterBelief, KnowledgeChannel } from "../characters/beliefs";
import type { Muster } from "../material/forces";
import { controlInWords } from "../material/in-words";
import type { Fact, FactDiscoveredBy } from "../world/facts";
import { isDelivered } from "../world/diplomacy";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import type { WorldState } from "../world/world-state";
import { estimateMen } from "./estimate";
import { asShips, isNavalForce } from "../warfare/sea";
import type { ScenarioWarfareRules } from "../warfare/battle";
import { comparePeople, comparePowers, groupsLedBy, theirPeople, type ComparedLine, type PersonTie } from "./compare";
import { siegePressurePerDayBps, siegeWalls } from "../world/siege";
import { opinionWhy, type WhyReading } from "./why";
import { warInWords, type WarReading } from "./war";
import { sourceLine, type Source, type SourceChannel, type SourceReading } from "./source";

/**
 * A note for everything the player can name.
 *
 * Crusader Kings lets you hover over any name and read about it. Here that
 * means one glossary, sent with the room, holding a note for every person,
 * place, force, power and office the viewer's station reaches. A name in
 * any sheet looks itself up here and renders as plain words when it is
 * missing, so a note can never say what this reader did not send.
 *
 * Scope, per kind:
 *
 * - People: the letter tray's list (`lettersDirectory`). That is everyone
 *   the viewer has dealt with, written to or heard of, plus every sitting
 *   officeholder, who is public by nature. It is never every character
 *   alive. What is known of each comes from `readPerson`, which never reads
 *   what they think of you.
 * - Places: every province, because who holds it is on the map for anyone
 *   to see. How firmly it is held, and whose men are there, only for ground
 *   the viewer stands on, holds or has an army in, or for anyone who
 *   governs.
 * - Forces: the viewer's own, read exactly. Everyone else's is a range with
 *   its source (`estimate.ts`). With no source, "unknown to you".
 * - Powers: all of them, with the posture `readAbroad` already worked out.
 * - Offices: all of them, with whoever holds each. The rolls are public.
 */

export type EntityKind = "person" | "place" | "force" | "power" | "office";
export type EntityKey = `${EntityKind}:${string}`;
export const entityKey = (kind: EntityKind, id: string): EntityKey => `${kind}:${id}`;

/** A name that may open a note of its own. `key` is null when the glossary has nothing on it. */
export interface Linked {
  readonly label: string;
  readonly key: EntityKey | null;
}

export interface HeardLine {
  readonly preface: string;
  readonly claim: string;
  readonly fromLabel: string | null;
  readonly whenLabel: string | null;
}

export interface PersonNote {
  readonly kind: "person";
  readonly name: string;
  /** "A person · censor, about 58". */
  readonly kicker: string;
  readonly office: Linked | null;
  readonly polity: Linked | null;
  readonly where: Linked | null;
  readonly standingLabel: string;
  readonly knownFor: readonly string[];
  readonly skills: readonly string[];
  /** Your own view of him. Null for someone you only know of. */
  readonly opinionLabel: string | null;
  /** Why you think so: your own relation's strongest causes. */
  readonly opinionWhy: WhyReading | null;
  readonly ties: readonly string[];
  readonly towardYou: readonly string[];
  readonly heard: readonly HeardLine[];
  readonly alive: boolean;
  /** For the note's pronouns. */
  readonly female: boolean;
  /** Set against the viewer: renown, offices, clients, age. Empty for the viewer himself. */
  readonly compared: readonly ComparedLine[];
  /** His people: kin, patrons, clients, friends and rivals, where the tie is public or yours. */
  readonly people: readonly PersonTie[];
  /** What he leads: a faction, a clientele. */
  readonly leads: readonly string[];
  readonly source: SourceReading | null;
}

export interface PlaceNote {
  readonly kind: "place";
  readonly name: string;
  readonly kicker: string;
  readonly holder: Linked | null;
  /** "firmly held". Only where the viewer can see it. */
  readonly holdLabel: string | null;
  readonly forcesHere: readonly Linked[];
  readonly source: SourceReading | null;
}

export interface ForceNote {
  readonly kind: "force";
  readonly name: string;
  readonly kicker: string;
  readonly polity: Linked | null;
  readonly commander: Linked | null;
  readonly where: Linked | null;
  /** Exact for your own ("9,100 men"), a range for anyone else's, or "unknown to you". */
  readonly strengthLabel: string;
  /** "Men in good heart, short of supply": your own only. */
  readonly conditionLabel: string | null;
  readonly yours: boolean;
  /** If nothing changes: when its supplies run out, when a siege it lays or suffers should end. */
  readonly projections: readonly string[];
  /** The rules those projections follow, in `explanations.ts`: supply for your own, sieges where one is laid. */
  readonly explainedBy: readonly string[];
  readonly source: SourceReading | null;
}

export interface PowerNote {
  readonly kind: "power";
  readonly name: string;
  readonly kicker: string;
  readonly ruler: Linked | null;
  /** "distrusted, since the raid on Rhegium": what your government thinks of it. Only for those who govern. */
  readonly regardLabel: string | null;
  /** Set against the viewer's own power. Empty for his own. */
  readonly compared: readonly ComparedLine[];
  /** How the war with it goes, where there is one (`warInWords`). */
  readonly war: WarReading | null;
  /** Its form of government, in `explanations.ts`: public, as any constitution is. */
  readonly explainedBy: string | null;
  readonly source: SourceReading | null;
}

export interface OfficeNote {
  readonly kind: "office";
  readonly name: string;
  readonly kicker: string;
  readonly polity: Linked | null;
  readonly holders: readonly Linked[];
  readonly termLabel: string | null;
  readonly filledLabel: string | null;
  /** What kind of office it is, in `explanations.ts`. */
  readonly explainedBy: string;
  /** Exactly what its holder may do, sentence by sentence (`office-powers-text.ts`). */
  readonly powers: readonly string[];
  /** Who could hold it next, for an office of the viewer's own power that is elected (`electableFor`). */
  readonly next: OfficeNext | null;
  readonly source: SourceReading | null;
}

export interface OfficeNext {
  /** "Polling day is 15 March", when an election is open. */
  readonly pollingLabel: string | null;
  /** Men who have put themselves forward, by public nomination. */
  readonly standing: readonly Linked[];
  /** Men the electors would think of unprompted, likeliest first. */
  readonly talkedOf: readonly Linked[];
  /** "You could stand", "You are talked of for it", "Not yet: you stand at 2,900; the office asks 3,000"; null when it is beneath him. */
  readonly youLabel: string | null;
}

export type EntityNote = PersonNote | PlaceNote | ForceNote | PowerNote | OfficeNote;
export type Glossary = Readonly<Partial<Record<EntityKey, EntityNote>>>;

export interface GlossaryInput {
  readonly world: WorldState;
  readonly characterId: string;
  readonly offices?: readonly Office[] | undefined;
  readonly successionRules?: readonly SuccessionRule[] | undefined;
  readonly clock?: ScenarioClock | undefined;
  /** The muster, when the caller has already read it: the viewer's own forces in words. */
  readonly muster?: Muster | undefined;
  /** The scenario's troop kinds, so a fleet is counted in ships. */
  readonly warfare?: ScenarioWarfareRules | undefined;
  /** Recent facts (`listRecentFacts`), for where other powers' armies were last reported. */
  readonly facts?: readonly Fact[] | undefined;
  readonly conversationPartnerIds?: readonly string[] | undefined;
}

const POSTURE_WORDS: Readonly<Record<TreatyPosture, string>> = {
  war: "at war with you",
  answer_to: "yours answers to it",
  bound_to_us: "bound to you",
  equals: "at peace with you",
  none: "no dealings with you",
  ended: "once bound to you",
};

/** A belief's channel under the note's plainer names. */
const BELIEF_CHANNEL: Readonly<Record<KnowledgeChannel, SourceChannel>> = {
  direct_witness: "dealings",
  event_participant: "dealings",
  public_announcement: "public",
  trusted_report: "report",
  ordinary_rumour: "rumour",
  private_disclosure: "report",
  intercepted_secret: "report",
};

const DISCOVERY_CHANNEL: Readonly<Record<FactDiscoveredBy["via"], SourceChannel>> = {
  witnessed: "report",
  told: "report",
  document: "letter",
  investigation: "report",
  rumour: "rumour",
};

function beliefChannel(belief: CharacterBelief): SourceChannel {
  if (belief.channel !== undefined) return BELIEF_CHANNEL[belief.channel];
  return belief.kind === "rumour" || belief.kind === "suspicion" ? "rumour" : "report";
}

const fitOf = (force: WorldState["material"]["forces"][number]): number =>
  force.personnel.reduce((sum, category) => sum + category.fit, 0);

export function readGlossary(input: GlossaryInput): Glossary {
  const { world, characterId, clock } = input;
  const offices = allOffices(world, input.offices ?? []);
  const viewer = world.characters.find((character) => character.id === characterId);
  if (viewer === undefined) return {};
  const station = buildStation({ world, characterId, offices: input.offices ?? [] });
  const now = world.elapsedStep;
  const notes: Partial<Record<EntityKey, EntityNote>> = {};

  const polityName = (id: string | null): string | null => (id === null ? null : world.map.polities.find((polity) => polity.id === id)?.name ?? null);
  const provinceName = (id: string | null): string | null => (id === null ? null : world.map.provinces.find((province) => province.id === id)?.name ?? null);
  const personName = (id: string | null): string | null => (id === null ? null : world.characters.find((character) => character.id === id)?.name ?? null);
  const link = (kind: EntityKind, id: string | null, label: string | null): Linked | null =>
    id === null || label === null ? null : { label, key: entityKey(kind, id) };

  const heldBy = new Map<string, string[]>();
  const officeOf = new Map<string, Office>();
  const officeById = new Map(offices.map((office) => [office.id, office]));
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null) continue;
    heldBy.set(seat.officeId, [...(heldBy.get(seat.officeId) ?? []), seat.holderCharacterId]);
    const office = officeById.get(seat.officeId);
    if (office !== undefined && !officeOf.has(seat.holderCharacterId)) officeOf.set(seat.holderCharacterId, office);
  }

  // People: the letter tray's scope, read by `readPerson`.
  const listed = lettersDirectory({ world, viewerId: characterId, offices: input.offices ?? [], clock, conversationPartnerIds: input.conversationPartnerIds })
    .flatMap((group) => group.people.map((person) => person.id));
  for (const id of listed) {
    const person = readPerson({ world, viewerId: characterId, subjectId: id, offices, clock, conversationPartnerIds: input.conversationPartnerIds });
    const subject = world.characters.find((character) => character.id === id);
    if (person === null || subject === undefined) continue;
    const office = officeOf.get(id) ?? null;
    notes[entityKey("person", id)] = {
      kind: "person",
      name: person.name,
      kicker: [office === null ? "A person" : `A person · ${office.label}`, person.ageLabel].filter((part) => part !== null).join(", "),
      office: office === null ? null : link("office", office.id, office.label),
      polity: link("power", subject.polityId, person.polityLabel),
      where: link("place", subject.locationProvinceId, person.whereLabel),
      standingLabel: person.standingLabel,
      knownFor: person.knownForLabels,
      skills: person.reputedSkillLabels,
      opinionLabel: person.how === "heard_of" ? null : person.yourOpinionLabel,
      opinionWhy: person.how === "heard_of" ? null : opinionWhy(viewer, id),
      ties: person.ties.map((tie) => tie.label),
      towardYou: person.towardYouLabels,
      heard: person.heard.map((line) => ({ preface: line.prefaceLabel, claim: line.claim, fromLabel: line.fromLabel, whenLabel: line.whenLabel })),
      alive: person.alive,
      female: subject.gender === "female",
      compared: comparePeople(world, characterId, id),
      people: theirPeople(world, characterId, id),
      leads: groupsLedBy(world, id),
      source: sourceLine(personSources(world, characterId, id, person.how, office !== null), now, "person", clock),
    };
  }

  // Forces: your own exactly, anyone else's as a guess with its source.
  const own = new Map((input.muster?.forces ?? []).map((reading) => [reading.id, reading]));
  const seen = (provinceId: string): boolean => station.provinceIds.has(provinceId);
  /** Each power's men as the viewer's sources count them. */
  const guessedMen = new Map<string, number>();
  const known = input.facts === undefined ? [] : factsKnownToStation(input.facts, station, { day: now, minute: 0 }, world);
  for (const force of world.material.forces) {
    const reading = own.get(force.id);
    const yours = reading !== undefined;
    const stranger = yours ? null : strangerStrength(force, station.provinceIds, known, characterId, now);
    if (stranger?.men != null) guessedMen.set(force.polityId, (guessedMen.get(force.polityId) ?? 0) + stranger.men);
    const source: Source | null = yours ? { channel: "roll", fromLabel: null, asOfStep: now } : stranger!.source;
    const strengthLabel = yours ? `${reading.fitStrength.toLocaleString("en-GB")} ${reading.naval ? (reading.fitStrength === 1 ? "ship" : "ships") : "men"}` : asShips(stranger!.label, isNavalForce(force, input.warfare));
    // Where a foreign army is, when nobody has seen it lately, is what the
    // map shows everyone. Its commander, likewise, is public.
    const projected = yours || seen(force.locationId) ? forceProjections(world, force, yours, clock) : null;
    notes[entityKey("force", force.id)] = {
      kind: "force",
      name: force.name,
      kicker: `${isNavalForce(force, input.warfare) ? "A fleet" : "A force"} · ${yours ? "yours" : polityName(force.polityId) ?? "no power's"}`,
      polity: force.outlaw === true ? null : link("power", force.polityId, polityName(force.polityId)),
      commander: link("person", force.commanderCharacterId, personName(force.commanderCharacterId)),
      where: link("place", force.locationId, provinceName(force.locationId)),
      strengthLabel,
      conditionLabel: reading === undefined ? null : `Men ${reading.moraleLabel}, ${reading.provisionLabel.toLowerCase()}, ${reading.payStatus.toLowerCase()}.`,
      yours,
      projections: projected?.lines ?? [],
      explainedBy: projected?.rules ?? [],
      source: source === null ? null : sourceLine([source], now, "field", clock),
    };
  }

  // Places.
  const governs = holdsPolityStanding(station);
  for (const province of world.map.provinces) {
    const close = station.provinceIds.has(province.id) || governs;
    const holder = polityName(province.controllerPolityId);
    notes[entityKey("place", province.id)] = {
      kind: "place",
      name: province.name,
      kicker: holder === null ? "A place · held by no one" : `A place · held by ${holder}`,
      holder: link("power", province.controllerPolityId, holder),
      holdLabel: close && province.controllerPolityId !== null ? controlInWords(province.controlFirmnessBps) : null,
      forcesHere: close
        ? world.material.forces.filter((force) => force.locationId === province.id).map((force) => ({ label: force.name, key: entityKey("force", force.id) }))
        : [],
      source: sourceLine([{ channel: station.provinceIds.has(province.id) ? "own_eyes" : "public", fromLabel: null, asOfStep: now }], now, "place", clock),
    };
  }

  // Powers. Your own side's men you may count; theirs as your sources do.
  const ownMen = world.material.forces.filter((force) => force.polityId === viewer.polityId).reduce((sum, force) => sum + fitOf(force), 0);
  const abroad = readAbroad(world, characterId, input.offices ?? [], clock);
  const postureOf = new Map(abroad.powers.map((power) => [power.polityId, power]));
  const rules = new Map(allSuccessionRules(world, input.successionRules ?? []).map((rule) => [rule.id, rule]));
  for (const polity of world.map.polities) {
    if (polity.id === viewer.polityId) {
      notes[entityKey("power", polity.id)] = {
        kind: "power", name: polity.name, kicker: "A power · yours", ruler: rulerOf(polity.id), regardLabel: null, compared: [], war: null, explainedBy: formOf(polity.id),
        source: sourceLine([{ channel: "own_eyes", fromLabel: null, asOfStep: now }], now, "power", clock),
      };
      continue;
    }
    const power = postureOf.get(polity.id);
    notes[entityKey("power", polity.id)] = {
      kind: "power",
      name: polity.name,
      kicker: `A power · ${POSTURE_WORDS[power?.posture ?? "none"]}`,
      ruler: rulerOf(polity.id),
      regardLabel: power?.regard === null || power?.regard === undefined ? null : `${power.regard.inWords}${power.regard.why === "" ? "" : `: ${power.regard.why}`}`,
      compared: viewer.polityId === null ? [] : comparePowers(world, viewer.polityId, polity.id, ownMen, { men: guessedMen.has(polity.id) ? guessedMen.get(polity.id)! : null }),
      war: viewer.polityId === null || power?.posture !== "war" ? null : warInWords(world, viewer.polityId, polity.id, guessedMen.get(polity.id) ?? null),
      explainedBy: formOf(polity.id),
      source: sourceLine([{ channel: "public", fromLabel: null, asOfStep: now }], now, "power", clock),
    };
  }

  // Offices.
  for (const office of offices) {
    const holders = (heldBy.get(office.id) ?? []).map((id) => link("person", id, personName(id))).filter((holder): holder is Linked => holder !== null);
    const polity = polityName(office.polityId);
    notes[entityKey("office", office.id)] = {
      kind: "office",
      name: office.label,
      kicker: polity === null ? "An office" : `An office · of ${polity}`,
      polity: link("power", office.polityId, polity),
      holders,
      termLabel: office.termDays === null || office.termDays === undefined ? null : `Held for ${termWords(office.termDays)}`,
      filledLabel: rules.get(office.successionRuleId)?.label ?? null,
      explainedBy: `office:${office.kind ?? "magistracy"}`,
      powers: describeOfficePowers(office, { departments: world.departments }),
      next: office.polityId === viewer.polityId && rules.get(office.successionRuleId)?.kind === "elective" ? whoCouldBeNext(world, office, officeById, viewer, clock) : null,
      source: sourceLine([{ channel: "record", fromLabel: null, asOfStep: now }], now, "office", clock),
    };
  }

  // A name opens a note only when there is one to open.
  return prune(reachable(notes, [
    ...listed.map((id) => entityKey("person", id)),
    ...world.material.forces.map((force) => entityKey("force", force.id)),
    ...[...station.provinceIds].map((id) => entityKey("place", id)),
    ...abroad.powers.map((power) => entityKey("power", power.polityId)),
    ...(viewer.polityId === null ? [] : [entityKey("power", viewer.polityId)]),
    ...offices.filter((office) => office.polityId === viewer.polityId).map((office) => entityKey("office", office.id)),
  ]));

  function rulerOf(polityId: string): Linked | null {
    const ruling = offices
      .filter((office) => office.polityId === polityId && (heldBy.get(office.id)?.length ?? 0) > 0)
      .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0))[0];
    const holderId = ruling === undefined ? undefined : heldBy.get(ruling.id)?.[0];
    return holderId === undefined ? null : link("person", holderId, personName(holderId));
  }

  function formOf(polityId: string): string | null {
    const constitution = world.constitutions.find((candidate) => candidate.polityId === polityId);
    return constitution === undefined ? null : `form:${constitution.form}`;
  }
}

/**
 * Who could hold an office next: the election's own rules (`candidates.ts`).
 * Nominations are public; so is who stands high enough to be talked of.
 * Nobody's private intent is read.
 */
function whoCouldBeNext(
  world: WorldState,
  office: Office,
  officesById: ReadonlyMap<string, Office>,
  viewer: WorldState["characters"][number],
  clock: ScenarioClock | undefined,
): OfficeNext {
  const open = new Set(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);
  const seats = new Set(world.material.officeSeats.filter((seat) => seat.officeId === office.id).map((seat) => seat.id));
  const election = world.material.politicalProcedures.find((procedure) => open.has(procedure.stage) && procedure.subjectKind === "office_seat"
    && (procedure.subjectId === null ? labelNamesOffice(procedure.label, office.label) : seats.has(procedure.subjectId)));
  const person = (id: string): Linked | null => {
    const found = world.characters.find((character) => character.id === id);
    return found === undefined ? null : { label: found.name, key: entityKey("person", id) };
  };
  const standing = world.material.politicalProcedures
    .filter((procedure) => open.has(procedure.stage) && procedure.visibility === "public" && procedure.subjectKind === "character" && procedure.subjectId !== null
      && (procedure.type === "nomination" || procedure.type === "appointment") && labelNamesOffice(procedure.label, office.label))
    .map((procedure) => person(procedure.subjectId!))
    .filter((linked): linked is Linked => linked !== null);
  const likely = electableFor(world, office, officesById, world.elapsedStep);
  const talkedOf = likely.slice(0, 4).map((character) => person(character.id)).filter((linked): linked is Linked => linked !== null && !standing.some((s) => s.key === linked.key));
  const { requirementIds, minStanding } = officeRequirements(world, office);
  const beneath = isBeneath(world, office, officesById, viewer);
  const refusal = admissionRefusal(world, office, requirementIds, viewer, world.elapsedStep);
  const couldStand = !beneath && refusal === null;
  const talkedOfYou = likely.slice(0, 4).some((character) => character.id === viewer.id);
  // Why not, in numbers: the note said nothing at all to a man who could not
  // stand, so a legionary at 2,900 could not tell he was one deed short.
  const gate = standingGateOf(world, office);
  const whyNot = refusal === null || beneath ? null
    : gate !== null && viewer.prestigeBps < gate
      ? `Not yet: you stand at ${formatStanding(viewer.prestigeBps)}; the office asks ${formatStanding(gate)}.`
      : `Not yet: ${refusal}`;
  const due = election?.deadlineStep ?? null;
  return {
    pollingLabel: due === null ? null : `Polling day is ${clock === undefined ? `day ${due}` : formatWorldDate({ day: due, minute: 0 }, clock)}`,
    standing,
    talkedOf: talkedOf.filter((linked) => linked.key !== entityKey("person", viewer.id)),
    youLabel: talkedOfYou ? "You are talked of for it." : couldStand && viewer.prestigeBps >= minStanding ? "You could stand." : couldStand ? "You could stand, though few would think of you for it." : whyNot,
  };
}

/**
 * If nothing changes: how long a force's supplies last, and when a siege it
 * lays or suffers should end, by the engine's own rate (`siegePressurePerDayBps`).
 */
/** What it should come to if nothing changes, and the rules those lines follow (`explanations.ts`). */
function forceProjections(
  world: WorldState,
  force: WorldState["material"]["forces"][number],
  yours: boolean,
  clock: ScenarioClock | undefined,
): { readonly lines: string[]; readonly rules: string[] } {
  const now = world.elapsedStep;
  const dateOf = (day: number): string => (clock === undefined ? `day ${day}` : formatWorldDate({ day, minute: 0 }, clock));
  const lines: string[] = [];
  const rules: string[] = [];
  if (yours) {
    rules.push("rule:supply");
    const left = force.provisionedThroughStep - now;
    lines.push(left <= 0 ? "Its supplies have run out." : `Its supplies last until about ${dateOf(force.provisionedThroughStep)}.`);
  }
  for (const siege of world.sieges) {
    if (siege.status !== "active" || siege.provinceId !== force.locationId) continue;
    const laying = siege.forceId === force.id;
    const suffering = !laying && force.polityId === siege.defenderPolityId;
    if (!laying && !suffering) continue;
    const besieger = world.material.forces.find((candidate) => candidate.id === siege.forceId);
    const defenders = world.material.forces
      .filter((candidate) => candidate.locationId === siege.provinceId && candidate.polityId === siege.defenderPolityId)
      .reduce((sum, candidate) => sum + fitOf(candidate), 0);
    const perDay = siegePressurePerDayBps(besieger === undefined ? 0 : fitOf(besieger), defenders, siegeWalls(world, siege));
    if (perDay <= 0) continue;
    const day = now + Math.ceil((10_000 - siege.pressureBps) / perDay);
    const place = world.map.provinces.find((province) => province.id === siege.provinceId)?.name ?? "the city";
    lines.push(laying ? `If nothing changes, ${place} should yield around ${dateOf(day)}.` : `If nothing changes, the walls of ${place} hold until about ${dateOf(day)}.`);
    if (!rules.includes("rule:siege")) rules.push("rule:siege");
  }
  return { lines, rules };
}

function termWords(days: number): string {
  if (days % 365 === 0) return days === 365 ? "a year" : `${days / 365} years`;
  if (days >= 330 && days <= 400) return "about a year";
  if (days % 30 === 0 || days > 60) return `${Math.round(days / 30)} months`;
  return `${days} days`;
}

/** How the viewer knows this person. */
function personSources(world: WorldState, viewerId: string, subjectId: string, how: "dealt_with" | "corresponded" | "heard_of", holdsOffice: boolean): Source[] {
  const sources: Source[] = [];
  const viewer = world.characters.find((character) => character.id === viewerId);
  const subject = world.characters.find((character) => character.id === subjectId);
  if (viewer !== undefined && subject !== undefined && subject.alive && viewer.locationProvinceId === subject.locationProvinceId) {
    sources.push({ channel: "own_eyes", fromLabel: null, asOfStep: world.elapsedStep });
  }
  if (how === "dealt_with" && viewer !== undefined) {
    const steps = [
      ...(viewer.relations.find((relation) => relation.subjectCharacterId === subjectId)?.causes ?? []).map((cause) => cause.occurredAtStep),
      ...(subject?.relations.find((relation) => relation.subjectCharacterId === viewerId)?.causes ?? []).map((cause) => cause.occurredAtStep),
    ];
    sources.push({ channel: "dealings", fromLabel: null, asOfStep: steps.length === 0 ? 0 : Math.max(...steps) });
  }
  const letters = world.diplomacy.filter((message) => message.fromCharacterId === subjectId && message.toCharacterId === viewerId && isDelivered(message, world.elapsedStep));
  for (const letter of letters) sources.push({ channel: "letter", fromLabel: subject?.name ?? null, asOfStep: letter.sentAtStep });
  for (const belief of world.characterBeliefs) {
    if (belief.holderCharacterId !== viewerId || belief.status !== "active" || belief.subjectEntityId !== subjectId) continue;
    const from = belief.sourceCharacterId === null ? null : world.characters.find((character) => character.id === belief.sourceCharacterId)?.name ?? null;
    sources.push({ channel: beliefChannel(belief), fromLabel: from, asOfStep: belief.learnedAtStep });
  }
  if (holdsOffice) sources.push({ channel: "record", fromLabel: null, asOfStep: world.elapsedStep });
  return sources;
}

/**
 * What the viewer can say of an army that is not theirs: a range, with where
 * it came from. Seen with their own eyes where it stands on ground of theirs,
 * else the newest report they know of, else nothing. The model's slice, the
 * map and the world's own people all use this, so none of them knows a figure
 * the viewer does not.
 *
 * A report says what the army was when it was made (`Fact.forcesAsReported`),
 * not what it is now: a scout's count from before a battle does not know the
 * battle's dead.
 */
export function strangerStrength(
  force: WorldState["material"]["forces"][number],
  seenProvinceIds: ReadonlySet<string>,
  knownFacts: readonly Fact[],
  viewerId: string,
  nowStep: number,
): { readonly label: string; readonly source: Source | null; readonly men: number | null } {
  const report = seenProvinceIds.has(force.locationId)
    ? { source: { channel: "own_eyes" as const, fromLabel: null, asOfStep: nowStep }, men: fitOf(force) }
    : lastReportOf(knownFacts, force, viewerId);
  if (report === null) return { label: "unknown to you", source: null, men: null };
  const { source, men } = report;
  const estimate = estimateMen(men, source.channel, nowStep - source.asOfStep, [force.id, viewerId, source.asOfStep]);
  return { label: estimate.label, source, men: Math.round((estimate.low + estimate.high) / 2) };
}

/** The newest fact the viewer knows that names this force, as a source, with the men it counted. */
function lastReportOf(facts: readonly Fact[], force: WorldState["material"]["forces"][number], viewerId: string): { readonly source: Source; readonly men: number } | null {
  let newest: Fact | null = null;
  for (const fact of facts) {
    if (!fact.affectedEntities.some((entity) => entity.kind === "force" && entity.id === force.id)) continue;
    if (newest === null || fact.time.day > newest.time.day) newest = fact;
  }
  if (newest === null) return null;
  // What it said then; a fact from before reports kept their count has only today's.
  const men = newest.forcesAsReported?.find((entry) => entry.forceId === force.id)?.men ?? fitOf(force);
  const mine = newest.discovery.discoveredBy.find((entry) => entry.observerRef.id === viewerId);
  if (mine !== undefined) return { source: { channel: DISCOVERY_CHANNEL[mine.via], fromLabel: null, asOfStep: mine.atInstant.day }, men };
  return { source: { channel: newest.discovery.state === "rumoured" ? "rumour" : "report", fromLabel: null, asOfStep: newest.time.day }, men };
}

/**
 * Only the notes somebody can actually reach. There are hundreds of provinces
 * and offices in the world, and a note nobody links to is weight sent for
 * nothing. Starting from the people, forces and powers the viewer deals in,
 * this keeps whatever those name, and whatever that names, and so on.
 */
function reachable(notes: Partial<Record<EntityKey, EntityNote>>, roots: readonly EntityKey[]): Partial<Record<EntityKey, EntityNote>> {
  const kept: Partial<Record<EntityKey, EntityNote>> = {};
  const queue = [...roots];
  while (queue.length > 0) {
    const key = queue.pop()!;
    const note = notes[key];
    if (note === undefined || kept[key] !== undefined) continue;
    kept[key] = note;
    for (const linked of linksOf(note)) if (linked.key !== null) queue.push(linked.key);
  }
  return kept;
}

function linksOf(note: EntityNote): readonly Linked[] {
  const all: (Linked | null)[] = note.kind === "person" ? [note.office, note.polity, note.where, ...note.people.map((tie) => tie.who)]
    : note.kind === "place" ? [note.holder, ...note.forcesHere]
      : note.kind === "force" ? [note.polity, note.commander, note.where]
        : note.kind === "power" ? [note.ruler]
          : [note.polity, ...note.holders];
  return all.filter((linked): linked is Linked => linked !== null);
}

/** Drop the keys of links whose target has no note, so a name never opens nothing. */
function prune(notes: Partial<Record<EntityKey, EntityNote>>): Glossary {
  const has = (linked: Linked | null): Linked | null =>
    linked === null ? null : linked.key !== null && notes[linked.key] !== undefined ? linked : { label: linked.label, key: null };
  const out: Partial<Record<EntityKey, EntityNote>> = {};
  for (const [key, note] of Object.entries(notes) as [EntityKey, EntityNote][]) {
    switch (note.kind) {
      case "person": out[key] = { ...note, office: has(note.office), polity: has(note.polity), where: has(note.where), people: note.people.map((tie) => ({ role: tie.role, who: has(tie.who)! })) }; break;
      case "place": out[key] = { ...note, holder: has(note.holder), forcesHere: note.forcesHere.map((f) => has(f)!) }; break;
      case "force": out[key] = { ...note, polity: has(note.polity), commander: has(note.commander), where: has(note.where) }; break;
      case "power": out[key] = { ...note, ruler: has(note.ruler) }; break;
      case "office": out[key] = { ...note, polity: has(note.polity), holders: note.holders.map((h) => has(h)!), next: note.next === null ? null : { ...note.next, standing: note.next.standing.map((l) => has(l)!), talkedOf: note.next.talkedOf.map((l) => has(l)!) } }; break;
    }
  }
  return out;
}

