import {
  aptitude,
  deriveReputation,
  skillShare,
  CONCERN_IN_WORDS,
  FOLLOWING_SHIFT,
  adjustPolityLegitimacy,
  allOffices,
  allSuccessionRules,
  boundedId,
  createPressure,
  findOfficeSeatForRole,
  interestLean,
  type ChamberPower,
  type QuestionConcern,
  labelNamesOffice,
  seatCharacterInOffice,
  vacateOfficesOf,
  type FactProposalDraft,
  type GovernmentInstitution,
  type Office,
  type PoliticalProcedure,
  type SuccessionRule,
  type SupportPosition,
  type VoteRecord,
  type VotingBloc,
  type WorldState,
} from "@chronica/shared";
import { carryOutEnactment } from "./enact";
import type { IdFactory } from "./ports";
import { concernsOf } from "./questions";
import { judgmentLean, sentenceByOutcome } from "./trials";
import { rulerOf } from "./constitutions";
import { tenureLean } from "./command-tenure";
import { intercessionsAgainst, settleSecessions, type SecessionHooks } from "./tribunes";

/**
 * A chamber's questions, debated by its people and decided by the count.
 *
 * Only elections were ever decided. Any other question put to the Senate --
 * "war taxes and a Roman navy" -- stayed `gathering_support` until somebody
 * happened to resolve it, which nobody was ever asked to do, so it sat sixty
 * days past its day while the fleet it was meant to pay for was built anyway.
 * The Senate's blocs, their leanings and thresholds, its quorum and majority
 * were all in the scenario, and nothing read them.
 *
 * So a question before a chamber now runs in two parts:
 *
 *  1. **The debate.** In the days before the vote the men who matter to it --
 *     whoever raised it, a tribune who could forbid it, the chamber's senior
 *     men -- are due to be asked where they stand, as a plan's step is due
 *     (`debatersOf`). What they declare moves the house.
 *  2. **The vote.** On its day the engine counts it (`holdVotes`): each bloc
 *     leans by its own disposition, by what its leaders have declared, and by
 *     what the senators have said, weighed by their standing; it votes yes, no
 *     or abstains by its thresholds, and quorum and majority decide. A model
 *     may argue for an outcome; it does not get to write one.
 *
 * An appointment, a removal or a command carried by the count moves the
 * office it names (`seatByOutcome`). Elections are `holdElections`'s, and so is
 * a man standing for an elected office: his candidacy is settled with the
 * election it stands in.
 *
 * A tribune -- anyone holding an office that `vetoes` -- who is still against a
 * question on its day forbids it. It is not counted; it is blocked, and the
 * record says who blocked it. He may change his mind before then.
 */

/** How long a question stays before the chamber when whoever raised it set no day. */
export const MOTION_VOTING_DAYS = 20;
/** How many days before the vote its people are due to be asked where they stand. */
export const DEBATE_LEAD_DAYS = 5;
/** How far a bloc moves when its own leaders declare for or against. */
export const BLOC_DECLARATION_SHIFT = 15;
/** Standing, in basis points, for each point a senator's word moves the house. */
const SWAY_PER_STANDING_BPS = 2_000;
/** How many people a question has asked of it at once: those who raised it, could forbid it, and lead the house. */
const MAX_SPEAKERS = 4;

const CANDIDACY_TYPES = new Set<PoliticalProcedure["type"]>(["nomination", "appointment"]);
const OPEN_STAGES = new Set<PoliticalProcedure["stage"]>(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);

/** A question a chamber decides by counting it: nobody may write its outcome. */
export function isChamberQuestion(procedure: PoliticalProcedure): boolean {
  return procedure.resolutionMechanism === "vote"
    && procedure.institutionId !== null
    && procedure.subjectKind !== "office_seat";
}

/** A man put forward for an elected office: his question is settled with the election, by `holdElections`. */
export function isElectiveCandidacy(procedure: PoliticalProcedure, electiveOffices: readonly Office[]): boolean {
  return CANDIDACY_TYPES.has(procedure.type)
    && procedure.subjectKind === "character"
    && electiveOffices.some((office) => labelNamesOffice(procedure.label, office.label));
}

/** The offices filled by election, which `holdElections` keeps. */
export function electiveOfficesOf(world: WorldState, offices: readonly Office[], successionRules: readonly SuccessionRule[]): Office[] {
  const elective = new Set(allSuccessionRules(world, successionRules).filter((rule) => rule.kind === "elective").map((rule) => rule.id));
  return allOffices(world, offices).filter((office) => elective.has(office.successionRuleId));
}

/**
 * What a carried question about a man and an office does to the office.
 *
 * Settling the procedure's own row touched no seat, so an appointment that
 * passed changed nothing whatever: the man was appointed in the record and
 * held nothing in the world.
 */
export function seatByOutcome(world: WorldState, procedure: PoliticalProcedure, atStep: number, offices: readonly Office[]): WorldState {
  if (procedure.subjectId === null) return world;
  if (procedure.type === "removal") {
    const holder = procedure.subjectKind === "character"
      ? procedure.subjectId
      : world.material.officeSeats.find((seat) => seat.id === procedure.subjectId)?.holderCharacterId ?? null;
    return holder === null ? world : vacateOfficesOf(world, holder, "removal", atStep);
  }
  if (procedure.subjectKind !== "character") return world;
  const appointed = world.characters.find((character) => character.id === procedure.subjectId);
  if (appointed === undefined || !appointed.alive) return world;
  const every = allOffices(world, offices);
  // A measure that makes an office for a named man -- "Gaius Genucius
  // Clepsina, proconsul of Sicily" -- makes it his. Carried, the office was
  // made and left empty, and the consul named somebody else to it the next
  // week: the Senate's vote about a man had nothing to do with the man.
  const made = world.enactments.find((candidate) => candidate.procedureId === procedure.id)?.office;
  if (made != null && !made.abolish && procedure.type !== "denunciation") {
    const office = every.find((candidate) => candidate.id === made.officeId);
    const seats = world.material.officeSeats.filter((seat) => seat.officeId === made.officeId);
    if (office !== undefined && !seats.some((seat) => seat.holderCharacterId === appointed.id && seat.status === "held")) {
      const vacant = seats.find((seat) => seat.status !== "held" && seat.holderCharacterId === null);
      return seatCharacterInOffice(world, appointed.id, { office, vacantSeatId: vacant?.id ?? null }, atStep, made.termDays ?? null);
    }
    return world;
  }
  if (procedure.type === "appointment" || procedure.type === "command_assignment" || procedure.type === "nomination") {
    // The office is named by the question itself -- "Make Lucius praetor" --
    // which is the same match declaration already uses. Offices made in play
    // are offices too.
    const matched = findOfficeSeatForRole(world, { offices: every }, appointed.polityId, procedure.label);
    return matched === undefined ? world : seatCharacterInOffice(world, appointed.id, matched, atStep);
  }
  return world;
}

