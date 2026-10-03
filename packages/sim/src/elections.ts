import {
  allOffices,
  allSuccessionRules,
  boundedId,
  createPressure,
  labelNamesOffice,
  ELECTABLE_MIN_PRESTIGE_BPS,
  isBeneath,
  isMagistracy,
  isEligibleFor,
  officeRequirements,
  seatCharacterInOffice,
  vacateMagistraciesOf,
  type Character,
  type FactProposalDraft,
  type Office,
  type OfficeSeat,
  type PoliticalProcedure,
  type SuccessionRule,
  type WorldState,
} from "@chronica/shared";
import { newsReach, powersNearThePlayer } from "./far-powers";
import type { IdFactory } from "./ports";

/**
 * Magistracies that fall vacant, and the elections that fill them.
 *
 * A consul's term ended on day 365 and nothing followed: the seat emptied, a
 * fact said so, and the republic went on without a consul until somebody
 * happened to think of holding an election -- which, for a question no one had
 * been handed, nobody ever did. The second consulship was never filled at all.
 *
 * So an elective office is now kept by the calendar, in three steps:
 *
 *  1. **At the opening**, a seat that was never filled is filled: the world
 *     starts with its magistrates in place, chosen the way the Senate would have
 *     chosen them -- by standing.
 *  2. **When a seat falls vacant**, the men who could win it are told so, as a
 *     pressure: the seat is an opportunity, and calling the election is theirs
 *     to do. That is what puts them into the next round of the world's business
 *     (`routeAmbientActors` picks people up by their pressures).
 *  3. **If nobody calls it** within the canvass -- or there is nobody to call it
 *     -- the engine calls it itself. And every election, whoever called it, is
 *     decided by code on its day: weighed by the candidates' standing and by
 *     who has declared for and against them. A model may argue for an outcome;
 *     it does not get to pick the winner.
 *
 * Only offices whose succession rule is `elective` are kept this way. A king is
 * succeeded, not elected, and that is somebody else's business.
 */

/** How long after a seat falls vacant the men who could win it have to call the election themselves. */
export const ELECTION_CANVASS_DAYS = 30;
/** How long an election stays open once called, when whoever called it set no day. */
export const ELECTION_POLLING_DAYS = 20;
/** How long before a term ends its successor's election is called. */
export const ELECTION_LEAD_DAYS = ELECTION_POLLING_DAYS + 10;
/** How long an interregnum's election takes: an interrex held office five days. */
export const INTERREGNUM_POLLING_DAYS = 5;
/** How many people and powers one fact may name (`FactSchema.affectedEntities`). */
const MAX_FACT_REFS = 16;
/**
 * A magistracy's term where the office does not state one but its seats plainly
 * ran by terms -- a save made before offices said so.
 */
export const ELECTED_TERM_DAYS = 365;
/** Standing below this and a man is not somebody the voters would think of electing unprompted. */
/** What having served in a lesser magistracy is worth to a candidate, by custom. */
const SERVED_BELOW_BPS = 600;
/** What winning an election adds to a man's standing. */
const ELECTION_STANDING_BPS = 500;
/** How many of the likeliest candidates are told the seat is theirs to seek. */
const MAX_CANDIDATES_TOLD = 3;

export interface ElectionGovernment {
  readonly offices: readonly Office[];
  readonly successionRules: readonly SuccessionRule[];
}

export interface HoldElectionsInput {
  readonly world: WorldState;
  readonly government: ElectionGovernment;
  /** The player is never handed an office by the engine, nor a pressure to seek one; they may still stand and win. */
  readonly playerCharacterId?: string | null | undefined;
  readonly toDay: number;
  readonly ids: IdFactory;
}

export interface HoldElectionsResult {
  readonly world: WorldState;
  readonly facts: readonly FactProposalDraft[];
}

const OPEN_STAGES = new Set<PoliticalProcedure["stage"]>(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);
const isOpen = (procedure: PoliticalProcedure): boolean => OPEN_STAGES.has(procedure.stage);

/** The election itself: a question about one of the office's seats, or one naming the office outright. */
function isElectionFor(procedure: PoliticalProcedure, office: Office, seatIds: ReadonlySet<string>): boolean {
  if (procedure.subjectKind !== "office_seat" || procedure.type === "nomination") return false;
  return procedure.subjectId === null ? labelNamesOffice(procedure.label, office.label) : seatIds.has(procedure.subjectId);
}

