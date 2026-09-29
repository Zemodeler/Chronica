import { buildAuthorityIndex, deriveOfficeGrants, isActive, type AuthorityGrant, type AuthorityIndex } from "./authority-grant";
import type { AuthorityDomain } from "./vocabulary";
import { allOffices, type Office } from "../characters/character";
import { factsKnownTo, type Fact } from "../world/facts";
import type { NewsWorld } from "../world/news";
import { isDelivered } from "../world/diplomacy";
import type { WorldInstant } from "../world/instant";
import type { WorldState } from "../world/world-state";
import { accountLabel } from "../material/account-names";

/**
 * A person's station: what their place in the world actually reaches.
 *
 * Chronica's premise is that the player is a character -- a consul, a merchant,
 * a soldier -- and that the world around them differs accordingly. Measured, it
 * did not. Two world slices built from the same world, one for a consul and one
 * for a private citizen of the same polity, differed by **one line out of a
 * hundred and forty-three**: the citizen read the consul's purse, the field
 * army's morale, the Senate's internal weights, and every letter Rome had sent.
 *
 * The cause is that every scoping decision in the engine asks which *polity*
 * somebody belongs to. That is the right question for secrecy between powers and
 * the wrong one for everything else, because a republic contains a consul and a
 * grain merchant and tells them both the same things.
 *
 * So this is the other question, asked once and answered in one place. It is a
 * projection of state the world already keeps -- office seats, force command,
 * account access, holdings, the people you know -- and it derives nothing new:
 * `buildAuthorityIndex` already computes exactly who may do what, and this reads
 * it rather than recomputing it a second way. Where the two could disagree, they
 * cannot, because there is only one of them.
 *
 * ## Sight is not permission
 *
 * Nothing here is consulted by `checkAuthority`. A station says what a person is
 * placed to *know*; whether they may *act* remains the authority index's
 * business, computed from world state at the moment of the act. Keeping the two
 * apart is not fastidiousness: this module deliberately grants sight in one case
 * where the world has not recorded the power (see `grantsFromClaimedOffice`),
 * and a station that leaked into the authority check would turn that kindness
 * into a way of acquiring power by claiming it.
 */

export interface StationSeat {
  readonly seatId: string;
  readonly office: Office;
}

export interface Station {
  readonly characterId: string;
  readonly polityId: string | null;
  /** Every active grant this person holds, from the authority index. Never recomputed here. */
  readonly grants: readonly AuthorityGrant[];
  readonly seats: readonly StationSeat[];
  /** Accounts they own, are named on, or reach through an office's treasury. */
  readonly accountIds: ReadonlySet<string>;
  /** Forces they command or control. */
  readonly forceIds: ReadonlySet<string>;
  /** Bodies they sit in: institutions of a polity where they hold an office. */
  readonly institutionIds: ReadonlySet<string>;
  /** Questions they are party to -- sponsor, eligible participant, or subject. */
  readonly procedureIds: ReadonlySet<string>;
  readonly holdingIds: ReadonlySet<string>;
  /** Ground they stand on, hold in, or have an army in. */
  readonly provinceIds: ReadonlySet<string>;
  /** People they have a relation, a commitment or a promise with, either way round, and the men they serve with. */
  readonly knownCharacterIds: ReadonlySet<string>;
  /** Matters they are caught up in. */
  readonly storylineIds: ReadonlySet<string>;
}

export interface StationInput {
  readonly world: WorldState;
  readonly characterId: string;
  readonly offices: readonly Office[];
  /**
   * The authority index, when the caller already built it for this world: the
   * attention router asks for every character's station each round, and the
   * index is the same for all of them.
   */
  readonly authority?: AuthorityIndex | undefined;
}

/** Marks a grant that exists for sight alone. It must never reach an authority check. */
export const CLAIMED_OFFICE_SOURCE_REF = "claimed-office";

