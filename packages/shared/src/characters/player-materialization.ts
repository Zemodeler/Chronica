import type { WorldState } from "../world/world-state";
import type { CharacterKnowledgebase } from "./knowledgebase";
import type { Office, ScenarioGovernmentRules } from "./character";
import { deriveDefaultMind } from "./mind";

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
  const roleTokens = labelTokens(role);
  if (roleTokens.size === 0) return undefined;
  return offices.find((office) => {
    if (office.polityId !== polityId) return false;
    const officeTokens = labelTokens(office.label);
    return officeTokens.size > 0 && [...officeTokens].every((token) => roleTokens.has(token));
  });
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
    const officeTokens = labelTokens(office.label);
    if (officeTokens.size === 0) continue;
    const named = [...officeTokens].every((token) => roleTokens.has(token));
    if (!named) continue;

    const seats = world.material.officeSeats.filter((seat) => seat.officeId === office.id);
    const vacant = seats.find((seat) => seat.status !== "held" && seat.holderCharacterId === null);
    if (vacant !== undefined) return { office, vacantSeatId: vacant.id };
    // No authored seat at all: the office exists but nobody has ever been
    // seated in it, so the player may take the first one.
    if (seats.length === 0) return { office, vacantSeatId: null };
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
  "admiral", "navarch", "chieftain", "warlord", "soldier", "officer", "strategos",
];

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
  // office, or one whose seats are all filled, leaves officeId null rather
  // than granting power the scenario did not actually have to give.
  const matched = findOfficeSeatForRole(world, scenarioGovernment, declaredPolityId, knowledgebase.role);
  const officeId = matched?.office.id ?? null;
  const playerCharacter: WorldState["characters"][number] = {
    id: actorCharacterId,
    name: knowledgebase.canonicalName,
    cultureId,
    faithId: null,
    dynastyId: null,
    locationProvinceId: location.id,
    polityId: declaredPolityId,
    ageYearsAtStart: 35,
    officeId,
    personalAccountId: accountId,
    skills: knowledgebase.skills,
    traits: [],
    mind: deriveDefaultMind({ officeId, skills: knowledgebase.skills, ageYears: 35, cultureId }),
    healthBps: 10_000,
    prestigeBps: 3_000,
    relations: [],
    ambitions: [],
    heirCharacterId: null,
    alive: true,
    diedAtStep: null,
    disqualifyingStatuses: [],
    birthStep: null,
    nextLifeReviewAtStep: null,
  };

  // Fixed id and fixed numbers: `materializePlayerCharacter` is a pure
  // projection re-run by read paths, so anything it creates must be the same
  // thing every time it is called.
  const command = findCommandForRole(world, declaredPolityId, knowledgebase.role, location.id);
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
      }];

  const officeSeats = matched === undefined
    ? world.material.officeSeats
    : matched.vacantSeatId !== null
      ? world.material.officeSeats.map((seat) => (seat.id === matched.vacantSeatId
        ? { ...seat, holderCharacterId: actorCharacterId, status: "held" as const, vacancyCause: "none" as const, termStartedAtStep: world.elapsedStep }
        : seat))
      : [...world.material.officeSeats, {
        id: `${matched.office.id}:seat:0`,
        officeId: matched.office.id,
        seatIndex: 0,
        holderCharacterId: actorCharacterId,
        status: "held" as const,
        vacancyCause: "none" as const,
        termStartedAtStep: world.elapsedStep,
        termExpiresAtStep: null,
        appointmentProcedureId: null,
        removalProcedureId: null,
        eligibilityRequirementIds: matched.office.eligibilityRequirementIds,
      }];

  return {
    ...world,
    characters: [...world.characters, playerCharacter],
    material: {
      ...world.material,
      // A role that says they command men gives them men to command. Nothing
      // else in declaration ever produced a force, so a declared legate held
      // no command -- and command authority is derived from a force, never
      // from a title.
      forces: commandedForces,
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