/**
 * The man a candidacy puts forward: the person it names, or -- for "Gaius
 * stands for consul", written as a question about the office -- whoever moved
 * it. Written that way, the player's own candidacy matched nothing, stood open
 * for ever, and the election was held without him.
 */
function candidateOf(procedure: PoliticalProcedure): string | null {
  return procedure.subjectKind === "character" ? procedure.subjectId : procedure.sponsorCharacterId;
}

/** A man standing: a nomination or appointment of a person, in words that name the office. */
function isCandidacyFor(procedure: PoliticalProcedure, office: Office): boolean {
  if (procedure.type !== "nomination" && procedure.type !== "appointment") return false;
  if (!labelNamesOffice(procedure.label, office.label)) return false;
  if (procedure.subjectKind === "character") return procedure.subjectId !== null;
  return procedure.subjectKind === "office_seat" && procedure.type === "nomination";
}

/** Net declared influence on a question: for, less against, counting only each supporter's latest word. */
function netSupport(world: WorldState, procedureId: string): number {
  const latest = new Map<string, WorldState["material"]["supportPositions"][number]>();
  for (const position of world.material.supportPositions) {
    if (position.procedureId !== procedureId) continue;
    const key = `${position.supporterKind}:${position.supporterId}`;
    const previous = latest.get(key);
    if (previous === undefined || position.changedAtStep >= previous.changedAtStep) latest.set(key, position);
  }
  let net = 0;
  for (const position of latest.values()) {
    if (position.position === "support") net += position.influenceWeight;
    else if (position.position === "oppose") net -= position.influenceWeight;
  }
  return net;
}

function settle(procedure: PoliticalProcedure, outcome: "passed" | "failed" | "withdrawn", reason: string, atStep: number): PoliticalProcedure {
  return { ...procedure, stage: outcome === "withdrawn" ? "withdrawn" : "resolved", outcome, outcomeReason: reason.slice(0, 400), resolvedAtStep: atStep };
}

const joinNames = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** A place to be filled: a seat on record, or one of a college's implied places, which gets a record when a named man wins it. */
interface Place {
  readonly seatId: string | null;
}