/**
 * Sight for an office the world has not written down.
 *
 * A declared player carries `character.officeId` from
 * `findOfficeSeatForRole`'s word-overlap match against the scenario's offices,
 * and that match can set the field without finding a free seat to put them in.
 * Judged on seats alone such a consul would be shown a private citizen's view of
 * his own republic -- which is the false-insubordination failure arriving by a
 * new road, since he would then order things the prompt never told him he held.
 *
 * So a claimed office confers the sight the office would confer, and nothing
 * else. The grants are built by `deriveOfficeGrants` from a synthetic seat, so
 * they say exactly what a real seat would say, and are marked so a test can
 * prove they never leave this module for one that decides what may be done.
 */
function grantsFromClaimedOffice(world: WorldState, characterId: string, officeId: string, offices: readonly Office[]): AuthorityGrant[] {
  const office = offices.find((candidate) => candidate.id === officeId);
  if (office === undefined) return [];
  const seated = world.material.officeSeats.some((seat) => seat.status === "held" && seat.holderCharacterId === characterId && seat.officeId === officeId);
  if (seated) return [];
  return deriveOfficeGrants(
    [{
      id: `${CLAIMED_OFFICE_SOURCE_REF}:${characterId}`,
      officeId,
      seatIndex: 0,
      holderCharacterId: characterId,
      status: "held" as const,
      vacancyCause: "none" as const,
      termStartedAtStep: world.elapsedStep,
      termExpiresAtStep: null,
      appointmentProcedureId: null,
      removalProcedureId: null,
      eligibilityRequirementIds: [],
    }],
    offices,
    world.elapsedStep,
  ).map((grant) => ({ ...grant, sourceRef: CLAIMED_OFFICE_SOURCE_REF }));
}