/** The day the chamber votes on it. */
export const voteDayOf = (procedure: PoliticalProcedure): number => procedure.deadlineStep ?? procedure.openedAtStep + MOTION_VOTING_DAYS;

/** Told with a carried question that does nothing by being carried. */
const BEGINS_NOTHING = "It gives leave and begins nothing by itself: what it allows waits on somebody's order.";

/** The kinds of question that move a man -- seat him, unseat him, try him -- by being carried. */
const MOVES_A_MAN = new Set<PoliticalProcedure["type"]>(["appointment", "command_assignment", "nomination", "removal", "denunciation"]);

/**
 * A carried question that does nothing by being carried: no law it enacts, no
 * man it seats or tries, no treaty or command waiting on it.
 *
 * "Authorize a fleet budget and begin building toward three hundred ships"
 * passed 191 to 40 and no keel was laid, because the question itself began no
 * work, and the player read "carried" and waited four months for ships. That
 * was warned of only for a question about a whole power; a plebiscite the
 * player carried in the Council of the Plebs, about nothing in particular,
 * passed in silence and did nothing.
 */
export function beginsNothing(world: WorldState, procedure: PoliticalProcedure): boolean {
  if (world.enactments.some((enactment) => enactment.procedureId === procedure.id && enactment.enactedAtStep === null)) return false;
  if (procedure.subjectId !== null && (procedure.subjectKind === "character" || procedure.type === "removal") && MOVES_A_MAN.has(procedure.type)) return false;
  if (procedure.type === "treaty_ratification" || world.diplomacy.some((message) => message.ratification?.procedureId === procedure.id)) return false;
  // A command prorogued or a triumph asked: `command-tenure.ts` reads the outcome.
  return !(procedure.id.startsWith("prorogation:") || world.commandHolds.some((hold) => hold.procedureId === procedure.id));
}

/** How a secession asks the house, and carries what it gives way on, as a vote would. */
const secessionHooks = (input: HoldVotesInput): SecessionHooks => ({
  houseLean: (world, procedure, institution) => {
    const leanings = blocLeanings(world, procedure, institution);
    const weight = leanings.reduce((sum, leaning) => sum + leaning.bloc.weight, 0);
    return weight === 0 ? 0 : Math.round(leanings.reduce((sum, leaning) => sum + leaning.lean * leaning.bloc.weight, 0) / weight);
  },
  carry: (world, settled) => {
    const enacted = carryOutEnactment(world, settled.id, input.toDay, input.ids, input.offices, input.successionRules ?? []);
    return { world: sentenceByOutcome(seatByOutcome(enacted.world, settled, input.toDay, input.offices), settled, input.toDay), facts: enacted.facts };
  },
});

/** How long a ruler has to take or leave his council's advice before its silence decides. */
export const ADVICE_DAYS = 30;

/** The powers a question needs, from what it is about and what it enacts. */
function powersNeeded(world: WorldState, procedure: PoliticalProcedure, concerns: readonly QuestionConcern[]): Set<ChamberPower> {
  const needed = new Set<ChamberPower>();
  for (const concern of concerns) {
    if (concern === "war" || concern === "peace" || concern === "levy") needed.add("war");
    if (concern === "taxes" || concern === "spending") needed.add("taxes");
    if (concern === "punishment") needed.add("judgment");
  }
  const enactment = world.enactments.find((candidate) => candidate.procedureId === procedure.id);
  if (enactment !== undefined) {
    if (enactment.effects.length > 0 || enactment.office !== null || enactment.body !== null || enactment.department != null || enactment.land != null || enactment.debt != null) needed.add("laws");
    if (enactment.constitution != null) needed.add("constitution");
  }
  if (procedure.type === "removal" || procedure.type === "denunciation") needed.add("judgment");
  return needed;
}

/**
 * Whether a chamber's count of this question binds anybody. A king's council
 * never binds; a council of elders that may not make war only advises on a
 * war. An advisory count is taken, and then the ruler decides (`holdVotes`).
 */
export function isAdvisoryFor(world: WorldState, procedure: PoliticalProcedure): boolean {
  const institution = world.material.institutions.find((candidate) => candidate.id === procedure.institutionId);
  if (institution === undefined) return false;
  if (institution.advisory === true) return true;
  if (institution.powers === undefined) return false;
  const powers = new Set(institution.powers);
  return [...powersNeeded(world, procedure, concernsOf(world, procedure))].some((power) => !powers.has(power));
}

/** A question whose outcome nobody may write: counted by a chamber whose count binds. */
export function isBindingChamberQuestion(world: WorldState, procedure: PoliticalProcedure): boolean {
  return isChamberQuestion(procedure) && !isAdvisoryFor(world, procedure);
}

/**
 * A question about "a seat" that names none an election will fill: "Assign
 * command of the Sicilian front to Clepsina". The count leaves seat questions
 * to the elections, and no election names that command, so it sat gathering
 * support for forty days past its vote and was never put. The house decides it.
 */
function isUnclaimedSeatQuestion(procedure: PoliticalProcedure, electiveOffices: readonly Office[]): boolean {
  return procedure.subjectKind === "office_seat"
    && procedure.subjectId === null
    && procedure.resolutionMechanism === "vote"
    && procedure.institutionId !== null
    && !electiveOffices.some((office) => labelNamesOffice(procedure.label, office.label));
}

