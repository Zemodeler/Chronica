import { REFERENCE_PROVINCE_KM, chestOf, treasuryOf, whoIsNamed, type WorldDelta, type WorldState } from "@chronica/shared";
import { placeIndex, provinceNamedByWords, provinceNamedExactly, provincesNamedIn, withinKm, type PlaceIndex } from "../place-index";

/**
 * The ways a model gets a reference almost right, put right before the engine
 * judges the act.
 *
 * Measured on a live run of real orders: most refusals the engine produced were
 * not the world saying no but a reference off by a little. A model
 * copies the first half of a long id, or writes a place by its name where an
 * id was wanted. It pays a temple's keep "from the temple", which has no purse; it creates a
 * herald "in the Morini", a people, where a province was wanted. Each was a
 * refused act, a repair call, and often a lost half of the order -- for a
 * meaning nobody could mistake.
 *
 * Province ids are short and opaque, so a province is put right by what it is
 * called (`place-index.ts`), never by the shape of its id. Only unambiguous
 * corrections: a prefix that fits exactly one thing, a
 * holder that has exactly one account, a power that holds ground. Anything
 * that could mean two things is left to be refused and repaired.
 */

/** How near a place the act's words name must lie to the one written for the words to be what was meant: three reference provinces. */
const CLOSE_PLACE_KM = 3 * REFERENCE_PROVINCE_KM;

/** Shorter than this, a prefix is a guess rather than a truncation. */
const MIN_PREFIX = 12;

/** Built once per world state: a batch applies up to two dozen acts, and most leave the world untouched. */
const idsByWorld = new WeakMap<WorldState, Set<string>>();

function knownIds(world: WorldState): Set<string> {
  const cached = idsByWorld.get(world);
  if (cached !== undefined) return cached;
  const ids = buildKnownIds(world);
  idsByWorld.set(world, ids);
  return ids;
}

function buildKnownIds(world: WorldState): Set<string> {
  return new Set<string>([
    ...world.map.provinces.map((province) => province.id),
    ...world.map.provinces.flatMap((province) => province.settlements.map((settlement) => settlement.id)),
    ...world.map.polities.map((polity) => polity.id),
    ...world.characters.map((character) => character.id),
    ...world.material.forces.map((force) => force.id),
    ...world.material.accounts.map((account) => account.id),
    ...world.material.obligations.map((obligation) => obligation.id),
    ...world.material.institutions.map((institution) => institution.id),
    ...world.offices.map((office) => office.id),
    ...world.projects.map((project) => project.id),
    ...world.structures.map((structure) => structure.id),
    ...world.genericEntities.map((entity) => entity.id),
    ...world.storylines.map((storyline) => storyline.id),
    ...world.diplomacy.map((message) => message.id),
    ...world.polityAgreements.map((agreement) => agreement.id),
  ]);
}

/**
 * The account a holder pays from: a power's treasury, a person's purse, an
 * army's chest -- or, for an arrangement, whatever its owner pays from. A
 * power usually owns several accounts, so "the one account it owns" is the
 * wrong test; its treasury is the one it means.
 */
export function accountOf(world: WorldState, holderId: string): string | null {
  const entity = world.genericEntities.find((candidate) => candidate.id === holderId);
  // An arrangement's own fund first; its owner's purse where it has none.
  if (entity !== undefined) {
    const fund = world.material.accounts.find((account) => account.owner.kind === "entity" && account.owner.id === entity.id && account.status === "active");
    if (fund !== undefined) return fund.id;
    if (entity.ownerRef === null) return null;
  }
  const id = entity?.ownerRef?.id ?? holderId;
  if (world.map.polities.some((polity) => polity.id === id)) return treasuryOf(world, id);
  const person = world.characters.find((character) => character.id === id);
  if (person !== undefined) {
    // Their purse is one they own. `personalAccountId` names it, but it is a
    // pointer that can go stale, and the owner on the account is the truth.
    const owned = world.material.accounts.filter((account) => account.status === "active" && account.owner.kind === "character" && account.owner.id === id);
    return owned.find((account) => account.id === person.personalAccountId)?.id ?? (owned.length === 1 ? owned[0]!.id : null);
  }
  if (world.material.forces.some((force) => force.id === id)) return chestOf(world, id);
  const accounts = world.material.accounts.filter((account) => account.status === "active" && account.owner.id === id);
  return accounts.length === 1 ? accounts[0]!.id : null;
}