export function buildStation(input: StationInput): Station {
  const { world, characterId } = input;
  // Including the ones the world has made since it opened: an office invented
  // for this war confers sight exactly as an authored one does.
  const offices = allOffices(world, input.offices);
  const character = world.characters.find((candidate) => candidate.id === characterId);
  const polityId = character?.polityId ?? null;

  const index = input.authority ?? buildAuthorityIndex(world.material, world.authorityGrants, offices, world.elapsedStep);
  const held = index.grants.filter((grant) => grant.holder.kind === "character" && grant.holder.id === characterId);
  const claimed = character?.officeId == null ? [] : grantsFromClaimedOffice(world, characterId, character.officeId, offices);
  const grants = [...held, ...claimed].filter((grant) => isActive(grant, world.elapsedStep));

  const seats: StationSeat[] = world.material.officeSeats
    .filter((seat) => seat.status === "held" && seat.holderCharacterId === characterId)
    .flatMap((seat) => {
      const office = offices.find((candidate) => candidate.id === seat.officeId);
      return office === undefined ? [] : [{ seatId: seat.id, office }];
    });
  // A claimed office is a seat for the purpose of being shown things.
  const claimedOffice = character?.officeId == null || seats.some((seat) => seat.office.id === character.officeId)
    ? undefined
    : offices.find((candidate) => candidate.id === character.officeId);
  if (claimedOffice !== undefined) seats.push({ seatId: `${CLAIMED_OFFICE_SOURCE_REF}:${characterId}`, office: claimedOffice });

  const accountIds = new Set<string>([
    ...world.material.accounts.filter((account) => account.owner.kind === "character" && account.owner.id === characterId).map((account) => account.id),
    ...world.material.accountAccess.filter((access) => access.characterId === characterId).map((access) => access.accountId),
    ...seats.flatMap((seat) => (seat.office.treasuryAccountId === null ? [] : [seat.office.treasuryAccountId])),
  ]);
  if (character?.personalAccountId != null) accountIds.add(character.personalAccountId);

  const forceIds = new Set(
    world.material.forces
      .filter((force) => force.commanderCharacterId === characterId || force.controllerCharacterId === characterId)
      .map((force) => force.id),
  );

  // The chest an army carries belongs to the man who commands it, not to
  // whoever keeps the state's books: it is where plunder lands and what he
  // pays his men out of when nobody else is paying them. Added after the
  // forces because it is derived from them.
  for (const account of world.material.accounts) {
    if (account.owner.kind === "force" && forceIds.has(account.owner.id)) accountIds.add(account.id);
  }

  // The army a man serves in is his to see and his own business -- its
  // strength, its morale, where it stands, who commands it -- as it is not his
  // to command. Added after the chest, which stays the commander's.
  for (const force of world.material.forces) {
    if (force.memberCharacterIds.includes(characterId)) forceIds.add(force.id);
  }

  // Voting blocs name interests, not people, so membership of a body is read
  // from holding an office of its polity -- a consul sits in the Senate --
  // together with any question they have actually been admitted to.
  const seatPolityIds = new Set(seats.map((seat) => seat.office.polityId));
  const procedures = world.material.politicalProcedures.filter(
    (procedure) =>
      procedure.sponsorCharacterId === characterId
      || procedure.eligibleParticipantIds.includes(characterId)
      || (procedure.subjectKind === "character" && procedure.subjectId === characterId),
  );
  const institutionIds = new Set<string>([
    ...world.material.institutions.filter((institution) => seatPolityIds.has(institution.polityId)).map((institution) => institution.id),
    ...procedures.flatMap((procedure) => (procedure.institutionId === null ? [] : [procedure.institutionId])),
  ]);
  const procedureIds = new Set(procedures.map((procedure) => procedure.id));

  const holdings = world.material.holdings.filter((holding) => holding.legalHolderCharacterId === characterId);
  const holdingIds = new Set(holdings.map((holding) => holding.id));

  const provinceIds = new Set<string>([
    ...(character?.locationProvinceId == null ? [] : [character.locationProvinceId]),
    ...holdings.map((holding) => holding.territoryId),
    ...world.material.forces.filter((force) => forceIds.has(force.id)).map((force) => force.locationId),
    // A merchant's route: both ends of every venture still trading are places
    // whose news is his business.
    ...world.material.ventures
      .filter((venture) => venture.ownerCharacterId === characterId && venture.status === "running")
      .flatMap((venture) => [venture.fromProvinceId, venture.toProvinceId]),
  ]);

  const knownCharacterIds = new Set<string>([
    ...(character?.relations ?? []).map((relation) => relation.subjectCharacterId),
    ...world.characters.filter((other) => other.relations.some((relation) => relation.subjectCharacterId === characterId)).map((other) => other.id),
    ...world.commitments.flatMap((commitment) =>
      commitment.promisorCharacterId === characterId
        ? [commitment.beneficiaryCharacterId]
        : commitment.beneficiaryCharacterId === characterId
          ? [commitment.promisorCharacterId]
          : []),
    ...world.orderAttempts.flatMap((attempt) =>
      attempt.issuerRef.id === characterId
        ? [attempt.recipientRef.id]
        : attempt.recipientRef.id === characterId
          ? [attempt.issuerRef.id]
          : []),
  ]);
  // The men one serves beside, and under: a soldier knows his centurion and
  // his tent-mates, and news of them is his news.
  for (const force of world.material.forces) {
    if (!forceIds.has(force.id)) continue;
    knownCharacterIds.add(force.commanderCharacterId);
    for (const memberId of force.memberCharacterIds) knownCharacterIds.add(memberId);
  }
  knownCharacterIds.delete(characterId);

  const storylineIds = new Set(
    world.storylines.filter((storyline) => storyline.participantIds.includes(characterId)).map((storyline) => storyline.id),
  );

  return { characterId, polityId, grants, seats, accountIds, forceIds, institutionIds, procedureIds, holdingIds, provinceIds, knownCharacterIds, storylineIds };
}