/** Open chamber questions in the world, with the body hearing each. A candidacy for an elected office waits for its election. */
function openQuestions(world: WorldState, electiveOffices: readonly Office[] = []): { procedure: PoliticalProcedure; institution: GovernmentInstitution }[] {
  return world.material.politicalProcedures.flatMap((procedure) => {
    if (!OPEN_STAGES.has(procedure.stage)) return [];
    if (!(isChamberQuestion(procedure) || isUnclaimedSeatQuestion(procedure, electiveOffices)) || isElectiveCandidacy(procedure, electiveOffices)) return [];
    // Counted already: advice waiting on the ruler, not a question before the house.
    if (procedure.voteRecordId !== null) return [];
    const institution = world.material.institutions.find((candidate) => candidate.id === procedure.institutionId);
    return institution === undefined ? [] : [{ procedure, institution }];
  });
}

/** Each supporter's latest word on a question. Positions are append-only; a man who turned counts once, as he now stands. */
function latestPositions(world: WorldState, procedureId: string): SupportPosition[] {
  const latest = new Map<string, SupportPosition>();
  for (const position of world.material.supportPositions) {
    if (position.procedureId !== procedureId) continue;
    const key = `${position.supporterKind}:${position.supporterId}`;
    const held = latest.get(key);
    if (held === undefined || position.changedAtStep >= held.changedAtStep) latest.set(key, position);
  }
  return [...latest.values()];
}

const signOf = (position: SupportPosition["position"]): number => (position === "support" ? 1 : position === "oppose" ? -1 : 0);
const clampScore = (score: number): number => Math.max(-100, Math.min(100, Math.round(score)));

export interface BlocLeaning {
  readonly bloc: VotingBloc;
  readonly lean: number;
  /** How most of it votes. */
  readonly choice: "yes" | "no" | "abstain";
  /** Its weight, divided by its lean (`splitOfBloc`). */
  readonly split: BlocSplit;
  readonly reasons: readonly string[];
}

export interface BlocSplit {
  readonly yes: number;
  readonly no: number;
  readonly abstain: number;
}

/**
 * How a bloc's weight divides on a question, by how far it leans.
 *
 * A bloc used to vote as one man by its thresholds: at +14 against a line of
 * +15 every one of its sixty members abstained, and at -16 every one of a
 * small bloc's members voted no, so a house that hardly cared either way
 * rejected a measure on the word of its smallest part. Past a threshold the
 * whole bloc goes that way; between them its members divide in proportion --
 * some for, the rest abstaining, at a lean above the middle of its lines; some
 * against below it.
 */
export function splitOfBloc(bloc: Pick<VotingBloc, "weight" | "yesThreshold" | "noThreshold">, lean: number): BlocSplit {
  if (lean >= bloc.yesThreshold) return { yes: bloc.weight, no: 0, abstain: 0 };
  if (lean <= bloc.noThreshold) return { yes: 0, no: bloc.weight, abstain: 0 };
  const middle = (bloc.yesThreshold + bloc.noThreshold) / 2;
  const yes = lean > middle ? Math.round((bloc.weight * (lean - middle)) / (bloc.yesThreshold - middle)) : 0;
  const no = lean < middle ? Math.round((bloc.weight * (middle - lean)) / (middle - bloc.noThreshold)) : 0;
  return { yes, no, abstain: bloc.weight - yes - no };
}

/** How most of a bloc voted: the largest part, an even split counted as abstaining. */
const choiceOf = (split: BlocSplit): BlocLeaning["choice"] =>
  split.yes > split.no && split.yes > split.abstain ? "yes" : split.no > split.yes && split.no > split.abstain ? "no" : "abstain";

/**
 * How each bloc of the chamber leans on a question, today.
 *
 * Its own disposition to begin with; then whatever its leaders have declared;
 * then every senator of the chamber's power who has spoken, each moving the
 * whole house by his standing. A man of the first rank moves it five points,
 * a man of no note one -- so three consulars against a measure can turn a bloc
 * that was only mildly for it, and nobody can turn one alone.
 */