/**
 * Where an act's own words say it happens: the provinces its reason and label
 * name, less those named as where it starts. "Legio II marches from Rome to
 * the Praetuttian coast" once sent the legion to Rome, where it already stood.
 */
function placesSaidIn(delta: WorldDelta, index: PlaceIndex): Set<string> {
  const record = delta as Record<string, unknown>;
  const said = ["reason", "label", "summary", "title", "duties"]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string")
    .join(". ")
    .replace(/\b(from|leaves?|leaving|left|out of|departs?|departing|quits?|quitting)\s+[^,.;:]*?(?=\s+(?:to|toward|towards|for|by|over|across|and|via|through)\b|[,.;:]|$)/gi, " ");
  return said.trim().length === 0 ? new Set() : provincesNamedIn(index, said);
}

/** Fields naming where an act goes, as against where it comes from. */
const DESTINATION_FIELDS = new Set(["locationId", "provinceId", "toProvinceId", "targetProvinceId"]);

/** The power behind something that named a province or a city where a power was wanted. */
function polityOf(world: WorldState, id: string): string | null {
  const index = placeIndex(world);
  const province = index.byId.get(id);
  if (province !== undefined) return province.controllerPolityId;
  const home = index.provinceOfSettlement.get(id);
  return home === undefined ? null : index.byId.get(home)?.settlements.find((settlement) => settlement.id === id)?.controllerPolityId ?? null;
}

/** A province for something that named a power or a city where a province was wanted. */
function provinceOf(world: WorldState, id: string): string | null {
  const index = placeIndex(world);
  const city = index.provinceOfSettlement.get(id);
  if (city !== undefined) return city;
  const polity = world.map.polities.find((candidate) => candidate.id === id);
  if (polity === undefined) return null;
  const capital = polity.capitalSettlementId === null ? undefined : index.provinceOfSettlement.get(polity.capitalSettlementId);
  return capital ?? world.map.provinces.find((province) => province.controllerPolityId === polity.id)?.id ?? null;
}

/** Fields naming an army the act can do without: an ambush, allies in a battle. */
const OPTIONAL_FORCE_FIELDS = new Set(["ambushForceRef", "alliedForceRefs"]);
/** Lists of the people or things something touches, where one missing name should not sink the rest. */
const OPTIONAL_LISTS = new Set(["participantRefs", "addParticipantRefs", "targetRefs", "knownToRefs", "subjectRefs"]);