/**
 * Whether this person speaks for their whole power in a domain.
 *
 * The test the design turns on, and it needs no new field: `deriveOfficeGrants`
 * already scopes an office's grants to `{kind: "polity"}`, while
 * `deriveCommandGrants` scopes a command to `{kind: "force"}` and
 * `deriveOwnerGrants` scopes a purse to `{kind: "account"}`. So a consul holds
 * polity-scoped grants, a legate holds none, and a merchant holds none.
 * Commanding a legion is not commanding the republic.
 */
export function speaksForPolity(station: Station, domain: AuthorityDomain): boolean {
  return station.grants.some(
    (grant) => grant.domain === domain && grant.scope.kind === "polity" && grant.scope.id === station.polityId,
  );
}

/**
 * Standing that governs: a power-wide grant that does more than put a
 * question. The line between the government and a private person.
 *
 * It was any power-wide grant at all, and every senator holds one -- the
 * right to propose to the whole republic -- so a senator read the treaties,
 * the letters, the trust between powers and the whole record as though he
 * were the consul. Proposing is how a private man is heard, not how a
 * country is run.
 */
export function holdsPolityStanding(station: Station): boolean {
  return station.grants.some((grant) =>
    grant.scope.kind === "polity" && grant.scope.id === station.polityId && grant.powers.some((power) => power !== "propose"));
}

export const seesAccount = (station: Station, accountId: string): boolean =>
  station.accountIds.has(accountId) || speaksForPolity(station, "fiscal");

export const seesForce = (station: Station, forceId: string): boolean =>
  station.forceIds.has(forceId) || speaksForPolity(station, "military");

export const seesProvince = (station: Station, provinceId: string): boolean =>
  station.provinceIds.has(provinceId) || holdsPolityStanding(station);

/**
 * Whether these two have had anything to do with each other.
 *
 * No polity hatch, deliberately. `reachesPerson` below has one and is the
 * right answer to "may this person be shown that figure"; it is the wrong
 * answer to "do they know each other", because under it a consul knows every
 * character in the world -- including a Gallic chieftain he has never heard
 * of. Anything that lists people, or says what the viewer knows of them,
 * wants this one.
 */
export const knowsPerson = (station: Station, characterId: string): boolean =>
  station.knownCharacterIds.has(characterId) || station.characterId === characterId;

/**
 * Whether this person's station reaches that figure at all.
 *
 * The hatch is real and deliberate for the world slice: someone who speaks
 * for a whole power is briefed on its figures whether or not he has dealt
 * with them personally. It is sight, not acquaintance, and the two were one
 * predicate until something needed to ask the other question.
 *
 * Its own power's figures, not the world's. The hatch once opened on every
 * character alive, so a consul read what every Carthaginian suffete and
 * Gallic chieftain privately meant to do. A foreigner is reached the way
 * anybody is: by having dealt with him, written to him or been written to, or
 * standing in the same province.
 */
export function reachesPerson(station: Station, characterId: string, world: Pick<WorldState, "characters" | "diplomacy" | "elapsedStep">): boolean {
  if (knowsPerson(station, characterId)) return true;
  const person = world.characters.find((candidate) => candidate.id === characterId);
  if (person === undefined) return false;
  if (holdsPolityStanding(station) && station.polityId !== null && person.polityId === station.polityId) return true;
  const viewer = world.characters.find((candidate) => candidate.id === station.characterId);
  if (viewer !== undefined && viewer.locationProvinceId === person.locationProvinceId) return true;
  return world.diplomacy.some((message) =>
    (message.fromCharacterId === characterId && message.toCharacterId === station.characterId && isDelivered(message, world.elapsedStep))
    || (message.fromCharacterId === station.characterId && message.toCharacterId === characterId));
}

/**
 * What a person knows, narrowed from what their government knows.
 *
 * `factsKnownTo` treats every `polity`-scoped fact as known to everyone in that
 * polity, which is why a private citizen reads the Senate's dispatches today.
 * It is not changed here: cognition and the Chronicle both call it, and moving
 * three things at once is how the epistemic layer acquires a leak nobody can
 * find. This narrows its answer instead.
 *
 * A polity-scoped fact survives for somebody with polity standing -- the
 * government does read its own dispatches -- or when it names something their
 * station actually reaches. Given the world, all of it waits on the road from
 * where it happened to where they are (`newsArrivesAt`).
 */