export function blocLeanings(world: WorldState, procedure: PoliticalProcedure, institution: GovernmentInstitution): BlocLeaning[] {
  const positions = latestPositions(world, procedure.id);
  const concerns = concernsOf(world, procedure);
  // A patron's clients vote as he does: his word carries their weight too.
  const clientsOf = (characterId: string): number => world.material.politicalGroups
    .filter((group) => group.active && group.type === "clientele" && group.leaderCharacterId === characterId)
    .reduce((sum, group) => sum + Math.round((group.strengthBps ?? 0) / 2_500), 0);
  const speakers = positions.flatMap((position) => {
    if (position.supporterKind !== "character" || signOf(position.position) === 0) return [];
    const character = world.characters.find((candidate) => candidate.id === position.supporterId);
    if (character === undefined || !character.alive || character.polityId !== institution.polityId) return [];
    // His standing moves the house, and so does how he speaks: a great orator
    // half again, a poor one half as much. A priest's word carries the gods'
    // weight too, by his rites, in any house he sits in.
    const priest = world.material.officeSeats.some((seat) => seat.holderCharacterId === character.id && seat.status === "held" && /priest|pontif|augur/i.test(seat.officeId));
    const voice = 1 + skillShare(aptitude(character, "rhetoric"), 0.5) + (priest ? skillShare((aptitude(character, "rites") + aptitude(character, "theology")) / 2, 0.3) : 0);
    // And what is said of him: a man everybody speaks well of is heard, one
    // nobody trusts is heard less, by up to a quarter either way.
    const name = 1 + deriveReputation(world, character.id) / 400;
    const sway = Math.max(1, Math.round((character.prestigeBps / SWAY_PER_STANDING_BPS) * voice * name)) + clientsOf(character.id);
    return [{ name: character.name, signed: signOf(position.position) * sway, position: position.position }];
  });
  // Ordinary declarations represent a chamber's opinion, not an unlimited
  // bonus proportional to the number of named senators in the scenario.
  const houseShift = speakers.length === 0 ? 0 : Math.round(speakers.reduce((sum, speaker) => sum + speaker.signed, 0) / speakers.length * Math.min(MAX_SPEAKERS, speakers.length));
  // A trial leans as its court is run (`trials.ts`); a command kept or a
  // triumph asked, as the man's war went (`command-tenure.ts`).
  const tried = judgmentLean(world, procedure, institution.polityId);
  const tenure = tenureLean(world, procedure);
  const judged = { lean: tried.lean + tenure.lean, reasons: [...tried.reasons, ...tenure.reasons] };
  return institution.votingBlocs.map((bloc) => {
    const reasons: string[] = [`its own disposition (${bloc.baseSupport})`];
    let lean = bloc.baseSupport;
    // What it wants, met by what the question is about.
    const wanted = interestLean(bloc.interests ?? [], concerns);
    if (wanted !== 0) {
      lean += wanted;
      reasons.push(`${concerns.map((concern) => CONCERN_IN_WORDS[concern]).join(" and ")} is ${wanted > 0 ? "what it wants" : "against what it wants"} (${wanted > 0 ? "+" : ""}${wanted})`);
    }
    // A faction, a patron's clients, a fallen government's party: they go where their leader goes.
    const group = bloc.groupId == null ? undefined : world.material.politicalGroups.find((candidate) => candidate.id === bloc.groupId);
    const leaderWord = group?.leaderCharacterId == null ? undefined : positions.find((position) => position.supporterKind === "character" && position.supporterId === group.leaderCharacterId);
    if (leaderWord !== undefined && signOf(leaderWord.position) !== 0) {
      lean += signOf(leaderWord.position) * FOLLOWING_SHIFT;
      const leaderName = world.characters.find((character) => character.id === group!.leaderCharacterId)?.name ?? group!.leaderCharacterId;
      reasons.push(`${leaderName}, whom it follows, is ${leaderWord.position === "support" ? "for" : "against"} it`);
    }
    const declared = positions.find((position) => position.supporterKind === "group" && position.supporterId === bloc.id);
    if (declared !== undefined && signOf(declared.position) !== 0) {
      lean += signOf(declared.position) * BLOC_DECLARATION_SHIFT;
      reasons.push(`its leaders declared ${declared.position === "support" ? "for" : "against"} it`);
    }
    lean += houseShift + judged.lean;
    reasons.push(...judged.reasons);
    const forIt = speakers.filter((speaker) => speaker.position === "support").map((speaker) => speaker.name);
    const againstIt = speakers.filter((speaker) => speaker.position === "oppose").map((speaker) => speaker.name);
    if (forIt.length > 0) reasons.push(`${forIt.join(", ")} spoke for it`);
    if (againstIt.length > 0) reasons.push(`${againstIt.join(", ")} spoke against it`);
    const score = clampScore(lean);
    const split = splitOfBloc(bloc, score);
    return { bloc, lean: score, choice: choiceOf(split), split, reasons: reasons.map((reason) => reason.slice(0, 200)) };
  });
}

/** The count, as the chamber's own rules have it. */
function countVote(id: string, procedure: PoliticalProcedure, institution: GovernmentInstitution, leanings: readonly BlocLeaning[], atStep: number): VoteRecord {
  const weightOf = (choice: BlocLeaning["choice"]) => leanings.reduce((sum, leaning) => sum + leaning.split[choice], 0);
  const yesWeight = weightOf("yes");
  const noWeight = weightOf("no");
  const abstainWeight = weightOf("abstain");
  // Every bloc sits; one that abstains is there and says nothing.
  const presentWeight = yesWeight + noWeight + abstainWeight;
  const denominator = institution.denominator === "total" ? institution.totalVotingWeight : institution.denominator === "present" ? presentWeight : yesWeight + noWeight;
  const quorumMet = presentWeight * 10_000 >= institution.quorumBps * institution.totalVotingWeight;
  const thresholdMet = denominator > 0 && yesWeight * 10_000 >= institution.passageThresholdBps * denominator;
  return {
    id,
    motionId: procedure.id,
    // A divided bloc is recorded as its parts, each with the weight that went that way.
    votes: leanings.flatMap((leaning) => (["yes", "no", "abstain"] as const)
      .filter((choice) => leaning.split[choice] > 0)
      .map((choice) => ({ blocId: leaning.bloc.id, choice, weight: leaning.split[choice], supportScore: leaning.lean, reasons: [...leaning.reasons] }))),
    yesWeight,
    noWeight,
    abstainWeight,
    presentWeight,
    quorumMet,
    thresholdMet,
    outcome: quorumMet && thresholdMet && yesWeight > noWeight ? "passed" : "failed",
    resolvedAtStep: atStep,
  };
}

/** How often a question is put off for want of a mind before a failed count stands. */
export const MAX_ADJOURNMENTS = 1;

/**
 * A count that would fail with most of the house undecided puts the question
 * off to its next sitting instead: a house that has not made up its mind has
 * not refused. Once only; a second time, the count stands.
 */
function adjourns(procedure: PoliticalProcedure, record: VoteRecord): boolean {
  return record.outcome === "failed" && record.abstainWeight * 2 > record.presentWeight && (procedure.adjournments ?? 0) < MAX_ADJOURNMENTS;
}

const CHOICE_WORDS = { yes: "for", no: "against", abstain: "abstaining" } as const;

/** "the patrician houses", and "the citizens" for a bloc already called "The citizens". */
const theBloc = (name: string): string => (/^the\s/iu.test(name) ? `the${name.slice(3)}` : `the ${name}`);

/** "the patrician houses for, the plebeian new men 27 against and 13 abstaining" */
function howTheyVoted(leanings: readonly BlocLeaning[]): string {
  return leanings.map((leaning) => {
    const parts = (["yes", "no", "abstain"] as const).filter((choice) => leaning.split[choice] > 0);
    return parts.length <= 1
      ? `${theBloc(leaning.bloc.name)} ${CHOICE_WORDS[leaning.choice]}`
      : `${theBloc(leaning.bloc.name)} ${parts.map((choice) => `${leaning.split[choice]} ${CHOICE_WORDS[choice]}`).join(" and ")}`;
  }).join(", ");
}

