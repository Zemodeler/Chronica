import { currentAgeYears } from "./age";
import { isMagistracy, type Character, type Office } from "./character";
import { officeNamedIn } from "./player-materialization";
import { resolveEligibility } from "./political-authority";
import { campaignsOf } from "../warfare/service";
import type { PoliticalProcedure } from "../material-state";
import type { WorldState } from "../world/world-state";

/**
 * Who could hold an office: the rules an election uses to find its men, kept
 * where both the election (`sim/elections.ts`) and the office's note can
 * read them, so the note's "who could be next" is the election's own answer.
 */

/** The standing below which the electors do not think of a man unprompted. */
export const ELECTABLE_MIN_PRESTIGE_BPS = 5_000;

/** What a campaign served is worth to a man standing for a junior college. */
const SERVICE_BPS_PER_CAMPAIGN = 150;
/** Campaigns past this count for no more. */
const SERVICE_CAMPAIGNS_COUNTED = 10;
/** Below this age, each year younger is worth `YOUTH_BPS_PER_YEAR` to a junior college's electors. */
const YOUTH_AGE = 35;
const YOUTH_BPS_PER_YEAR = 50;

/** What the office's own requirements ask, for eligibility and for standing. */
export function officeRequirements(world: Pick<WorldState, "material">, office: Office): { readonly requirementIds: readonly string[]; readonly minStanding: number } {
  const seat = world.material.officeSeats.find((candidate) => candidate.officeId === office.id);
  const requirementIds = seat?.eligibilityRequirementIds ?? office.eligibilityRequirementIds;
  const minStanding = world.material.eligibilityRequirements
    .filter((requirement) => requirement.kind === "min_prestige" && requirementIds.includes(requirement.id))
    .map((requirement) => (requirement.params.minPrestigeBps as number | undefined) ?? 0)[0] ?? ELECTABLE_MIN_PRESTIGE_BPS;
  return { requirementIds, minStanding };
}

/**
 * A college elected for a term that is no magistracy: Rome's sixteen
 * military tribunes, chosen each year from young men who had served. It had
 * no rung, so nothing was beneath anybody, and the electors -- counting raw
 * standing -- filled all sixteen places with former consuls.
 */
export function isJuniorCollege(office: Office): boolean {
  return office.rank === undefined && !isMagistracy(office) && office.seatCount !== undefined && office.termDays != null;
}

/** Its place on the ladder: the office's own rank, and a junior college at its foot. */
export function ladderRungOf(office: Office): number | undefined {
  return office.rank ?? (isJuniorCollege(office) ? 0 : undefined);
}

/**
 * Beneath him: a man who holds a magistracy as high as this one, or has held
 * one two rungs above it. A former consul does not stand for quaestor, and
 * the Senate does not think of him for it, though he may put himself
 * forward. A censor might be consul again; it happened.
 */
export function isBeneath(world: Pick<WorldState, "material">, office: Office, officesById: ReadonlyMap<string, Office>, character: Character): boolean {
  const rank = ladderRungOf(office);
  if (rank === undefined) return false;
  // What he sits in today as well as what is written down: a man elected
  // consul this morning has no tenure on record until tomorrow.
  return [
    ...character.officesHeld.map((tenure) => tenure.officeId),
    ...world.material.officeSeats.filter((seat) => seat.holderCharacterId === character.id && seat.status === "held").map((seat) => seat.officeId),
  ].some((officeId) => {
    const held = officesById.get(officeId);
    if (held === undefined || held.polityId !== office.polityId || !isMagistracy(held) || held.rank === undefined) return false;
    const sitting = world.material.officeSeats.some((seat) => seat.officeId === held.id && seat.holderCharacterId === character.id && seat.status === "held");
    return held.rank >= rank + 2 || (sitting && held.rank >= rank);
  });
}

/**
 * Who could hold it: eligible, alive, and not already sitting in it. Only
 * those sitting in this office are kept out: a man cannot hold two seats of
 * one college. Anyone holding some other office used to be kept out as well,
 * so nobody could rise -- a quaestor could never become consul, nor a
 * tribune a praetor.
 */
export function isEligibleFor(world: WorldState, office: Office, requirementIds: readonly string[], character: Character, toDay: number): boolean {
  return admissionRefusal(world, office, requirementIds, character, toDay) === null;
}

/**
 * Why the presiding magistrate would not take a man's name, in the words the
 * man is told: "Vettius lacks the standing: standing 2,190 of 3,000
 * required." Null when he may stand. A man refused used to be dropped from
 * the count without a word, and never learned he had not been on the ballot.
 */
export function admissionRefusal(world: WorldState, office: Office, requirementIds: readonly string[], character: Character, toDay: number): string | null {
  const sitting = world.material.officeSeats.some((seat) => seat.officeId === office.id && seat.status === "held" && seat.holderCharacterId === character.id);
  if (sitting) return `${character.name} already holds it.`;
  if (!character.alive) return `${character.name} is dead.`;
  const result = resolveEligibility({ ...world, elapsedStep: toDay }, character.id, requirementIds, office.id);
  return result.eligible ? null : result.failedReasons.join(" ");
}

/**
 * What the electors weigh a man by. For a magistracy, his standing. For a
 * junior college, his standing and also what he has served and how young he
 * is: the tribunes were picked from the young men of the tribes who had
 * already been under the standards.
 */
export function candidateScore(office: Office, character: Character, toDay: number): number {
  if (!isJuniorCollege(office)) return character.prestigeBps;
  const served = Math.min(SERVICE_CAMPAIGNS_COUNTED, campaignsOf(character)) * SERVICE_BPS_PER_CAMPAIGN;
  const youth = Math.max(0, YOUTH_AGE - currentAgeYears(character, toDay)) * YOUTH_BPS_PER_YEAR;
  return character.prestigeBps + served + youth;
}

/** Who the electors would think of unprompted: eligible, of standing, not above it, likeliest first. */
export function electableFor(
  world: WorldState,
  office: Office,
  officesById: ReadonlyMap<string, Office>,
  toDay: number,
  excludeId: string | null = null,
): Character[] {
  const { requirementIds, minStanding } = officeRequirements(world, office);
  return world.characters
    .filter((character) => character.id !== excludeId && character.prestigeBps >= minStanding && !isBeneath(world, office, officesById, character) && isEligibleFor(world, office, requirementIds, character, toDay))
    .sort((a, b) => candidateScore(office, b, toDay) - candidateScore(office, a, toDay) || a.id.localeCompare(b.id));
}

/** The man a candidacy puts forward: the person it names, or -- for "Gaius stands for consul", written about the office -- whoever moved it. */
export function candidateOf(procedure: PoliticalProcedure): string | null {
  return procedure.subjectKind === "character" ? procedure.subjectId : procedure.sponsorCharacterId;
}

/**
 * The elective office a man stands for: a nomination or appointment of a
 * person, in words that name the office. The most particular office named
 * wins, so "plebeian aedile" is the plebs' and not the curule pair's too.
 */
export function candidacyOffice<T extends Office>(procedure: PoliticalProcedure, electiveOffices: readonly T[]): T | null {
  if (procedure.type !== "nomination" && procedure.type !== "appointment") return null;
  const standsForOne = procedure.subjectKind === "character"
    ? procedure.subjectId !== null
    : procedure.subjectKind === "office_seat" && procedure.type === "nomination";
  return standsForOne ? officeNamedIn(procedure.label, electiveOffices) : null;
}
