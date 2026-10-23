import {
  atWar,
  goalMet,
  kmBetween,
  landKmBetween,
  marchDaysFor,
  normalizeName,
  peaceOfferMetadata,
  type DiplomaticMessage,
  type FactProposalDraft,
  type Force,
  type OrderGoal,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";
import { safeLocalId } from "./safe-local-id";

/**
 * The duties a treaty's words put on each side, made things the world can check
 * and, for powers nobody plays, carry out.
 *
 * An accepted peace promised that the Campanians would withdraw from Rhegium
 * and restore it, and recorded one undertaking: Rome's protection. The rest
 * was prose, and "a promise left in a letter's prose binds nobody". Now:
 *
 *  - **Terms are read for duties.** A sentence that has a power withdraw from,
 *    or restore, a place named in it becomes that power's undertaking if no
 *    clause already is (`impliedUndertakings`).
 *  - **An undertaking is judged by the ground.** Withdrawing is a force no
 *    longer standing where it was; restoring is the place being the other
 *    side's (`dutyGoals`). Nearby armies and "prepared" assertions prove neither.
 *  - **A power nobody plays does it.** Its force is sent by road to the nearest
 *    ground that is not an enemy's, and the place is handed back on the day it
 *    was promised. The player's own duties are his to do: they wait on his
 *    orders and are judged on their day.
 */

type TreatyClause = NonNullable<Extract<WorldDelta, { op: "agreement_open" }>["clauses"]>[number];
type Undertaking = Extract<TreatyClause, { kind: "undertaking" }>;
type Province = WorldState["map"]["provinces"][number];

/** A place a text names: a whole province, or one city of it. */
interface Place {
  readonly province: Province;
  readonly settlementId: string | null;
  readonly name: string;
  /** Who holds this very place. */
  readonly heldBy: string | null;
}

const WITHDRAWS = /\b(withdraw\w*|evacuat\w*|vacat\w*|quit|retire\w* from|pull\w* back|pull\w* out|leav(?:e|es|ing))\b/i;
const RESTORES = /\b(restor\w*|return\w*|hand\w* back|give\w* back|relinquish\w*|yield\w* back)\b/i;
/** "to Rome", "to the Roman Republic": who receives, not what is given. */
const RECIPIENT = /\b(?:to|for)\s+(?:the\s+)?\p{Lu}[\p{L}'-]*(?:\s+(?:of\s+)?\p{Lu}[\p{L}'-]*)*/gu;
const DEFAULT_DAYS = 30;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, sixty: 60, ninety: 90 };

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const isFleet = (force: Force): boolean => force.personnel.length > 0 && force.personnel.every((group) => /ship|galley|hull|fleet|transport/i.test(group.categoryId));
const nameOfPolity = (world: WorldState, id: string): string => world.map.polities.find((polity) => polity.id === id)?.name ?? id;

/** The days a sentence allows ("within thirty days", "in 10 days"); a month where it says nothing. */
function daysIn(sentence: string): number {
  const match = /\b(?:within|in|inside|after)\s+(\d{1,3}|[a-z]+)\s+(day|days|week|weeks|month|months)\b/i.exec(sentence);
  if (match === null) return DEFAULT_DAYS;
  const count = /^\d+$/.test(match[1]!) ? Number(match[1]) : NUMBER_WORDS[match[1]!.toLowerCase()];
  if (count === undefined) return DEFAULT_DAYS;
  const unit = match[2]!.toLowerCase();
  return Math.max(1, Math.min(3_650, unit.startsWith("week") ? count * 7 : unit.startsWith("month") ? count * 30 : count));
}

/**
 * The places a text names. A province named by its own name is the whole
 * province; a city named without its province is that city alone, so ground a
 * third power holds around it is not taken to be the speaker's to give.
 */
export function placesNamed(world: WorldState, text: string): Place[] {
  const said = ` ${normalizeName(text)} `;
  const has = (name: string): boolean => { const normal = normalizeName(name); return normal.length > 3 && said.includes(` ${normal} `); };
  const places: Place[] = [];
  for (const province of world.map.provinces) {
    if (has(province.name)) { places.push({ province, settlementId: null, name: province.name, heldBy: province.controllerPolityId }); continue; }
    for (const settlement of province.settlements) {
      if (has(settlement.name)) places.push({ province, settlementId: settlement.id, name: settlement.name, heldBy: settlement.controllerPolityId });
    }
  }
  return places;
}

