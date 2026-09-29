import { boundedId } from "../determinism";
import type { WorldState } from "../world/world-state";
import type { CharacterKnowledgebase } from "./knowledgebase";
import type { Office, ScenarioGovernmentRules } from "./character";
import { deriveDefaultMind } from "./mind";
import { mindShapedBy } from "./mind-drift";
import { canonicalTraitIds } from "./traits";
import { spreadSubSkills } from "./aptitude";
import { faithNamed } from "../world/faith";

// Placing a declared player character into the world.
//
// A player who declares their own character does not exist in the scenario's
// authored world: `players.characterId` is `declared-<playerId>`, and the
// snapshot knows nothing about them until this runs. It is deliberately a pure
// projection rather than a write at confirmation time, so the committed
// snapshot stays something only `commitResolution` produces.
//
// Because it is a projection, every reader must apply it -- otherwise the
// Authority screen, the character panel, and turn resolution disagree about
// who the player is and what they hold. That is why it lives here rather than
// inside the resolution pipeline, which is where it used to be and where it
// was the only caller.

/** Normalised words of a role or office label, for matching one against the other. */
function labelTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !GENERIC_ROLE_WORDS.has(token)),
  );
}

/**
 * Words that carry no identifying weight in a role or an office label. Without
 * this, "Roman senator" would match the "Roman consul" office on "roman"
 * alone.
 */
const GENERIC_ROLE_WORDS = new Set([
  "the", "and", "for", "with", "his", "her", "their", "who", "was", "has",
  "of", "in", "at", "to", "a", "an",
  "roman", "carthaginian", "greek", "italic", "republic", "kingdom", "empire", "state",
  "current", "former", "acting", "serving", "senior", "junior",
  "officer", "official", "public", "office", "post", "position", "rank", "title",
]);

/**
 * The office a declared role actually names.
 *
 * Matched on the office label's distinguishing words appearing in the role, in
 * either order and at any distance -- "Consul of the Roman Republic, directing
 * senatorial policy" names the "Roman consul" office, which a substring test
 * in either direction misses entirely.
 *
 * Vacancy is judged per seat, not per office: a consulship with two seats and
 * one sitting consul still has a seat to fill. An office with no seat rows at
 * all is treated as having one implicit seat, which is how a scenario that
 * never authored seats has always behaved.
 */
/**
 * An office of this power whose name the role names, whether or not a seat in
 * it is free.
 *
 * Separate from `findOfficeSeatForRole` because the two questions came apart
 * the moment offices could be created: "is there such an office" and "is there
 * room in it" are different, and answering only the second means a consulship
 * whose seats are both filled looks like no consulship at all -- so the world,
 * asked for another consul, would invent a second consulship rather than
 * enlarging the one that exists.
 */
export function findOfficeForRole(
  offices: readonly Office[],
  polityId: string | null,
  role: string,
): Office | undefined {
  if (polityId === null) return undefined;
  if (labelTokens(role).size === 0) return undefined;
  return offices.find((office) => office.polityId === polityId && labelNamesOffice(role, office.label));
}

/**
 * Whether a piece of text names an office: every meaningful word of the
 * office's label appears in it. "Elect a consul for the year" names "Roman
 * consul" only if it says Roman too, so a Roman office is never matched by a
 * Carthaginian question that happens to share a word.
 */
export function labelNamesOffice(text: string, officeLabel: string): boolean {
  const officeTokens = labelTokens(officeLabel);
  if (officeTokens.size === 0) return false;
  const textTokens = labelTokens(text);
  return [...officeTokens].every((token) => textTokens.has(token));
}

export function findOfficeSeatForRole(
  world: WorldState,
  scenarioGovernment: { readonly offices: readonly Office[] } | undefined,
  polityId: string | null,
  role: string,
): { readonly office: Office; readonly vacantSeatId: string | null } | undefined {
  if (!scenarioGovernment || polityId === null) return undefined;
  const roleTokens = labelTokens(role);
  if (roleTokens.size === 0) return undefined;

  for (const office of scenarioGovernment.offices) {
    if (office.polityId !== polityId) continue;
    if (!labelNamesOffice(role, office.label)) continue;

    const seats = world.material.officeSeats.filter((seat) => seat.officeId === office.id);
    const vacant = seats.find((seat) => seat.status !== "held" && seat.holderCharacterId === null);
    if (vacant !== undefined) return { office, vacantSeatId: vacant.id };
    // No authored seat at all: the office exists but nobody has ever been
    // seated in it, so the player may take the first one.
    if (seats.length === 0) return { office, vacantSeatId: null };
    // A college bigger than the men it names has places nobody holds on record.
    if (office.seatCount !== undefined && seats.filter((seat) => seat.status === "held").length < office.seatCount) return { office, vacantSeatId: null };
  }
  return undefined;
}