/** How the house leans on a question, in words, for whoever may lobby it. */
export function forecastInWords(world: WorldState, procedure: PoliticalProcedure, offices: readonly Office[] = []): string | null {
  const institution = world.material.institutions.find((candidate) => candidate.id === procedure.institutionId);
  if (institution === undefined || !isChamberQuestion(procedure)) return null;
  const vetoes = vetoesOf(world, procedure, institution, offices);
  if (vetoes.length > 0) {
    return `${vetoes.map((veto) => `${veto.name}, as ${veto.office}`).join(", and ")}, has forbidden it: unless he relents, it will not be put to the vote.`;
  }
  const leanings = blocLeanings(world, procedure, institution);
  const record = countVote("forecast", procedure, institution, leanings, world.elapsedStep);
  const each = leanings.map((leaning) => {
    const parts = (["yes", "no", "abstain"] as const).filter((choice) => leaning.split[choice] > 0);
    const how = parts.length > 1 ? `would divide, ${parts.map((choice) => `${leaning.split[choice]} ${CHOICE_WORDS[choice]}`).join(", ")}` : leaning.choice === "abstain" ? "would abstain" : `would vote ${CHOICE_WORDS[leaning.choice]}`;
    return `${theBloc(leaning.bloc.name)} (${leaning.bloc.weight} votes) leans ${leaning.lean >= 0 ? "+" : ""}${leaning.lean}, ${how} (all for at ${leaning.bloc.yesThreshold}, all against at ${leaning.bloc.noThreshold})`;
  });
  const outcome = record.outcome === "passed" ? "pass" : adjourns(procedure, record) ? "be put off, too few minds made up" : "fail";
  return `${each.join("; ")}. As it stands it would ${outcome}, ${record.yesWeight} to ${record.noWeight}.`;
}

/**
 * Whoever holds a vetoing office of the chamber's power and stands against the
 * question, with the office -- and every tribune whose intercession stands
 * against the man who put it, which used to stop only his next motion and not
 * the one already before the house (`tribunes.ts`).
 */
function vetoesOf(world: WorldState, procedure: PoliticalProcedure, institution: GovernmentInstitution, offices: readonly Office[]): { name: string; office: string }[] {
  const vetoOffices = allOffices(world, offices).filter((office) => office.vetoes === true && office.polityId === institution.polityId);
  const opposed = latestPositions(world, procedure.id).flatMap((position) => {
    if (position.supporterKind !== "character" || position.position !== "oppose") return [];
    const office = vetoOffices.find((candidate) => world.material.officeSeats.some((seat) =>
      seat.officeId === candidate.id && seat.holderCharacterId === position.supporterId && seat.status === "held"));
    const character = world.characters.find((candidate) => candidate.id === position.supporterId);
    return office === undefined || character === undefined || !character.alive ? [] : [{ name: character.name, office: office.label }];
  });
  const interceding = intercessionsAgainst(world, procedure, institution, offices).filter((veto) => !opposed.some((known) => known.name === veto.name));
  return [...opposed, ...interceding];
}

export interface HoldVotesInput {
  readonly world: WorldState;
  readonly offices: readonly Office[];
  /** How offices are filled, so a candidacy for an elected one is left to its election. */
  readonly successionRules?: readonly SuccessionRule[] | undefined;
  readonly toDay: number;
  readonly ids: IdFactory;
}