const sentencesOf = (terms: string): string[] => terms.split(/(?<=[.!?;])\s+/).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0);

/** Whether a clause of this party's already says it will do this to the place. */
const covered = (clauses: readonly TreatyClause[], party: string, place: Place, verb: RegExp): boolean =>
  clauses.some((clause) => clause.kind === "undertaking" && clause.byPolityId === party && verb.test(clause.what)
    && [place.name, place.province.name].some((name) => normalizeName(clause.what).includes(normalizeName(name))));

/**
 * The withdrawals and restorations a treaty's terms speak of that no clause
 * carries. Only what the world can bear out is made a duty: the party must
 * have men standing in the place it is to quit, or hold the place it is to
 * hand back, and be the only one that does or the one the sentence names.
 */
export function impliedUndertakings(world: WorldState, terms: string, partyId: string, otherPartyId: string, clauses: readonly TreatyClause[], speakerId?: string): Undertaking[] {
  const parties = [partyId, otherPartyId];
  const made: Undertaking[] = [];
  for (const sentence of sentencesOf(terms)) {
    // A letter's "we" is its sender and its "you" the one it is written to.
    const speaker = speakerId !== undefined && parties.includes(speakerId) ? speakerId : null;
    const hearer = speaker === null ? null : parties.find((party) => party !== speaker) ?? null;
    const ours = /\b(we|our|us)\b/i.test(sentence);
    const named = parties.filter((party) => normalizeName(sentence).includes(normalizeName(nameOfPolity(world, party)))
      || (party === speaker && ours) || (party === hearer && !ours && /\b(you|your)\b/i.test(sentence)));
    const quits = WITHDRAWS.exec(sentence);
    if (quits !== null) {
      // The place is what follows the verb: "Rome withdraws from Rhegium" does not name Rome's own ground.
      for (const place of placesNamed(world, sentence.slice(quits.index + quits[0].length))) {
        const holding = parties.filter((party) => world.material.forces.some((force) => force.polityId === party && force.locationId === place.province.id && fitOf(force) > 0));
        const chosen = holding.length === 1 ? holding : holding.filter((party) => named.includes(party));
        if (chosen.length !== 1) continue;
        const by = chosen[0]!;
        if (covered([...clauses, ...made], by, place, WITHDRAWS)) continue;
        made.push({ kind: "undertaking", byPolityId: by, duty: "other", what: `Withdraw its forces from ${place.name}`, withinDays: daysIn(sentence) });
      }
    }
    if (RESTORES.test(sentence) && quits === null) {
      // Not the one it is handed to: "restored to Rome" does not name Rome's ground to give.
      for (const place of placesNamed(world, sentence.replace(RECIPIENT, " "))) {
        const giver = place.heldBy;
        if (giver === null || !parties.includes(giver)) continue;
        if (clauses.some((clause) => clause.kind === "cession" && clause.provinceId === place.province.id)) continue;
        if (covered([...clauses, ...made], giver, place, RESTORES)) continue;
        // A sentence that has the giver keep it is no duty to give it back.
        if (named.length === 1 && named[0] === giver && /\b(retain\w*|keep\w*|hold\w*)\b/i.test(sentence)) continue;
        const receiver = giver === partyId ? otherPartyId : partyId;
        made.push({ kind: "undertaking", byPolityId: giver, duty: "other", what: `Restore ${place.name} to ${nameOfPolity(world, receiver)}`, withinDays: daysIn(sentence) });
      }
    }
  }
  return made.slice(0, 6);
}

/**
 * The world outcomes an undertaking is kept by, read from what it says: men
 * quitting a place named in it; a named place in the other side's hands.
 * Undefined where the words name neither, which leaves a promise to be
 * judged as any other.
 */
export function dutyGoals(world: WorldState, what: string, by: string, other: string): OrderGoal[] | undefined {
  const places = placesNamed(world, what);
  if (places.length === 0) return undefined;
  const goals: OrderGoal[] = [];
  if (WITHDRAWS.test(what)) {
    for (const place of places) {
      for (const force of world.material.forces.filter((candidate) => candidate.polityId === by && candidate.locationId === place.province.id)) {
        goals.push({ kind: "force_withdrawn", forceId: force.id, fromProvinceId: place.province.id });
      }
    }
  } else if (RESTORES.test(what)) {
    for (const place of places.filter((candidate) => candidate.heldBy === by)) {
      goals.push({ kind: "control", provinceId: place.province.id, settlementId: place.settlementId, polityId: other });
    }
  }
  return goals.length === 0 ? undefined : goals.slice(0, 4);
}