export function holdElections(input: HoldElectionsInput): HoldElectionsResult {
  const facts: FactProposalDraft[] = [];
  const player = input.playerCharacterId ?? null;
  const rulesById = new Map(allSuccessionRules(input.world, input.government.successionRules).map((rule) => [rule.id, rule]));
  const offices = allOffices(input.world, input.government.offices);
  const officesById = new Map(offices.map((office) => [office.id, office]));
  let world = input.world;
  let localId = 0;
  const nextLocalId = (): string => `election_${(localId += 1)}`;

  // As they now stand: a consulship reformed by law is kept by its new term.
  // A power that is no more elects nobody (`polity-end.ts`).
  const ended = new Set(world.map.polities.filter((polity) => polity.endedAtStep != null).map((polity) => polity.id));
  for (const office of offices) {
    const rule = rulesById.get(office.successionRuleId);
    if (rule?.kind !== "elective" || ended.has(office.polityId)) continue;
    const institution = rule.institutionId === null ? undefined : world.material.institutions.find((candidate) => candidate.id === rule.institutionId);
    const body = institution?.name ?? "assembly";
    const polityName = world.map.polities.find((polity) => polity.id === office.polityId)?.name ?? office.polityId;

    // A term, if the office has one. A leader acclaimed for life has none,
    // and is elected only when the seat falls vacant some other way.
    // (A vacant seat's `termExpiresAtStep` is the day it was vacated, so it
    // says nothing about terms unless a term is what emptied it.)
    const termed = world.material.officeSeats.some((seat) => seat.officeId === office.id
      && ((seat.status === "held" && seat.termExpiresAtStep !== null) || seat.vacancyCause === "term_expired"));
    const termDays = office.termDays ?? (termed ? ELECTED_TERM_DAYS : null);

    // Every holding of an office with a term runs for that term. One seated
    // without it -- by a vote the model resolved, or by the player's own
    // declaration -- gets the office's term from the day it began.
    if (termDays !== null) {
      world = {
        ...world,
        material: {
          ...world.material,
          officeSeats: world.material.officeSeats.map((seat) =>
            seat.officeId === office.id && seat.status === "held" && seat.termExpiresAtStep === null
              ? { ...seat, termExpiresAtStep: (seat.termStartedAtStep ?? input.toDay) + termDays }
              : seat),
        },
      };
    }

    const seats = () => world.material.officeSeats.filter((seat) => seat.officeId === office.id);
    const seatIds = new Set(seats().map((seat) => seat.id));
    const vacantSeats = (): OfficeSeat[] => seats().filter((seat) => seat.status !== "held" && seat.holderCharacterId === null);
    // A college larger than the men the world names -- eight quaestors, ten
    // tribunes -- is elected whole, once a term. Its places are its size less
    // the named men whose terms still run; a place nobody named wins stays
    // with the implied colleagues, and has no record.
    const college = office.seatCount !== undefined && termDays !== null;
    // Seats whose term runs out before an election called later could be
    // counted: their successors are elected ahead -- consuls designate -- and
    // take the seat the day it ends (`tick.ts`). Called only once the seat
    // fell vacant, Rome had no consuls for two months in the middle of a war.
    const fallingDue = (): OfficeSeat[] => (college || termDays === null ? [] : seats().filter((seat) => seat.status === "held"
      && seat.termExpiresAtStep !== null && seat.designateCharacterId == null
      && seat.termExpiresAtStep > input.toDay && seat.termExpiresAtStep - input.toDay <= ELECTION_LEAD_DAYS));
    const openPlaces = (): Place[] => {
      if (!college) return [...vacantSeats(), ...fallingDue()].map((seat) => ({ seatId: seat.id }));
      const sitting = seats().filter((seat) => seat.status === "held" && (seat.termExpiresAtStep ?? Number.POSITIVE_INFINITY) > input.toDay).length;
      const count = Math.max(0, office.seatCount! - sitting);
      const onRecord = vacantSeats().slice(0, count).map((seat) => ({ seatId: seat.id }));
      return [...onRecord, ...Array.from({ length: count - onRecord.length }, () => ({ seatId: null }))];
    };
    // A college's election falls due a term after the last one was called --
    // the first a term after the opening.
    const lastCalled = Math.max(-Infinity, ...world.material.politicalProcedures.filter((procedure) => isElectionFor(procedure, office, seatIds)).map((procedure) => procedure.openedAtStep));
    const cycle = office.cycleDays ?? termDays ?? 0;
    const collegeDueDay = college ? (Number.isFinite(lastCalled) ? lastCalled + cycle : cycle) : null;
    const vacant = (): Place[] => (collegeDueDay !== null && input.toDay < collegeDueDay ? [] : openPlaces());
    const requirementIds = seats()[0]?.eligibilityRequirementIds ?? office.eligibilityRequirementIds;
    // The rules for who may stand and whom the electors think of are shared
    // (`candidates.ts`), so an office's note says the election's own answer.
    const minStanding = officeRequirements(world, office).minStanding;
    const beneath = (character: Character): boolean => isBeneath(world, office, officesById, character);
    /** Who could hold it: eligible, alive, and not already sitting in it. */
    const eligible = (character: Character): boolean => isEligibleFor(world, office, requirementIds, character, input.toDay);
    /** Who the Senate would think of unprompted: eligible, of standing, not above it, and not the player. */
    const electable = (): Character[] =>
      world.characters
        .filter((character) => character.id !== player && character.prestigeBps >= minStanding && !beneath(character) && eligible(character))
        .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id));

    /**
     * Custom, where it was not law: the voters preferred a man who had served
     * them below. The ladder's order was not law in 270, so nobody is barred
     * for skipping a rung -- but a man who has held a lesser magistracy of his
     * country stands that much better for a greater one.
     */
    const served = (character: Character): number => {
      if (office.rank === undefined) return 0;
      return character.officesHeld.some((tenure) => {
        const held = officesById.get(tenure.officeId);
        return held !== undefined && held.polityId === office.polityId && isMagistracy(held) && held.rank !== undefined && held.rank < office.rank!;
      }) ? SERVED_BELOW_BPS : 0;
    };
    /**
     * Places the law kept for an order: one consulship a year a plebeian's,
     * one censorship a lustrum. Counted with the colleagues whose terms still
     * run; where the count falls short, the likeliest man of that order takes
     * the last place from the likeliest man of the other.
     */
    const withReservedPlaces = (chosen: readonly string[], ranked: readonly string[]): string[] => {
      const winners = [...chosen];
      const ordoOf = (id: string) => world.characters.find((character) => character.id === id)?.ordo;
      for (const [ordo, needed] of Object.entries(office.ordoSeats ?? {}) as ["patrician" | "plebeian", number][]) {
        const sitting = seats().filter((seat) => seat.status === "held" && seat.holderCharacterId !== null && !winners.includes(seat.holderCharacterId)
          && (seat.termExpiresAtStep ?? Number.POSITIVE_INFINITY) > input.toDay && ordoOf(seat.holderCharacterId) === ordo).length;
        let short = needed - sitting - winners.filter((id) => ordoOf(id) === ordo).length;
        const pool = [...ranked, ...electable().map((character) => character.id)].filter((id, index, all) => all.indexOf(id) === index && !winners.includes(id) && ordoOf(id) === ordo);
        while (short > 0 && pool.length > 0) {
          const out = [...winners].reverse().find((id) => ordoOf(id) !== ordo);
          if (out === undefined) break;
          winners[winners.indexOf(out)] = pool.shift()!;
          short -= 1;
        }
      }
      return winners;
    };

    // ── 1. The opening: a seat nobody has ever held is filled now. ─────────
    for (const seat of vacantSeats().filter((candidate) => candidate.vacancyCause === "never_filled")) {
      const likeliest = electable();
      const chosenId = withReservedPlaces(likeliest.slice(0, 1).map((character) => character.id), likeliest.map((character) => character.id))[0];
      const chosen = likeliest.find((character) => character.id === chosenId);
      if (chosen === undefined) continue;
      world = seatCharacterInOffice(world, chosen.id, { office, vacantSeatId: seat.id }, input.toDay, termDays);
      facts.push({
        localId: nextLocalId(),
        kind: "office_filled",
        summary: `${chosen.name} holds the office of ${office.label}${termDays === null ? "" : ` for a term of ${termDays} days`}.`,
        affectedRefs: [{ kind: "character", id: chosen.id }, { kind: "polity", id: office.polityId }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 20,
      });
    }

    // ── 3. An election whose day has come is decided. ──────────────────────
    for (const election of world.material.politicalProcedures.filter((procedure) => isOpen(procedure) && isElectionFor(procedure, office, seatIds))) {
      const pollingDay = election.deadlineStep ?? election.openedAtStep + ELECTION_POLLING_DAYS;
      if (pollingDay > input.toDay) continue;
      const candidacies = world.material.politicalProcedures.filter((procedure) => isOpen(procedure) && isCandidacyFor(procedure, office));
      // Every place open on polling day, whether or not the next term's is due yet.
      const places = openPlaces();

      if (places.length === 0) {
        world = replaceProcedures(world, [election, ...candidacies].map((procedure) => settle(procedure, "withdrawn", `No seat of ${office.label} was left to fill.`, input.toDay)));
        continue;
      }

      // Who stood: whoever called it, and whoever was put forward. If that is
      // fewer men than there are seats, the Senate finds the rest itself.
      const standing = new Map<string, number>();
      const stand = (characterId: string, net: number) => {
        const character = world.characters.find((candidate) => candidate.id === characterId);
        if (character === undefined || !eligible(character)) return;
        standing.set(characterId, Math.max(standing.get(characterId) ?? Number.NEGATIVE_INFINITY, character.prestigeBps + served(character) + net));
      };
      // Whoever called it stands -- unless it is beneath him, when he was only
      // presiding: a former consul calling the quaestors' election is not a
      // candidate for quaestor. A man who puts himself forward still is.
      const caller = world.characters.find((character) => character.id === election.sponsorCharacterId);
      if (caller !== undefined && !beneath(caller)) stand(caller.id, netSupport(world, election.id));
      for (const candidacy of candidacies) { const candidate = candidateOf(candidacy); if (candidate !== null) stand(candidate, netSupport(world, candidacy.id)); }
      for (const character of electable()) {
        if (standing.size >= places.length) break;
        if (!standing.has(character.id)) standing.set(character.id, character.prestigeBps + served(character));
      }

      const ranked = [...standing.entries()].sort(([a, scoreA], [b, scoreB]) => scoreB - scoreA || a.localeCompare(b));
      const winners = withReservedPlaces(ranked.slice(0, places.length).map(([id]) => id), ranked.map(([id]) => id));
      // Rome did not go without a praetor because nobody the world names stood:
      // the places went to men of no note, as most of them always did.
      if (winners.length === 0 && college) {
        world = replaceProcedures(world, [election, ...candidacies].map((procedure) => settle(procedure, "passed", `The places as ${office.label} went to men of no particular note.`, input.toDay)));
        continue;
      }
      if (winners.length === 0) {
        world = replaceProcedures(world, [election, ...candidacies].map((procedure) => settle(procedure, "failed", `Nobody eligible stood for ${office.label}.`, input.toDay)));
        facts.push({
          localId: nextLocalId(),
          kind: "election_failed",
          summary: `The ${body} met to elect a ${office.label}, and nobody eligible stood.`,
          affectedRefs: [{ kind: "polity", id: office.polityId }],
          visibility: "public",
          discoveryState: "public",
          knowableInDays: 0,
          significance: 30,
        });
        continue;
      }

      const designated: string[] = [];
      winners.forEach((winnerId, index) => {
        // Elected to a seat whose holder's term has not yet run out: he is its
        // designate, and takes it on the day it does.
        const ahead = places[index]!.seatId === null ? undefined : world.material.officeSeats.find((seat) => seat.id === places[index]!.seatId && seat.status === "held");
        if (ahead !== undefined) {
          designated.push(winnerId);
          world = { ...world, material: { ...world.material, officeSeats: world.material.officeSeats.map((seat) => (seat.id === ahead.id ? { ...seat, designateCharacterId: winnerId } : seat)) },
            characters: world.characters.map((character) => (character.id === winnerId ? { ...character, prestigeBps: Math.min(10_000, character.prestigeBps + ELECTION_STANDING_BPS) } : character)) };
          return;
        }
        // Rising, he lays down the magistracy he held before: a man holds one.
        // His seat in the Senate and his priesthood go with him.
        const risen = isMagistracy(office) ? vacateMagistraciesOf(world, winnerId, offices, "resignation", input.toDay) : world;
        world = seatCharacterInOffice(risen, winnerId, { office, vacantSeatId: places[index]!.seatId }, input.toDay, termDays);
        // Winning is standing. The Senate that elected him thinks more of him
        // for having done it, and it shows at the next count.
        world = { ...world, characters: world.characters.map((character) => (character.id === winnerId
          ? { ...character, prestigeBps: Math.min(10_000, character.prestigeBps + ELECTION_STANDING_BPS) }
          : character)) };
      });
      const heldBefore = new Set(winners.filter((id) => world.characters.find((character) => character.id === id)?.officesHeld?.some((held) => held.officeId === office.id) === true));
      const names = winners.map((id) => world.characters.find((character) => character.id === id)?.name ?? id);
      const losers = [...standing.keys()].filter((id) => !winners.includes(id));
      const loserNames = losers.map((id) => world.characters.find((character) => character.id === id)?.name ?? id);
      const verdict = `The ${body} elected ${joinNames(names)}${losers.length > 0 ? `, over ${joinNames(loserNames)}` : ""}.`;
      world = replaceProcedures(world, [
        settle(election, "passed", verdict, input.toDay),
        ...candidacies.map((candidacy) => settle(candidacy, winners.includes(candidateOf(candidacy) ?? "") ? "passed" : "failed", verdict, input.toDay)),
      ]);
      facts.push({
        localId: nextLocalId(),
        kind: "election_held",
        summary: `${verdict.slice(0, -1)}, ${winners.length > 1 ? `to hold the office of ${office.label}` : `to be ${office.label}`}${designated.length === 0 ? "" : designated.length === winners.length ? ", taking office when the present term runs out" : `; ${joinNames(designated.map((id) => world.characters.find((character) => character.id === id)?.name ?? id))} when the present term runs out`}.`,
        // Winners first, then as many of the beaten as a fact can name: a
        // college of sixteen tribunes stood seventeen men, one over the cap,
        // and the election that should have filled it crashed the burst.
        affectedRefs: [
          ...[...winners, ...losers].slice(0, MAX_FACT_REFS - 1).map((id) => ({ kind: "character" as const, id })),
          { kind: "polity" as const, id: office.polityId },
        ],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        // How a republic differs from a reign, and who holds the fasces now --
        // when somebody new does. A chief returned to the chair he held is the
        // calendar, and a year in, ninety powers returned theirs on one day.
        significance: winners.every((id) => heldBefore.has(id)) ? 20 : 60,
      });
    }

    // ── 2. A vacant seat, and nobody yet calling the election. ─────────────
    const places = vacant();
    if (places.length === 0) continue;
    const called = world.material.politicalProcedures.some((procedure) => isOpen(procedure) && (isElectionFor(procedure, office, seatIds) || isCandidacyFor(procedure, office)));
    const electionOpen = world.material.politicalProcedures.some((procedure) => isOpen(procedure) && isElectionFor(procedure, office, seatIds));
    if (electionOpen) continue;

    const vacatedAt = collegeDueDay ?? Math.min(...places.map((place) => seats().find((seat) => seat.id === place.seatId)?.termExpiresAtStep ?? input.toDay));
    const likeliest = electable().slice(0, MAX_CANDIDATES_TOLD);
    // A successor elected ahead is elected now: the year will not wait for a canvass.
    const ahead = places.some((place) => fallingDue().some((seat) => seat.id === place.seatId));
    // The year ran out with nobody elected to follow: an interregnum, and its
    // elections are held within days, as Rome's interrex held them.
    const interregnum = !college && !ahead && isMagistracy(office) && places.some((place) => seats().find((seat) => seat.id === place.seatId)?.vacancyCause === "term_expired");
    const canvassOver = ahead || interregnum || input.toDay >= vacatedAt + ELECTION_CANVASS_DAYS;

    // Somebody has put a man forward, or the canvass is over, or there is
    // nobody of standing to call it: the election is called now. Presided over
    // by a colleague still in office where there is one, else by whoever
    // stands highest, else by the man put forward.
    // A college nobody seeks a place in is filled by the men the world does not
    // name, without an election nobody stands in.
    if (college && !called && likeliest.length === 0) continue;
    if (called || canvassOver || likeliest.length === 0) {
      const candidacy = world.material.politicalProcedures.find((procedure) => isOpen(procedure) && isCandidacyFor(procedure, office));
      const colleague = seats().find((seat) => seat.status === "held" && seat.holderCharacterId !== null)?.holderCharacterId ?? null;
      const anyEligible = world.characters.filter((character) => character.id !== player && !beneath(character) && eligible(character)).sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
      const sponsor = candidacy?.sponsorCharacterId ?? colleague ?? likeliest[0]?.id ?? anyEligible?.id ?? null;
      if (sponsor === null) continue;
      const procedure: PoliticalProcedure = {
        id: input.ids.next("procedure"),
        type: "vote",
        institutionId: institution?.id ?? null,
        sponsorCharacterId: sponsor,
        subjectKind: "office_seat",
        // A college is elected whole, and named by its office.
        subjectId: college ? null : places[0]!.seatId,
        // A college's election is found again by its office's name, so the name is said whole.
        label: (college ? `Election of ${office.label}: ${places.length} places` : `Election of ${places.length > 1 ? `${places.length} ${office.label}s` : `a ${office.label}`}`).slice(0, 200),
        eligibilityRequirementIds: [...requirementIds],
        eligibleParticipantIds: [],
        stage: "gathering_support",
        resolutionMechanism: institution === undefined ? "sponsor_discretion" : "vote",
        openedAtStep: input.toDay,
        // Ahead of a term's end, counted before the day the seat falls vacant;
        // in an interregnum, within days.
        deadlineStep: ahead
          ? Math.max(input.toDay + 1, Math.min(input.toDay + ELECTION_POLLING_DAYS, vacatedAt - 1))
          : interregnum ? input.toDay + INTERREGNUM_POLLING_DAYS : input.toDay + ELECTION_POLLING_DAYS,
        resolvedAtStep: null,
        visibility: "public",
        voteRecordId: null,
        outcome: null,
        outcomeReason: null,
        sourceEventIds: [],
        resultingEventIds: [],
      };
      world = { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] } };
      facts.push({
        localId: nextLocalId(),
        kind: "election_called",
        summary: `The ${body} of ${polityName} is called to elect ${college ? `${places.length === 1 ? "one" : places.length} ${places.length === 1 ? "place" : "places"} as ${office.label}` : places.length > 1 ? `${places.length} ${office.label}s` : `a ${office.label}`} in ${(procedure.deadlineStep ?? input.toDay + ELECTION_POLLING_DAYS) - input.toDay} days [${procedure.id}]${ahead ? ", for the term that follows this one" : interregnum ? ": the year ran out with nobody elected, and the state cannot go on without them" : ""}. Whoever means to stand, or to back a man, has until then.`,
        affectedRefs: [{ kind: "polity", id: office.polityId }, { kind: "character", id: sponsor }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        // A date set is not news; the count, when it comes, is.
        significance: 15,
      });
      continue;
    }

    // Otherwise the men who could win it are told it is theirs to seek -- once
    // per vacancy, by a pressure whose id names the vacancy.
    for (const character of likeliest) {
      const id = boundedId("election", places[0]!.seatId ?? office.id, vacatedAt, character.id);
      if (world.characterPressures.some((pressure) => pressure.id === id)) continue;
      const pressured = createPressure(world, {
        id,
        characterId: character.id,
        kind: "opportunity",
        intensity: Math.min(80, 45 + Math.round((character.prestigeBps - ELECTABLE_MIN_PRESTIGE_BPS) / 200)),
        label: `The office of ${office.label} stands vacant: he could call the ${body} to an election, and stand himself`.slice(0, 200),
        sourceEventId: null,
        atStep: input.toDay,
        reviewInSteps: 7,
        expiresInSteps: ELECTION_CANVASS_DAYS,
        visibility: "polity",
      });
      world = { ...world, characters: [...pressured.characters], characterPressures: [...pressured.characterPressures] };
    }
  }

  world = enrolFormerMagistrates(world, offices, input.toDay, facts, nextLocalId);
  // Ninety powers electing on one day is the calendar, not Rome's news: a far
  // power's elections are told to its own people (`far-powers.ts`).
  const near = facts.length === 0 ? null : powersNearThePlayer(world, player);
  const told = facts.map((fact) => {
    const polityId = (fact.affectedRefs ?? []).find((ref) => ref.kind === "polity")?.id;
    if (fact.visibility !== "public" || newsReach(near, polityId) === "public") return fact;
    return { ...fact, visibility: "polity" as const, discoveryState: "polity" as const };
  });
  return { world, facts: told };
}