export function normalizeRefs(
  delta: WorldDelta,
  world: WorldState,
  isAssigned: (handle: string) => boolean = () => false,
  resolve: (ref: string) => string | undefined = () => undefined,
): WorldDelta {
  const known = knownIds(world);
  const unique = (test: (id: string) => boolean): string | null => {
    let found: string | null = null;
    for (const id of known) {
      if (!test(id)) continue;
      if (found !== null) return null;
      found = id;
    }
    return found;
  };
  // The start of a long id copied and the rest dropped. It fits one thing, or
  // nothing is guessed. Province ids are too short for this to mean anything;
  // provinces are found by name below.
  const byPrefix = (value: string): string | null => {
    const trimmed = value.replace(/[^A-Za-z0-9._:-]+$/, "");
    return trimmed.length >= MIN_PREFIX ? unique((id) => id.startsWith(trimmed)) : null;
  };
  const places = placeIndex(world);
  // Read once, and only when a province is in question.
  let said: Set<string> | null = null;
  const saidPlaces = (): Set<string> => (said ??= placesSaidIn(delta, places));
  // Where the act already stands or starts: the army's own ground, and any
  // other province the act names in a field of its own.
  let stands: Set<string> | null = null;
  const elsewhere = (): Set<string> => {
    if (stands !== null) return stands;
    const record = delta as Record<string, unknown>;
    // A march is a project whose army is named in what it comes to.
    const outcome = record.completionOutcome as Record<string, unknown> | null | undefined;
    const forceRef = typeof record.forceRef === "string" ? record.forceRef : typeof outcome?.forceRef === "string" ? outcome.forceRef : null;
    const force = forceRef === null ? undefined : world.material.forces.find((candidate) => candidate.id === (resolve(forceRef) ?? forceRef));
    stands = new Set([
      ...(force === undefined ? [] : [force.locationId]),
      ...Object.entries(record).filter(([key, value]) => !DESTINATION_FIELDS.has(key) && typeof value === "string" && /province|location/i.test(key)).map(([, value]) => value as string),
    ]);
    return stands;
  };
  const fix = (key: string, value: string): string | null => {
    // "character:decius-vibellius": the kind written in front of the id, as
    // the prompt writes a reference out. Seven refusals in one live order.
    const kinded = /^(character|polity|province|settlement|force|account|institution|office|project|storyline|procedure|faction|entity|holding|venture|loan|agreement|letter|region):(.+)$/i.exec(value);
    if (kinded !== null) return fix(key, kinded[2]!);
    if (value.startsWith("local:")) {
      const handle = value.slice("local:".length);
      // A handle for somebody or something made earlier in this answer -- the
      // academy, the new magistrate -- named where their money was meant.
      if (/account/i.test(key)) {
        const madeHere = resolve(value);
        if (madeHere !== undefined && !world.material.accounts.some((account) => account.id === madeHere)) {
          const account = accountOf(world, madeHere);
          if (account !== null) return account;
        }
      }
      if (isAssigned(handle)) return value;
      // "local:hieron_heir_purse" for a purse nobody made is the purse of
      // whoever it is named after, where that person exists or was just made.
      if (/account/i.test(key)) {
        const owner = handle.replace(/[-_](purse|treasury|chest|account|funds|estate|coffers)$/i, "");
        const person = resolve(`local:${owner}`) ?? world.characters.find((character) => character.id === owner || character.id.endsWith(`-${owner}`))?.id;
        const account = person === undefined ? null : accountOf(world, person);
        if (account !== null) return account;
      }
      // An army an optional field names and nothing raised, or somebody listed
      // among many who was never made: the plan stands without them, rather
      // than falling with them.
      if (OPTIONAL_FORCE_FIELDS.has(key) || OPTIONAL_LISTS.has(key)) return null;
      return value;
    }
    // An income or a cost that does not exist yet, named as if it did: the
    // field's own null already means "make a new one", which is what was meant.
    if (key === "incomeSourceRef" && !world.material.incomeSources.some((source) => source.id === value)) return null;
    if (key === "obligationRef" && !world.material.obligations.some((obligation) => obligation.id === value)) return null;
    if (/institution/i.test(key) && !world.material.institutions.some((institution) => institution.id === value)) {
      // A treasury or a power named where the body that settles things was
      // wanted: that power's own council, or none -- a decree needs no room.
      // A power with several bodies lists its council first: Rome's Senate
      // before the assemblies that elect its magistrates.
      const polity = world.map.polities.find((candidate) => candidate.id === value)?.id
        ?? world.material.accounts.find((account) => account.id === value && account.owner.kind === "polity")?.owner.id
        ?? polityOf(world, value);
      if (polity != null) {
        const councils = world.material.institutions.filter((institution) => institution.polityId === polity);
        if (councils.length > 0) return councils[0]!.id;
        if (councils.length === 0 && key === "institutionRef") return null;
      }
    }
    const wantsAccount = /account/i.test(key);
    const wantsProvince = /province|location/i.test(key);
    const wantsPolity = /polity/i.test(key);
    if (wantsPolity && !world.map.polities.some((polity) => polity.id === value)) {
      const polity = polityOf(world, value);
      if (polity !== null) return polity;
    }
    const isAccount = world.material.accounts.some((account) => account.id === value);
    const isProvince = places.byId.has(value);
    if (wantsAccount && !isAccount) {
      const account = accountOf(world, value) ?? (known.has(value) ? null : accountOf(world, byPrefix(value) ?? ""));
      if (account !== null) return account;
      // "kent-grain-merchant-account": the account of the merchant, written as
      // an id nobody minted. The same reading as a purse handle, without the
      // "local:" -- whoever it names, made earlier in this answer or before.
      const stem = value.replace(/[-_](purse|treasury|chest|account|funds|estate|coffers)$/i, "");
      if (stem !== value) {
        const holder = resolve(`local:${stem}`) ?? resolve(`local:${stem.replace(/-/g, "_")}`)
          ?? world.characters.find((character) => character.id === stem || character.id.endsWith(`-${stem}`))?.id
          ?? world.genericEntities.find((entity) => entity.id === stem)?.id;
        const theirs = holder === undefined ? null : accountOf(world, holder);
        if (theirs !== null) return theirs;
      }
    }
    if (wantsProvince && isProvince && DESTINATION_FIELDS.has(key)) {
      // A real province, and not the one the act's own words name. Hieron's
      // squadron, sent to Messana, was written with Panormus's id and sailed
      // round the wrong side of the island. Where the words name exactly one
      // place that lies close to the one written (two crossings), and not the
      // one written, the words are what was meant.
      const said = saidPlaces();
      if (said.size > 0 && !said.has(value)) {
        const meant = [...said].filter((id) => withinKm(places, value, id, CLOSE_PLACE_KM) && !elsewhere().has(id));
        if (meant.length === 1) return meant[0]!;
      }
    }
    if (wantsProvince && !isProvince) {
      const named = provinceNamedExactly(places, value);
      if (named !== null) return named;
      const province = provinceOf(world, value) ?? (known.has(value) ? null : provinceOf(world, byPrefix(value) ?? "") ?? byPrefix(value) ?? provinceNamedByWords(places, value));
      if (province !== null) return province;
    }
    if (known.has(value)) return value;
    return byPrefix(value) ?? value;
  };
  const walk = (node: unknown, key: string): unknown => {
    if (typeof node === "string") return /(Ref|Id|Refs|Ids)$/.test(key) || key === "id" ? fix(key, node) : node;
    if (Array.isArray(node)) return node.map((item) => walk(item, key)).filter((item) => item !== null);
    if (node !== null && typeof node === "object") {
      // A `{ kind, id }` reference carries its meaning in the key above it.
      return Object.fromEntries(Object.entries(node).map(([childKey, value]) => [childKey, walk(value, childKey === "id" ? key : childKey)]));
    }
    return node;
  };
  return walk(delta, "") as WorldDelta;
}