/**
 * Words in a role that mean the person commands men.
 *
 * A default rather than a rule: a scenario may say what its own period calls a
 * command, and this is what a scenario that says nothing gets. The codebase has
 * a standing objection to hardcoded government assumptions, and this is one --
 * a small, overridable one, shipped because blocking on scenario authoring
 * would mean no declared soldier ever holds anything at all.
 */
const COMMAND_ROLE_WORDS = [
  "legate", "commander", "captain", "general", "prefect", "tribune", "centurion",
  "admiral", "navarch", "chieftain", "warlord", "strategos",
];

/**
 * Words in a role that mean the person serves in the ranks.
 *
 * "Soldier" used to be a command word, so a player who declared himself a
 * legionary was handed a retinue of four hundred men and made their commander
 * -- the one thing a legionary is not. A role in this list enlists him in an
 * army of his own power instead (`findEnlistmentForRole`); a role that also
 * names a command ("a veteran centurion") still commands.
 */
const RANKS_ROLE_WORDS = [
  "soldier", "legionary", "legionnaire", "ranker", "hoplite", "spearman", "infantryman",
  "archer", "slinger", "horseman", "cavalryman", "trooper", "rower", "oarsman", "sailor",
  "marine", "mercenary", "veteran", "recruit", "conscript", "warrior", "levy",
];

/**
 * The army a man in the ranks serves in: one of his own power's, the one where
 * he stands if there is one, else the largest. Undefined for a role that names
 * a command (that is `findCommandForRole`'s), one that names no soldiering, or
 * a power with no army at all.
 */
export function findEnlistmentForRole(
  world: WorldState,
  polityId: string | null,
  role: string,
  provinceId: string | null,
): string | undefined {
  if (polityId === null) return undefined;
  const tokens = [...labelTokens(role)];
  if (tokens.some((token) => COMMAND_ROLE_WORDS.includes(token))) return undefined;
  if (!tokens.some((token) => RANKS_ROLE_WORDS.includes(token))) return undefined;
  const strength = (force: WorldState["material"]["forces"][number]) => force.personnel.reduce((sum, category) => sum + category.fit, 0);
  return world.material.forces
    .filter((force) => force.polityId === polityId && strength(force) > 0)
    .sort((a, b) => Number(b.locationId === provinceId) - Number(a.locationId === provinceId) || strength(b) - strength(a) || a.id.localeCompare(b.id))[0]?.id;
}

/**
 * The power a stated role and culture actually name.
 *
 * Matched on the powers that exist in this world rather than on a list, so a
 * scenario about anywhere works: "Consul of the Roman Republic" names Rome
 * because Rome is called "Roman Republic", and "Roman Patrician" names it
 * again. A description naming no power at all returns undefined and the
 * caller falls back to the ground, which is the right answer for a farmer.
 */
export function findPolityForRole(
  world: { readonly map: { readonly polities: readonly { readonly id: string; readonly name: string }[] } },
  role: string,
  culture: string,
): string | undefined {
  const said = `${role} ${culture}`.toLowerCase();
  const words = new Set(said.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 3));

  const scored = world.map.polities
    .map((polity) => {
      const nameWords = polity.name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 3);
      // Every distinctive word of the power's name that the description uses.
      // "Roman Republic" scores twice on "Consul of the Roman Republic", and a
      // power whose name shares nothing with the description scores nothing.
      //
      // Matched on a shared stem rather than a shared word, because a people
      // and their country are rarely spelled the same: a "Carthaginian
      // trader" is a man of Carthage, and nothing that compares whole words
      // will ever say so.
      const hits = nameWords.filter((word) => [...words].some((said) => said.startsWith(word.slice(0, 5)) || word.startsWith(said.slice(0, 5)))).length;
      return { id: polity.id, hits, length: nameWords.length };
    })
    .filter((entry) => entry.hits > 0)
    // The fullest match wins, then the most specific name: "Roman Republic"
    // beats a power merely called "Rome" on a description that says both.
    .sort((a, b) => b.hits - a.hits || a.length - b.length || a.id.localeCompare(b.id));
  return scored[0]?.id;
}