/**
 * A man who has held a magistracy sits in his power's council from then on:
 * the Senate was, in the main, the men who had been elected to something. So
 * a career has somewhere to arrive, and a senator is made by the ladder rather
 * than by a model deciding he is one.
 */
function enrolFormerMagistrates(
  world: WorldState,
  offices: readonly Office[],
  toDay: number,
  facts: FactProposalDraft[],
  nextLocalId: () => string,
): WorldState {
  let next = world;
  for (const council of offices.filter((office) => office.enrolsFormerMagistrates === true)) {
    const magistracies = new Set(offices.filter((office) => office.polityId === council.polityId && isMagistracy(office) && office.rank !== undefined && office.rank >= (council.enrolsFromRank ?? 0)).map((office) => office.id));
    const seated = new Set(next.material.officeSeats.filter((seat) => seat.officeId === council.id && seat.status === "held").map((seat) => seat.holderCharacterId));
    for (const character of next.characters) {
      if (!character.alive || character.polityId !== council.polityId || seated.has(character.id)) continue;
      if (!character.officesHeld.some((tenure) => magistracies.has(tenure.officeId))) continue;
      if (council.seatCount !== undefined && seated.size >= council.seatCount) break;
      const vacantSeatId = next.material.officeSeats.find((seat) => seat.officeId === council.id && seat.status === "vacant")?.id ?? null;
      next = seatCharacterInOffice(next, character.id, { office: council, vacantSeatId }, toDay, null);
      seated.add(character.id);
      facts.push({
        localId: nextLocalId(),
        kind: "office_filled",
        summary: `${character.name} takes his seat as ${council.label}.`,
        affectedRefs: [{ kind: "character", id: character.id }, { kind: "polity", id: council.polityId }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 15,
      });
    }
  }
  return next;
}

function replaceProcedures(world: WorldState, settled: readonly PoliticalProcedure[]): WorldState {
  const byId = new Map(settled.map((procedure) => [procedure.id, procedure]));
  return {
    ...world,
    material: {
      ...world.material,
      politicalProcedures: world.material.politicalProcedures.map((procedure) => byId.get(procedure.id) ?? procedure),
    },
  };
}