export function factsKnownToStation(facts: readonly Fact[], station: Station, atInstant: WorldInstant, world?: NewsWorld): Fact[] {
  const known = factsKnownTo(facts, { kind: "character", id: station.characterId }, station.polityId, atInstant, world);
  if (holdsPolityStanding(station)) return known;
  const reaches = (id: string): boolean =>
    id === station.characterId
    || station.accountIds.has(id)
    || station.forceIds.has(id)
    || station.provinceIds.has(id)
    || station.institutionIds.has(id)
    || station.procedureIds.has(id)
    || station.holdingIds.has(id)
    || station.knownCharacterIds.has(id)
    || station.storylineIds.has(id);
  return known.filter(
    (fact) => fact.visibility !== "polity" || fact.affectedEntities.some((entity) => reaches(entity.id)),
  );
}

/**
 * What their grants permit, in words a prompt can carry.
 *
 * Scopes are named, never left as bare ids: the point of the section is to tell
 * the world who it is speaking for, and "propose over polity:rome" tells it
 * nothing a reader would recognise.
 */
export function describeAuthority(station: Station, world: WorldState): string[] {
  // One derivation, two renderings. The player must not be shown the id, and
  // the model must not lose it, so the split is at the rendering rather than
  // in a second copy of the walk.
  return authorityInWords(station, world).map(
    (phrase) => `${phrase.powers.join(", ")} in ${phrase.domain} matters, over ${phrase.overLabel} [${phrase.scopeId}].`,
  );
}

/** One grant, taken apart so it can be said to a person or to a prompt. */
export interface AuthorityPhrase {
  readonly powers: readonly string[];
  readonly domain: string;
  /** The scope as a reader would name it: "Rome", "the Rome treasury". */
  readonly overLabel: string;
  /** The id the model needs and the player must never be shown. */
  readonly scopeId: string;
}

/**
 * What their grants permit, taken apart.
 *
 * `describeAuthority` renders these for a prompt, id and all. The character
 * panel renders them for a person, who has no use for `[account-rome]` and
 * should not be handed one. Both walk this.
 */
export function authorityInWords(station: Station, world: WorldState): AuthorityPhrase[] {
  const nameOf = (scope: AuthorityGrant["scope"]): string => {
    switch (scope.kind) {
      case "polity": return world.map.polities.find((polity) => polity.id === scope.id)?.name ?? scope.id;
      case "province": return world.map.provinces.find((province) => province.id === scope.id)?.name ?? scope.id;
      case "force": return world.material.forces.find((force) => force.id === scope.id)?.name ?? scope.id;
      case "institution": return world.material.institutions.find((institution) => institution.id === scope.id)?.name ?? scope.id;
      case "account": {
        const account = world.material.accounts.find((candidate) => candidate.id === scope.id);
        return account === undefined ? "an account" : accountLabel(world, account, "clause");
      }
      default: return scope.id;
    }
  };

  const seen = new Set<string>();
  const phrases: AuthorityPhrase[] = [];
  for (const grant of [...station.grants].sort((a, b) => a.domain.localeCompare(b.domain) || a.scope.id.localeCompare(b.scope.id))) {
    // Command of men one's own purse would pay is latent in owning a purse,
    // not a command anybody holds today; said as a military power, a private
    // citizen read as though he led men.
    if (grant.id.endsWith(":company")) continue;
    const key = `${grant.powers.join(", ")} in ${grant.domain} matters, over ${nameOf(grant.scope)} [${grant.scope.id}].`;
    if (seen.has(key)) continue;
    seen.add(key);
    phrases.push({ powers: grant.powers, domain: grant.domain, overLabel: nameOf(grant.scope), scopeId: grant.scope.id });
  }
  return phrases;
}