/** Every chamber question whose day has come, counted. Overdue ones are counted at the first tick that finds them. */
export function holdVotes(input: HoldVotesInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  // The plebs out of the city first: a demand the house gives way to is
  // carried today, and a power whose plebs are still out does no business in
  // its chambers until they come back (`tribunes.ts`).
  const seceded = settleSecessions(world, input.offices, input.toDay, secessionHooks(input));
  world = seceded.world;
  facts.push(...seceded.facts);
  const elective = electiveOfficesOf(world, input.offices, input.successionRules ?? []);
  for (const { procedure, institution } of openQuestions(world, elective)) {
    if (voteDayOf(procedure) > input.toDay || seceded.out.has(institution.polityId)) continue;
    // Forbidden, it is not put to the house at all.
    const vetoes = vetoesOf(world, procedure, institution, input.offices);
    if (vetoes.length > 0) {
      const who = vetoes.map((veto) => `${veto.name}, as ${veto.office}`).join(", and ");
      const said = `${who}, forbade "${procedure.label}", and the ${institution.name} could not put it to the vote.`;
      world = {
        ...world,
        material: {
          ...world.material,
          politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === procedure.id
            ? { ...candidate, stage: "blocked" as const, outcome: "blocked" as const, outcomeReason: said.slice(0, 400), resolvedAtStep: input.toDay }
            : candidate)),
        },
      };
      facts.push({
        localId: `vote_${facts.length + 1}`,
        kind: "motion_vetoed",
        summary: said,
        affectedRefs: [{ kind: "procedure", id: procedure.id }, { kind: "polity", id: institution.polityId }, { kind: "character", id: procedure.sponsorCharacterId }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 60,
      });
      continue;
    }
    const leanings = blocLeanings(world, procedure, institution);
    const record = countVote(input.ids.next("vote"), procedure, institution, leanings, input.toDay);
    const carried = record.outcome === "passed";
    // Counsel, not a decision: recorded, and put to the ruler.
    if (isAdvisoryFor(world, procedure)) {
      const advised = giveAdvice(world, procedure, institution, record, leanings, input);
      world = advised.world;
      facts.push(advised.fact);
      continue;
    }
    const tally = `${record.yesWeight} to ${record.noWeight}${record.abstainWeight > 0 ? `, ${record.abstainWeight} abstaining` : ""}`;
    // Who swung it, for the historian: the count alone is a clerk's line.
    const spoke = (position: "support" | "oppose") => latestPositions(world, procedure.id)
      .filter((candidate) => candidate.supporterKind === "character" && candidate.position === position)
      .flatMap((candidate) => world.characters.find((character) => character.id === candidate.supporterId)?.name ?? []);
    const forIt = spoke("support");
    const againstIt = spoke("oppose");
    const debate = [
      forIt.length === 0 ? null : `${forIt.join(", ")} spoke for it`,
      againstIt.length === 0 ? null : `${againstIt.join(", ")} against it`,
    ].filter((part) => part !== null).join("; ");
    // Most of the house undecided: put off to another day, not refused.
    if (adjourns(procedure, record)) {
      const said = `The ${institution.name} could not make up its mind on "${procedure.label}", ${tally}: ${howTheyVoted(leanings)}. It is put off, to be put again in ${MOTION_VOTING_DAYS} days.`;
      world = {
        ...world,
        material: {
          ...world.material,
          politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === procedure.id
            ? { ...candidate, deadlineStep: input.toDay + MOTION_VOTING_DAYS, adjournments: (candidate.adjournments ?? 0) + 1, outcomeReason: said.slice(0, 400) }
            : candidate)),
        },
      };
      facts.push({
        localId: `vote_${facts.length + 1}`,
        kind: "motion_adjourned",
        summary: said,
        affectedRefs: [{ kind: "procedure", id: procedure.id }, { kind: "polity", id: institution.polityId }, { kind: "character", id: procedure.sponsorCharacterId }],
        visibility: "public",
        discoveryState: "public",
        knowableInDays: 0,
        significance: 45,
      });
      continue;
    }
    const verdict = carried
      ? `The ${institution.name} carried "${procedure.label}", ${tally}: ${howTheyVoted(leanings)}.`
      : !record.quorumMet
        ? `The ${institution.name} could not muster a quorum on "${procedure.label}", and it fell.`
        : `The ${institution.name} rejected "${procedure.label}", ${tally}: ${howTheyVoted(leanings)}.`;
    const leave = carried && beginsNothing(world, procedure) ? `${verdict} ${BEGINS_NOTHING}` : verdict;
    const said = debate.length === 0 ? leave : `${leave} ${debate[0]!.toUpperCase()}${debate.slice(1)}.`;
    const settled: PoliticalProcedure = {
      ...procedure,
      stage: "resolved",
      outcome: record.outcome,
      outcomeReason: said.slice(0, 400),
      resolvedAtStep: input.toDay,
      voteRecordId: record.id,
    };
    world = {
      ...world,
      material: {
        ...world.material,
        voteRecords: [...world.material.voteRecords, record],
        politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === procedure.id ? settled : candidate)),
      },
    };
    const speakers = latestPositions(world, procedure.id)
      .filter((position) => position.supporterKind === "character" && world.characters.some((character) => character.id === position.supporterId))
      .map((position) => ({ kind: "character" as const, id: position.supporterId }));
    facts.push({
      localId: `vote_${facts.length + 1}`,
      kind: carried ? "motion_passed" : "motion_failed",
      summary: said,
      affectedRefs: [
        // The question itself, first: a vote is its own matter in the record
        // (chronicle.ts `splitIntoThreads`), whoever else voted on others.
        { kind: "procedure", id: procedure.id },
        { kind: "polity", id: institution.polityId },
        { kind: "character", id: procedure.sponsorCharacterId },
        ...speakers.filter((ref) => ref.id !== procedure.sponsorCharacterId).slice(0, 6),
      ],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      // As much as an election: what a republic's government may now do.
      significance: 60,
    });
    // Carried, it does what it said it would, and moves the office it names.
    if (carried) {
      const enacted = carryOutEnactment(world, procedure.id, input.toDay, input.ids, input.offices, input.successionRules ?? []);
      world = sentenceByOutcome(seatByOutcome(enacted.world, settled, input.toDay, input.offices), settled, input.toDay);
      facts.push(...enacted.facts);
    } else {
      const referred = referOn(world, settled, institution, input);
      world = referred.world;
      if (referred.fact !== null) facts.push(referred.fact);
    }
  }
  const settledAdvice = settleAdvice(world, input);
  return { world: settledAdvice.world, facts: [...facts, ...settledAdvice.facts] };
}

/**
 * A council's counsel, recorded and put to the ruler. The question stays open
 * for `ADVICE_DAYS`: the ruler takes it or overrules it ("political_procedure_resolve"),
 * and if he says nothing, what the council advised stands.
 */
function giveAdvice(
  world: WorldState,
  procedure: PoliticalProcedure,
  institution: GovernmentInstitution,
  record: VoteRecord,
  leanings: readonly BlocLeaning[],
  input: HoldVotesInput,
): { world: WorldState; fact: FactProposalDraft } {
  const government = { offices: input.offices, successionRules: input.successionRules ?? [] };
  const ruler = rulerOf(world, institution.polityId, government);
  const verb = record.outcome === "passed" ? "advised for" : "advised against";
  const said = `The ${institution.name} ${verb} "${procedure.label}", ${record.yesWeight} to ${record.noWeight}: ${howTheyVoted(leanings)}. It is ${ruler === null ? "the government's" : `${ruler.name}'s`} to decide.`;
  let next: WorldState = {
    ...world,
    material: {
      ...world.material,
      voteRecords: [...world.material.voteRecords, record],
      politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === procedure.id
        ? { ...candidate, stage: "voting_or_deciding" as const, voteRecordId: record.id, outcomeReason: said.slice(0, 400), deadlineStep: input.toDay + ADVICE_DAYS }
        : candidate)),
    },
  };
  if (ruler !== null) {
    const id = boundedId("advice", procedure.id, ruler.id);
    if (!next.characterPressures.some((pressure) => pressure.id === id)) {
      const pressured = createPressure(next, {
        id,
        characterId: ruler.id,
        kind: "opportunity",
        intensity: 55,
        label: `His council ${verb} "${procedure.label}" [${procedure.id}]: he may take its advice or overrule it, and in ${ADVICE_DAYS} days its advice stands`.slice(0, 200),
        sourceEventId: null,
        atStep: input.toDay,
        reviewInSteps: 3,
        expiresInSteps: ADVICE_DAYS,
        visibility: "polity",
      });
      next = { ...next, characters: [...pressured.characters], characterPressures: [...pressured.characterPressures] };
    }
  }
  return {
    world: next,
    fact: {
      localId: `advice_${procedure.id}`.slice(0, 60),
      kind: "council_advised",
      summary: said,
      affectedRefs: [{ kind: "procedure", id: procedure.id }, { kind: "polity", id: institution.polityId }, { kind: "character", id: procedure.sponsorCharacterId }, ...(ruler === null ? [] : [{ kind: "character" as const, id: ruler.id }])],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 45,
    },
  };
}