/** Fields that name a person. `ownerRef` and the like name a party, which may be a power. */
const PERSON_FIELD = /(character|commander|controller|sponsor|agent|holder|employee)/i;

/**
 * People an answer named and never made.
 *
 * "The Numidian king commands them" with no Numidian king in the world, or a
 * handle written for a priest the answer forgot to create: each was a refused
 * act for want of a row, which is the one refusal the engine must never make.
 * A near match to somebody who exists is taken to be them; anybody else is
 * made, named after how they were referred to, of the power the act concerns.
 * Returns the refs rewritten to point at whoever they now mean, and the
 * people to create first.
 */
export function peopleNamedButNeverMade(
  delta: WorldDelta,
  world: WorldState,
  /** Whether the handle was made -- or tried and refused, in which case the refusal is the honest answer. */
  isAccountedFor: (handle: string) => boolean,
  resolve: (ref: string) => string | undefined = () => undefined,
): { readonly delta: WorldDelta; readonly toMake: readonly { readonly handle: string; readonly name: string }[] } {
  const toMake = new Map<string, string>();
  const nameFrom = (handle: string) => handle.replace(/^local:/, "").split(/[-_\s]+/).filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
  const existing = (handle: string): string | null => {
    const bare = handle.replace(/^local:/, "").toLowerCase();
    const words = bare.split(/[-_\s]+/).filter((word) => word.length > 2);
    const byId = world.characters.find((character) => character.id === bare || character.id.endsWith(`-${bare}`));
    if (byId !== undefined) return byId.id;
    const byName = world.characters.filter((character) => words.length > 0 && words.every((word) => character.name.toLowerCase().includes(word)));
    if (byName.length === 1) return byName[0]!.id;
    // "hiero-ii" for Hieron II: the same name a letter off.
    return byName.length === 0 ? whoIsNamed(world.characters, nameFrom(handle))?.id ?? null : null;
  };
  const fix = (value: string): string => {
    if (value.startsWith("local:")) {
      if (isAccountedFor(value.slice("local:".length))) return value;
    } else if (world.characters.some((character) => character.id === value) || /^(character|office|entity)-/.test(value)) {
      return value;
    } else if (!/^[a-z][a-z0-9_-]*$/.test(value)) {
      // Written as a name -- "Gaius Genucius Clepsina" -- where an id was
      // wanted. The one person it means, or left as written to be refused.
      return whoIsNamed(world.characters, value)?.id ?? value;
    }
    const found = existing(value);
    if (found !== null) return found;
    // A people or a place written where a person was wanted -- "histri-liburni"
    // for the Histri and Liburni -- is a mistake to be repaired, not a man to be
    // made and named after a tribe.
    const bare = value.replace(/^local:/, "");
    if (world.map.polities.some((polity) => polity.id === bare || polity.id.endsWith(`-${bare}`))
      || placeIndex(world).byId.has(bare) || provinceNamedExactly(placeIndex(world), bare) !== null) return value;
    const handle = value.replace(/^local:/, "").replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    toMake.set(handle, nameFrom(value));
    return `local:${handle}`;
  };
  // A thing that exists and is not a person, named in a list of people: the
  // guild among those at the feast. Left out of the list rather than refused
  // with the list; a scalar field keeps it, to be refused on its own terms.
  const notAPerson = (value: string): boolean => {
    const id = value.startsWith("local:") ? resolve(value) : value;
    return id !== undefined && !world.characters.some((character) => character.id === id)
      && (world.genericEntities.some((entity) => entity.id === id) || world.material.forces.some((force) => force.id === id)
        || world.map.polities.some((polity) => polity.id === id));
  };
  const walk = (node: unknown, key: string, parentKind: string | null): unknown => {
    if (typeof node === "string") {
      const personal = (PERSON_FIELD.test(key) && /(Ref|Refs)$/.test(key)) || (key === "id" && parentKind === "character");
      return personal ? fix(node) : node;
    }
    if (Array.isArray(node)) {
      const people = PERSON_FIELD.test(key) && key.endsWith("Refs")
        ? node.filter((item) => typeof item !== "string" || !notAPerson(item))
        : node;
      return people.map((item) => walk(item, key, parentKind));
    }
    if (node !== null && typeof node === "object") {
      const kind = typeof (node as { kind?: unknown }).kind === "string" ? (node as { kind: string }).kind : null;
      return Object.fromEntries(Object.entries(node).map(([childKey, value]) => [childKey, walk(value, childKey, kind)]));
    }
    return node;
  };
  let rewritten = walk(delta, "", null) as WorldDelta;
  // A gathering needs two people; one left alone after the others were taken
  // out is no gathering, and is dropped rather than refusing the rest.
  if (rewritten.op === "social_events" && Array.isArray(rewritten.events)) {
    rewritten = { ...rewritten, events: rewritten.events.filter((event) => !Array.isArray(event.participantCharacterRefs) || event.participantCharacterRefs.length >= 2) };
  }
  return { delta: rewritten, toMake: [...toMake].map(([handle, name]) => ({ handle, name })) };
}