const OPEN: ReadonlySet<string> = new Set(["pending", "prepared", "deferred", "partially_fulfilled"]);

/**
 * Where a force quitting a place goes: its own power's nearest ground; else the
 * nearest ground that is nobody's enemy, so a power with no province left
 * (the Campanians hold one city) is not kept in the place it promised to leave.
 */
function homeFor(world: WorldState, force: Force, from: string): { provinceId: string; km: number } | null {
  const reach = (provinceId: string): number | null => isFleet(force) ? kmBetween(world, from, provinceId) : landKmBetween(world, from, provinceId);
  const nearest = (candidates: readonly Province[]): { provinceId: string; km: number } | null => candidates
    .map((province) => ({ provinceId: province.id, km: reach(province.id) }))
    .filter((entry): entry is { provinceId: string; km: number } => entry.km !== null)
    .sort((a, b) => a.km - b.km || a.provinceId.localeCompare(b.provinceId))[0] ?? null;
  const others = world.map.provinces.filter((province) => province.id !== from);
  return nearest(others.filter((province) => province.controllerPolityId === force.polityId))
    ?? nearest(others.filter((province) => province.controllerPolityId === null || !atWar(world.polityAgreements, force.polityId, province.controllerPolityId)));
}

export interface TreatyDutyInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly ids: IdFactory;
  /** Whose duties are the player's own: never done for him. */
  readonly playerPolityId: string | null;
}

/**
 * Carries out, for powers nobody plays, what their treaties bound them to and
 * the ground does not yet show. Idempotent: a force already on its way is not
 * sent twice, and ground already handed over is not handed twice.
 */