/** Advice the ruler neither took nor overruled in time: what the council advised is what is done. */
function settleAdvice(world: WorldState, input: HoldVotesInput): { world: WorldState; facts: FactProposalDraft[] } {
  let next = world;
  const facts: FactProposalDraft[] = [];
  for (const procedure of world.material.politicalProcedures) {
    if (!OPEN_STAGES.has(procedure.stage) || procedure.voteRecordId === null || !isChamberQuestion(procedure)) continue;
    if ((procedure.deadlineStep ?? 0) > input.toDay) continue;
    const record = world.material.voteRecords.find((candidate) => candidate.id === procedure.voteRecordId);
    const institution = world.material.institutions.find((candidate) => candidate.id === procedure.institutionId);
    if (record === undefined || institution === undefined) continue;
    const carried = record.outcome === "passed";
    const said = carried
      ? `Nobody overruled the ${institution.name}, and "${procedure.label}" was done as it advised.${beginsNothing(next, procedure) ? ` ${BEGINS_NOTHING}` : ""}`
      : `Nobody overruled the ${institution.name}, and "${procedure.label}" was let drop as it advised.`;
    const settled: PoliticalProcedure = { ...procedure, stage: carried ? "resolved" : "withdrawn", outcome: carried ? "passed" : "withdrawn", outcomeReason: said.slice(0, 400), resolvedAtStep: input.toDay };
    next = { ...next, material: { ...next.material, politicalProcedures: next.material.politicalProcedures.map((candidate) => (candidate.id === procedure.id ? settled : candidate)) } };
    if (carried) {
      const enacted = carryOutEnactment(next, procedure.id, input.toDay, input.ids, input.offices, input.successionRules ?? []);
      next = sentenceByOutcome(seatByOutcome(enacted.world, settled, input.toDay, input.offices), settled, input.toDay);
      facts.push(...enacted.facts);
    }
    facts.push({
      localId: `advice_settled_${procedure.id}`.slice(0, 60),
      kind: carried ? "motion_passed" : "motion_failed",
      summary: said,
      affectedRefs: [{ kind: "procedure", id: procedure.id }, { kind: "polity", id: institution.polityId }, { kind: "character", id: procedure.sponsorCharacterId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 45,
    });
  }
  return { world: next, facts };
}

/**
 * A magistrate's question rejected by a chamber that sends a split on: it goes
 * to the next chamber, once, with a fresh day. Carthage's council and suffetes
 * who disagreed took the matter to the people.
 */
function referOn(world: WorldState, settled: PoliticalProcedure, institution: GovernmentInstitution, input: HoldVotesInput): { world: WorldState; fact: FactProposalDraft | null } {
  const targetId = institution.refersFailuresTo ?? null;
  if (targetId === null || settled.referredFromInstitutionId != null) return { world, fact: null };
  const target = world.material.institutions.find((candidate) => candidate.id === targetId);
  if (target === undefined) return { world, fact: null };
  const magistracies = new Set(allOffices(world, input.offices).filter((office) => office.polityId === institution.polityId && (office.kind ?? "magistracy") === "magistracy").map((office) => office.id));
  const sponsorIsMagistrate = world.material.officeSeats.some((seat) => seat.holderCharacterId === settled.sponsorCharacterId && seat.status === "held" && magistracies.has(seat.officeId));
  if (!sponsorIsMagistrate) return { world, fact: null };
  const sponsor = world.characters.find((character) => character.id === settled.sponsorCharacterId)?.name ?? settled.sponsorCharacterId;
  const reopened: PoliticalProcedure = {
    ...settled,
    institutionId: target.id,
    referredFromInstitutionId: institution.id,
    stage: "gathering_support",
    outcome: null,
    resolvedAtStep: null,
    voteRecordId: null,
    deadlineStep: input.toDay + MOTION_VOTING_DAYS,
    outcomeReason: `The ${institution.name} rejected it, and ${sponsor} took it to the ${target.name}.`.slice(0, 400),
  };
  return {
    world: { ...world, material: { ...world.material, politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === settled.id ? reopened : candidate)) } },
    fact: {
      localId: `referred_${settled.id}`.slice(0, 60),
      kind: "motion_referred",
      summary: `The ${institution.name} would not have "${settled.label}", and ${sponsor} has taken it to the ${target.name}, which votes in ${MOTION_VOTING_DAYS} days [${settled.id}].`,
      affectedRefs: [{ kind: "procedure", id: settled.id }, { kind: "polity", id: institution.polityId }, { kind: "character", id: settled.sponsorCharacterId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 55,
    },
  };
}

/**
 * What a ruler pays for acting against his council.
 *
 * Carrying a question his council advised against -- or decreeing a measure
 * his council would have advised against, had he asked it -- is lawful and
 * costs him: the power's legitimacy, the council's standing, his own. A ruler
 * who makes a habit of it makes it a custom, and it costs him half as much
 * thereafter (`society.ts` writes the custom down).
 */
export function overruleCost(world: WorldState, procedure: PoliticalProcedure, offices: readonly Office[], successionRules: readonly SuccessionRule[], atStep: number): { world: WorldState; fact: FactProposalDraft | null } {
  const polityId = world.material.institutions.find((institution) => institution.id === procedure.institutionId)?.polityId
    ?? world.characters.find((character) => character.id === procedure.sponsorCharacterId)?.polityId ?? null;
  if (polityId === null) return { world, fact: null };
  const heard = world.material.institutions.find((institution) => institution.id === procedure.institutionId);
  const council = heard !== undefined && isAdvisoryFor(world, procedure) ? heard : procedure.institutionId === null ? world.material.institutions.find((institution) => institution.polityId === polityId && institution.advisory === true) : undefined;
  if (council === undefined) return { world, fact: null };
  const record = procedure.voteRecordId === null ? null : world.material.voteRecords.find((candidate) => candidate.id === procedure.voteRecordId) ?? null;
  const against = record !== null ? record.outcome === "failed" : countVote("forecast", procedure, council, blocLeanings(world, procedure, council), atStep).outcome === "failed";
  if (!against) return { world, fact: null };
  const customary = world.genericEntities.some((entity) => entity.kind === "custom" && entity.ownerRef?.kind === "polity" && entity.ownerRef.id === polityId && entity.attributes?.["customKind"] === "overruled_council");
  const scale = customary ? 0.5 : 1;
  const ruler = rulerOf(world, polityId, { offices, successionRules });
  const legitimacyCost = Math.round(400 * scale);
  const councilCost = Math.round(600 * scale);
  const standingCost = Math.round(200 * scale);
  const next: WorldState = {
    ...world,
    characters: world.characters.map((character) => (character.id === (ruler?.id ?? procedure.sponsorCharacterId) ? { ...character, prestigeBps: Math.max(0, character.prestigeBps - standingCost) } : character)),
    society: { ...world.society, precedents: [...world.society.precedents, { polityId, kind: "overruled_council" as const, key: council.id, atStep }].slice(-200) },
    material: {
      ...world.material,
      polityLegitimacy: adjustPolityLegitimacy(world.material.polityLegitimacy, polityId, -legitimacyCost, `The ruler overruled the ${council.name}`, procedure.id),
      institutionLegitimacy: world.material.institutionLegitimacy.some((entry) => entry.institutionId === council.id)
        ? world.material.institutionLegitimacy.map((entry) => (entry.institutionId === council.id ? { ...entry, legitimacyBps: Math.max(0, entry.legitimacyBps - councilCost) } : entry))
        : [...world.material.institutionLegitimacy, { institutionId: council.id, legitimacyBps: 5_000 - councilCost, causes: [] }],
    },
  };
  const who = ruler?.name ?? world.characters.find((character) => character.id === procedure.sponsorCharacterId)?.name ?? "The ruler";
  return {
    world: next,
    fact: {
      localId: `overruled_${procedure.id}`.slice(0, 60),
      kind: "council_overruled",
      summary: `${who} carried "${procedure.label}" against the advice of the ${council.name}${customary ? ", as rulers there now do" : ""}.`,
      affectedRefs: [{ kind: "procedure", id: procedure.id }, { kind: "polity", id: polityId }, ...(ruler === null ? [] : [{ kind: "character" as const, id: ruler.id }])],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: 55,
    },
  };
}

/**
 * Who is due to say where they stand, and why, in the days before a vote.
 *
 * Whoever raised it, whoever holds an office that may forbid it, then the
 * power's most senior office-holders, up to `MAX_SPEAKERS` a question -- and
 * only those who have not yet declared on it. The player is never due: his
 * word is his to give.
 */
export function debatersOf(
  world: WorldState,
  offices: readonly Office[],
  today: number,
  excludeIds: readonly string[],
  successionRules: readonly SuccessionRule[] = [],
): Map<string, string> {
  const excluded = new Set(excludeIds);
  const due = new Map<string, string>();
  const everyOffice = allOffices(world, offices);
  for (const { procedure, institution } of openQuestions(world, electiveOfficesOf(world, offices, successionRules))) {
    const day = voteDayOf(procedure);
    if (today < day - DEBATE_LEAD_DAYS || today >= day) continue;
    const declared = new Set(latestPositions(world, procedure.id).filter((position) => position.supporterKind === "character").map((position) => position.supporterId));
    const seatedIn = (characterId: string, officeIds: ReadonlySet<string>) =>
      world.material.officeSeats.some((seat) => seat.holderCharacterId === characterId && seat.status === "held" && officeIds.has(seat.officeId));
    const polityOffices = new Set(everyOffice.filter((office) => office.polityId === institution.polityId).map((office) => office.id));
    const vetoOffices = new Set(everyOffice.filter((office) => office.polityId === institution.polityId && office.vetoes === true).map((office) => office.id));
    const eligible = world.characters.filter((character) =>
      character.alive && character.polityId === institution.polityId);
    const sponsor = eligible.filter((character) => character.id === procedure.sponsorCharacterId);
    const vetoers = eligible.filter((character) => seatedIn(character.id, vetoOffices));
    const senior = eligible
      .filter((character) => seatedIn(character.id, polityOffices))
      .sort((a, b) => b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id));
    // Select the same pivotal cohort for the whole question, not four new
    // senators every day after the previous four have spoken.
    const leaderIds = new Set(institution.votingBlocs.flatMap((bloc) => {
      const group = world.material.politicalGroups.find((candidate) => candidate.id === bloc.groupId);
      return group?.leaderCharacterId == null ? [] : [group.leaderCharacterId];
    }));
    const leaders = eligible.filter((character) => leaderIds.has(character.id));
    const cohort = [...new Map([...sponsor, ...vetoers.slice(0, 1), ...leaders, ...senior].map((character) => [character.id, character])).values()].slice(0, MAX_SPEAKERS);
    const chosen = cohort.filter((character) => !declared.has(character.id) && !excluded.has(character.id));
    const inDays = day - today;
    const forecast = forecastInWords(world, procedure, offices);
    for (const character of chosen) {
      if (due.has(character.id)) continue;
      due.set(character.id, `the ${institution.name} votes on "${procedure.label}" [${procedure.id}] in ${inDays} day${inDays === 1 ? "" : "s"}; ${forecast ?? ""} Where he stands, and whether he speaks for or against it ("political_support_set" on it, with what he says in the house as its "words"), is his to say`.slice(0, 600));
    }
  }
  return due;
}

/** The days the calendar must stop for: each open question's debate and its vote. */
export function voteCalendarDays(world: WorldState, electiveOffices: readonly Office[] = []): number[] {
  return openQuestions(world, electiveOffices).flatMap(({ procedure }) => {
    const day = voteDayOf(procedure);
    return [day - DEBATE_LEAD_DAYS, day];
  });
}
