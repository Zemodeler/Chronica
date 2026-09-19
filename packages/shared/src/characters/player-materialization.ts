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

  // A researched character whose role names a real office in their own polity,
  // and where that office has a seat free, starts holding it. This is the only
  // mechanical link between character creation and the canonical Authority
  // projection (characters/authority-projection.ts); a role that names no
  // office, or one whose seats are all filled, leaves officeId null rather
  // than granting power the scenario did not actually have to give.
  const matched = findOfficeSeatForRole(world, scenarioGovernment, location.controllerPolityId, knowledgebase.role);
  const officeId = matched?.office.id ?? null;
  const playerCharacter: WorldState["characters"][number] = {
    id: actorCharacterId,
    name: knowledgebase.canonicalName,
    cultureId,
    faithId: null,
    dynastyId: null,
    locationProvinceId: location.id,
    polityId: location.controllerPolityId,
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