export function workOnTreatyDuties(input: TreatyDutyInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const placeName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
  for (const commitment of input.world.commitments) {
    if (!OPEN.has(commitment.status) || commitment.completionGoals === undefined) continue;
    const promisor = world.characters.find((character) => character.id === commitment.promisorCharacterId);
    if (promisor === undefined || !promisor.alive || promisor.polityId === null || promisor.polityId === input.playerPolityId) continue;
    const polityId = promisor.polityId;
    for (const goal of commitment.completionGoals) {
      if (goalMet(world, goal) !== "not_yet") continue;
      if (goal.kind === "force_withdrawn") {
        const force = world.material.forces.find((candidate) => candidate.id === goal.forceId);
        if (force === undefined || force.polityId !== polityId) continue;
        if (world.projects.some((project) => project.status === "in_progress" && project.completionOutcome?.kind === "force_move" && project.completionOutcome.forceId === force.id)) continue;
        const home = homeFor(world, force, goal.fromProvinceId);
        if (home === null) continue;
        const days = Math.max(1, Math.ceil(marchDaysFor(home.km)));
        const id = input.ids.next("project");
        world = {
          ...world,
          projects: [...world.projects, {
            id, kind: isFleet(force) ? "sailing" : "march", sponsorEntityRef: { kind: "character" as const, id: promisor.id },
            label: `${force.name} withdraws from ${placeName(goal.fromProvinceId)} under the treaty`.slice(0, 160),
            status: "in_progress" as const, fundingAccountId: null, overseerCharacterId: null, reservationId: null,
            milestones: [{ id: `${id}-m1`, label: `Arrives in ${placeName(home.provinceId)}`.slice(0, 160), requiredAtElapsedOffset: days, costAmount: 0, status: "pending" as const, completedAtStep: null }],
            completionOutcome: {
              kind: "force_move" as const, label: `${force.name} arrives in ${placeName(home.provinceId)}`.slice(0, 160), amount: 0,
              provinceId: home.provinceId, polityId: null, commanderCharacterId: null, forceId: force.id,
              beneficiaryAccountId: null, cadenceDays: null, agreementKind: null, withPolityId: null,
            },
            linkedEntityIds: [], startedAtStep: input.toDay, targetCompletionStep: input.toDay + days, completedAtStep: null, provenanceEventIds: [],
          }],
          material: { ...world.material, forces: world.material.forces.map((candidate) => candidate.id === force.id ? { ...candidate, hold: false } : candidate) },
        };
        facts.push({
          localId: safeLocalId(`treaty_withdrawal_${force.id}`).slice(0, 60),
          kind: "march_begun",
          summary: `${force.name} set out from ${placeName(goal.fromProvinceId)} for ${placeName(home.provinceId)}, as the treaty obliges ${nameOfPolity(world, polityId)}: about ${days} days on the road.`.slice(0, 600),
          affectedRefs: [{ kind: "force", id: force.id }, { kind: "province", id: goal.fromProvinceId }, { kind: "polity", id: polityId }],
          visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 45,
        });
      }
      if (goal.kind === "control" && input.toDay >= commitment.reviewAtStep) {
        const province = world.map.provinces.find((candidate) => candidate.id === goal.provinceId);
        if (province === undefined) continue;
        const heldBefore = goal.settlementId === null ? province.controllerPolityId : province.settlements.find((settlement) => settlement.id === goal.settlementId)?.controllerPolityId;
        if (heldBefore !== polityId) continue;
        const name = goal.settlementId === null ? province.name : province.settlements.find((settlement) => settlement.id === goal.settlementId)!.name;
        world = {
          ...world,
          map: { ...world.map, provinces: world.map.provinces.map((candidate) => candidate.id !== province.id ? candidate : goal.settlementId === null
            ? { ...candidate, controllerPolityId: goal.polityId, controlFirmnessBps: 6_000, lostBy: null,
              settlements: candidate.settlements.map((settlement) => settlement.controllerPolityId === polityId ? { ...settlement, controllerPolityId: goal.polityId } : settlement) }
            : { ...candidate, settlements: candidate.settlements.map((settlement) => settlement.id === goal.settlementId ? { ...settlement, controllerPolityId: goal.polityId } : settlement) }) },
        };
        facts.push({
          localId: safeLocalId(`treaty_restored_${goal.settlementId ?? province.id}`).slice(0, 60),
          kind: "province_ceded",
          summary: `${nameOfPolity(world, polityId)} restored ${name} to ${nameOfPolity(world, goal.polityId)}, as the treaty obliged it.`.slice(0, 600),
          affectedRefs: [{ kind: "province", id: province.id }, { kind: "polity", id: polityId }, { kind: "polity", id: goal.polityId }],
          visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 65,
        });
      }
    }
  }
  return { world, facts };
}

const BINDING_CLAUSES: ReadonlySet<string> = new Set(["undertaking", "cession", "indemnity", "hostage", "force_transfer", "submission"]);
/** Words that make a sentence about leaving or returning a place a term offered rather than something reported. */
const OFFERS_TERMS = /\b(agree\w*|accept\w*|terms|in return|in exchange|provided|on condition|if you|we (?:will|shall)|i (?:will|shall)|undertake\w*|promis\w*|shall)\b/i;

/**
 * What a letter offers. A plain letter between powers at war that carries
 * treaty clauses, or whose terms have a side withdraw from or restore a place,
 * is a peace offer: Carthage's accepted withdrawal and open strait stayed
 * correspondence that bound nobody, because only the word "peace" made a
 * letter an offer.
 */
export function offerMetadata(
  world: WorldState,
  message: Pick<DiplomaticMessage, "kind" | "proposes" | "terms" | "fromPolityId" | "toPolityId"> & { clauses?: readonly Record<string, unknown>[] | undefined; onRefusal?: unknown },
): ReturnType<typeof peaceOfferMetadata> {
  const base = peaceOfferMetadata(message);
  if (base.kind !== "letter" || base.proposes.length > 0 || message.onRefusal != null) return base;
  if (!atWar(world.polityAgreements, message.fromPolityId, message.toPolityId)) return base;
  const clauses = (message.clauses ?? []) as readonly TreatyClause[];
  const binding = clauses.some((clause) => BINDING_CLAUSES.has(clause.kind));
  const spoken = OFFERS_TERMS.test(message.terms) && impliedUndertakings(world, message.terms, message.fromPolityId, message.toPolityId, clauses, message.fromPolityId).length > 0;
  return binding || spoken ? { kind: "peace_offer", proposes: ["peace"] } : base;
}