/**
 * A force for somebody whose role says they command one.
 *
 * `findOfficeSeatForRole` was the only path from a declared character to real
 * power, and it only ever found an *office* -- so a player who declared himself
 * a legate of the Sicilian legions got nothing, because "legate" matched no
 * authored office, and command authority is derived from a force rather than a
 * seat. He commanded nothing, and the world was never told he was a soldier.
 *
 * Prefers a force of his own power that has lost its commander. Otherwise mints
 * a small one: retainers, at his own charge, which is what a man without an
 * office actually brings.
 */
export function findCommandForRole(
  world: WorldState,
  polityId: string | null,
  role: string,
  provinceId: string | null,
  commandWords: readonly string[] = COMMAND_ROLE_WORDS,
): { readonly kind: "existing"; readonly forceId: string } | { readonly kind: "new" } | undefined {
  if (polityId === null) return undefined;
  const tokens = labelTokens(role);
  if (![...tokens].some((token) => commandWords.includes(token))) return undefined;
  // A tribune of the plebs is a magistrate of the people, not an officer: he
  // commands no men, and was handed four hundred of them.
  if (tokens.has("tribune") && (tokens.has("plebs") || tokens.has("plebeian") || tokens.has("people")) && ![...tokens].some((token) => token !== "tribune" && commandWords.includes(token))) return undefined;

  const living = new Set(world.characters.filter((character) => character.alive).map((character) => character.id));
  const orphaned = world.material.forces
    .filter((force) => force.polityId === polityId && !living.has(force.commanderCharacterId))
    .sort((a, b) => Number(b.locationId === provinceId) - Number(a.locationId === provinceId) || a.id.localeCompare(b.id))[0];
  return orphaned === undefined ? { kind: "new" } : { kind: "existing", forceId: orphaned.id };
}

/**
 * The world as it stands with the declared player character in it.
 *
 * A no-op — returning the same object — once the character is in the snapshot,
 * which is what happens after their first turn commits. Throws only when the
 * caller asked for a character that neither exists nor has a confirmed
 * knowledgebase to build from.
 */
