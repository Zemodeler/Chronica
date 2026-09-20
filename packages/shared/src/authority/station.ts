import { buildAuthorityIndex, deriveOfficeGrants, isActive, type AuthorityGrant } from "./authority-grant";
import type { AuthorityDomain } from "./vocabulary";
import { allOffices, type Office } from "../characters/character";
import { factsKnownTo, type Fact } from "../world/facts";
import type { WorldInstant } from "../world/instant";
import type { WorldState } from "../world/world-state";

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
  /** People they have a relation, a commitment or a promise with, either way round. */
  readonly knownCharacterIds: ReadonlySet<string>;
  /** Matters they are caught up in. */
  readonly storylineIds: ReadonlySet<string>;
}

export interface StationInput {
  readonly world: WorldState;
  readonly characterId: string;
  readonly offices: readonly Office[];
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

  const index = buildAuthorityIndex(world.material, world.authorityGrants, offices, world.elapsedStep);
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

/** Any polity-wide standing at all. The line between the government and a private person. */
export function holdsPolityStanding(station: Station): boolean {
  return station.grants.some((grant) => grant.scope.kind === "polity" && grant.scope.id === station.polityId);
}

export const seesAccount = (station: Station, accountId: string): boolean =>
  station.accountIds.has(accountId) || speaksForPolity(station, "fiscal");

export const seesForce = (station: Station, forceId: string): boolean =>
  station.forceIds.has(forceId) || speaksForPolity(station, "military");

export const seesProvince = (station: Station, provinceId: string): boolean =>
  station.provinceIds.has(provinceId) || holdsPolityStanding(station);

export const knowsPerson = (station: Station, characterId: string): boolean =>
  station.knownCharacterIds.has(characterId) || station.characterId === characterId || holdsPolityStanding(station);

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
 * station actually reaches.
 */
export function factsKnownToStation(facts: readonly Fact[], station: Station, atInstant: WorldInstant): Fact[] {
  const known = factsKnownTo(facts, { kind: "character", id: station.characterId }, station.polityId, atInstant);
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
  const nameOf = (scope: AuthorityGrant["scope"]): string => {
    switch (scope.kind) {
      case "polity": return world.map.polities.find((polity) => polity.id === scope.id)?.name ?? scope.id;
      case "province": return world.map.provinces.find((province) => province.id === scope.id)?.name ?? scope.id;
      case "force": return world.material.forces.find((force) => force.id === scope.id)?.name ?? scope.id;
      case "institution": return world.material.institutions.find((institution) => institution.id === scope.id)?.name ?? scope.id;
      case "account": {
        const account = world.material.accounts.find((candidate) => candidate.id === scope.id);
        if (account === undefined) return scope.id;
        if (account.owner.kind === "polity") return `the ${world.map.polities.find((polity) => polity.id === account.owner.id)?.name ?? account.owner.id} treasury`;
        const owner = world.characters.find((character) => character.id === account.owner.id);
        return owner === undefined ? scope.id : `${owner.name}'s purse`;
      }
      default: return scope.id;
    }
  };

  const seen = new Set<string>();
  const lines: string[] = [];
  for (const grant of [...station.grants].sort((a, b) => a.domain.localeCompare(b.domain) || a.scope.id.localeCompare(b.scope.id))) {
    const line = `${grant.powers.join(", ")} in ${grant.domain} matters, over ${nameOf(grant.scope)} [${grant.scope.id}].`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  return lines;
}