export function materializePlayerCharacter(
  world: WorldState,
  actorCharacterId: string,
  knowledgebase: CharacterKnowledgebase | null,
  scenarioGovernment: ScenarioGovernmentRules | undefined,
): WorldState {
  if (world.characters.some((character) => character.id === actorCharacterId)) return world;
  if (!knowledgebase || knowledgebase.characterId !== actorCharacterId) {
    throw new Error("The submitted player's character is not present in world state and has no confirmed knowledgebase.");
  }

  const locationProvinceId = knowledgebase.locationProvinceId;
  const location = locationProvinceId === null
    ? undefined
    : world.map.provinces.find((province) => province.id === locationProvinceId);
  if (!location) throw new Error("The submitted player's character has no valid starting location.");

  const taken = knowledgebase.becomesCharacterId == null
    ? undefined
    : world.characters.find((character) => character.id === knowledgebase.becomesCharacterId && character.alive);
  if (taken !== undefined) return takeThePlaceOf(world, taken.id, actorCharacterId, knowledgebase.startingMoney);

  const accountId = `account-${actorCharacterId}`;
  const existingAccount = world.material.accounts.find((account) => account.id === accountId);
  const personalAccount = existingAccount ?? {
    id: accountId,
    owner: { kind: "character" as const, id: actorCharacterId },
    currencyId: world.material.currency.id,
    balance: knowledgebase.startingMoney,
    status: "active" as const,
    visibility: "private" as const,
  };
  const cultureId = `culture-${knowledgebase.culture.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "local"}`;

  /**
   * Whose man this is.
   *
   * It used to be simply whoever controlled the ground he was standing on,
   * which is right for a farmer and catastrophic for anybody else. A player
   * who declared "a Roman consul charged with the northern frontier" was
   * placed on the Insubrian Plain, because that is where the northern frontier
   * is -- and came out an **Insubrian**. Everything downstream then went
   * wrong in ways that looked like separate bugs: his retinue was Insubrian,
   * the legion Rome raised for him was Insubrian, a Roman consul refused his
   * orders on the grounds that "a Roman consul takes orders from Rome", and
   * requisitioning supplies in Insubria was recorded as a breach against a
   * country he was supposedly a citizen of.
   *
   * What a person says they are outranks where they happen to be. The role and
   * the culture name the power; the ground is only the fallback, for somebody
   * whose description names none.
   */
  const declaredPolityId = findPolityForRole(world, knowledgebase.role, knowledgebase.culture) ?? location.controllerPolityId;

  // A researched character whose role names a real office in their own polity,
  // and where that office has a seat free, starts holding it. This is the only
  // mechanical link between character creation and the canonical Authority
  // projection (characters/authority-projection.ts); a role that names no
  // office leaves officeId null rather than granting power the scenario did
  // not actually have to give.
  // A slave holds no office and commands nobody, whatever his role says.
  const legalStatus = knowledgebase.legalStatus ?? "free";
  const unfree = legalStatus === "enslaved";
  // A player who asked for an office the world has, and found every seat of
  // it taken, is still given it: one of the men sitting in it is put out, and
  // the player sits in his chair for the rest of his term. Asked for a consul
  // while both consuls sat, the player used to be seated nowhere, or handed
  // one of the sitting consuls to play.
  const office = unfree || scenarioGovernment === undefined ? undefined : findOfficeForRole(scenarioGovernment.offices, declaredPolityId, knowledgebase.role);
  const free = unfree ? undefined : findOfficeSeatForRole(world, scenarioGovernment, declaredPolityId, knowledgebase.role);
  const putOut = free === undefined && office !== undefined ? seatToPutOutOf(world, office) : undefined;
  const matched = free ?? (putOut === undefined || office === undefined ? undefined : { office, vacantSeatId: putOut.seatId });
  // What he believes and how old he is, as he declared them. Both used to be
  // thrown away -- every player was thirty-five and believed in nothing.
  const believes = knowledgebase.faith === null ? null : faithNamed(world, knowledgebase.faith, world.elapsedStep);
  const ageYears = Math.max(14, Math.min(80, knowledgebase.ageYearsAtOpening ?? 35));
  const officeId = matched?.office.id ?? null;
  // Who he is, from what was said of him. He was a blank: no traits, a mind
  // derived from his skills alone, the standing of nobody in particular, and
  // finer skills all equal to the skill they belong to.
  const skills = { ...knowledgebase.skills, subSkills: spreadSubSkills(actorCharacterId, knowledgebase.skills, knowledgebase.skills.subSkills) };
  const traits = canonicalTraitIds([knowledgebase.role, ...knowledgebase.notableEvents, knowledgebase.biography], DECLARED_TRAITS);
  const mind = mindShapedBy(deriveDefaultMind({ id: actorCharacterId, officeId, skills, ageYears, cultureId }), traits);
  const playerCharacter: WorldState["characters"][number] = {
    id: actorCharacterId,
    name: knowledgebase.canonicalName,
    cultureId,
    faithId: believes?.faithId ?? null,
    dynastyId: null,
    locationProvinceId: location.id,
    polityId: declaredPolityId,
    ageYearsAtStart: ageYears,
    officeId,
    personalAccountId: accountId,
    skills,
    traits,
    mind,
    healthBps: 10_000,
    prestigeBps: declaredStanding(knowledgebase, matched?.office),
    relations: [],
    ambitions: [],
    heirCharacterId: null,
    alive: true,
    diedAtStep: null,
    disqualifyingStatuses: [],
    officesHeld: [],
    eligibilityWaivers: [],
    legalStatus,
    gender: knowledgebase.gender ?? "male",
    ownerCharacterId: null,
    peculium: false,
    birthStep: null,
    nextLifeReviewAtStep: null,
  };

  // Fixed id and fixed numbers: `materializePlayerCharacter` is a pure
  // projection re-run by read paths, so anything it creates must be the same
  // thing every time it is called.
  const command = unfree ? undefined : findCommandForRole(world, declaredPolityId, knowledgebase.role, location.id);
  // A man in the ranks serves in an army, and stands where it stands.
  const enlistedIn = command === undefined && !unfree ? findEnlistmentForRole(world, declaredPolityId, knowledgebase.role, location.id) : undefined;
  const enlistedForce = enlistedIn === undefined ? undefined : world.material.forces.find((force) => force.id === enlistedIn);
  if (enlistedForce !== undefined) playerCharacter.locationProvinceId = enlistedForce.locationId;
  const retinueId = `force-${actorCharacterId}`;
  const commandedForces = command === undefined || world.material.forces.some((force) => force.id === retinueId)
    ? command?.kind === "existing"
      ? world.material.forces.map((force) => (force.id === command.forceId
        ? { ...force, commanderCharacterId: actorCharacterId, controllerCharacterId: actorCharacterId }
        : force))
      : world.material.forces
    : command.kind === "existing"
      ? world.material.forces.map((force) => (force.id === command.forceId
        ? { ...force, commanderCharacterId: actorCharacterId, controllerCharacterId: actorCharacterId }
        : force))
      : [...world.material.forces, {
        id: retinueId,
        name: `${knowledgebase.canonicalName}'s retinue`,
        polityId: declaredPolityId ?? "",
        commanderCharacterId: actorCharacterId,
        controllerCharacterId: actorCharacterId,
        locationId: location.id,
        positionId: null,
        authorizedStrength: 400,
        personnel: [{ categoryId: "infantry", label: "Retainers", fit: 400, unavailable: [] }],
        moraleBps: 5_000,
        cohesionBps: 5_000,
        fatigueBps: 0,
        provisionStatus: "provisioned" as const,
        provisionedThroughStep: world.elapsedStep + 30,
        // Retainers at his own charge: no pay obligation on a treasury he has
        // no office over.
        payObligationId: null,
        payArrearsPeriods: 0,
        history: [],
        memberCharacterIds: [],
      }];

  const officeSeats = matched === undefined
    ? world.material.officeSeats
    : matched.vacantSeatId !== null
      ? world.material.officeSeats.map((seat) => (seat.id === matched.vacantSeatId
        ? { ...seat, holderCharacterId: actorCharacterId, status: "held" as const, vacancyCause: "none" as const, termStartedAtStep: world.elapsedStep }
        : seat))
      : [...world.material.officeSeats, {
        id: boundedId(matched.office.id, "seat", world.material.officeSeats.filter((seat) => seat.officeId === matched.office.id).length),
        officeId: matched.office.id,
        seatIndex: world.material.officeSeats.filter((seat) => seat.officeId === matched.office.id).length,
        holderCharacterId: actorCharacterId,
        status: "held" as const,
        vacancyCause: "none" as const,
        termStartedAtStep: world.elapsedStep,
        termExpiresAtStep: null,
        appointmentProcedureId: null,
        removalProcedureId: null,
        eligibilityRequirementIds: matched.office.eligibilityRequirementIds,
      }];

  // The man put out keeps whatever else he holds -- his seat in the Senate --
  // and is called by that instead.
  const characters = putOut === undefined
    ? world.characters
    : world.characters.map((character) => (character.id === putOut.holderId && character.officeId === matched!.office.id
      ? { ...character, officeId: officeSeats.find((seat) => seat.holderCharacterId === character.id && seat.status === "held")?.officeId ?? null }
      : character));

  return {
    ...world,
    ...(believes === null ? {} : { faiths: believes.world.faiths }),
    characters: [...characters, playerCharacter],
    material: {
      ...world.material,
      // A role that says they command men gives them men to command. Nothing
      // else in declaration ever produced a force, so a declared legate held
      // no command -- and command authority is derived from a force, never
      // from a title.
      forces: enlistedIn === undefined
        ? commandedForces
        : commandedForces.map((force) => (force.id === enlistedIn && !force.memberCharacterIds.includes(actorCharacterId)
          ? { ...force, memberCharacterIds: [...force.memberCharacterIds, actorCharacterId].slice(-40) }
          : force)),
      officeSeats,
      accounts: existingAccount ? world.material.accounts : [...world.material.accounts, personalAccount],
      accountAccess: world.material.accountAccess.some((access) => access.accountId === accountId && access.characterId === actorCharacterId)
        ? world.material.accountAccess
        : [...world.material.accountAccess, {
          id: `access-${actorCharacterId}`,
          characterId: actorCharacterId,
          accountId,
          permissions: ["view" as const, "propose_spending" as const, "spend_without_vote" as const],
          sourceKind: "ownership" as const,
          sourceId: actorCharacterId,
        }],
    },
  };
}

/** The most traits a declaration gives him: what is said of a man before anybody has met him. */
const DECLARED_TRAITS = 3;

/**
 * The standing a declared man starts with: by what he says he is -- a king,
 * a senator, a merchant, a freedman, a slave -- and by the office he takes,
 * higher the higher it stands on the ladder. Everybody used to start at the
 * same three thousand, a consul and a ploughman alike.
 */
export function declaredStanding(
  knowledgebase: Pick<CharacterKnowledgebase, "socioEconomicClass" | "role" | "legalStatus">,
  office: Pick<Office, "rank"> | undefined,
): number {
  const said = `${knowledgebase.socioEconomicClass} ${knowledgebase.role}`.toLowerCase();
  const byStation: readonly [RegExp, number][] = [
    [/\b(king|queen|tyrant|dictator|prince|suffete|consul|basileus|monarch|chief(tain)?)\b/, 7_000],
    [/\b(senator|senatorial|patrician|noble|aristocra\w*|magnate|elder|oligarch\w*|consular)\b/, 5_500],
    [/\b(equestrian|equites|knight|merchant|trader|landowner|wealthy|priest|magistrate)\b/, 4_000],
    [/\b(plebeian|peasant|farmer|commoner|labourer|laborer|craftsman|artisan|soldier|sailor)\b/, 2_000],
    [/\b(freedman|freedwoman|freed)\b/, 1_500],
    [/\b(slave|servant)\b/, 500],
  ];
  let standing = byStation.find(([pattern]) => pattern.test(said))?.[1] ?? 3_000;
  if (office !== undefined) standing = Math.max(standing, 4_000 + (office.rank ?? 0) * 400);
  const status = knowledgebase.legalStatus ?? "free";
  if (status === "enslaved") standing = Math.min(standing, 500);
  if (status === "freed") standing = Math.min(standing, 2_500);
  return Math.max(500, Math.min(9_000, standing));
}

/**
 * Which of an office's sitting holders makes room for a player who asked for
 * it. The one with least in hand -- no force under him, the fewest matters in
 * train -- so the world loses as little as it can: of two consuls, the one
 * keeping the city goes, not the one leading the army south. Ties go to the
 * junior chair.
 */
function seatToPutOutOf(world: WorldState, office: Office): { readonly seatId: string; readonly holderId: string } | undefined {
  const held = world.material.officeSeats.filter((seat) => seat.officeId === office.id && seat.status === "held" && seat.holderCharacterId !== null);
  const load = (characterId: string): number =>
    world.material.forces.filter((force) => force.commanderCharacterId === characterId || force.controllerCharacterId === characterId).length * 10
    + world.storylines.filter((storyline) => storyline.participantIds.includes(characterId)).length;
  const chosen = [...held].sort((a, b) => load(a.holderCharacterId!) - load(b.holderCharacterId!) || b.seatIndex - a.seatIndex)[0];
  return chosen === undefined ? undefined : { seatId: chosen.id, holderId: chosen.holderCharacterId! };
}

/**
 * The player becomes a person the world already has.
 *
 * Every reference to him -- his seats, his purse and who may spend it, the
 * army he commands, the matters he is party to, what others feel about him --
 * is renamed to the player's id, so he is the same man in the same place with
 * the same business, and nothing is left pointing at somebody who is gone.
 * The rename is over whole string values, never substrings: "gaius-purse" is
 * not "gaius-genucius". His purse holds what the player was told it would.
 */
export function takeThePlaceOf(world: WorldState, characterId: string, actorCharacterId: string, startingMoney: number): WorldState {
  const rename = (value: unknown): unknown => {
    if (value === characterId) return actorCharacterId;
    if (Array.isArray(value)) return value.map(rename);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key === characterId ? actorCharacterId : key, rename(entry)]));
  };
  const next = rename(world) as WorldState;
  const purseId = next.characters.find((character) => character.id === actorCharacterId)?.personalAccountId ?? null;
  return purseId === null ? next : {
    ...next,
    material: { ...next.material, accounts: next.material.accounts.map((account) => (account.id === purseId ? { ...account, balance: startingMoney } : account)) },
  };
}
