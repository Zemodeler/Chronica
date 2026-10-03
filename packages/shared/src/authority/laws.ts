import { allOffices, type Office } from "../characters/character";
import { labelFromCategoryId } from "../warfare/troop-categories";
import { entityKey, type Linked } from "../knowledge/glossary";
import { accountLabel } from "../material/account-names";
import { GOVERNMENT_FORM_IN_WORDS } from "../political-parts";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import { LEVERS, leverDefinition } from "../world/departments";
import type { Enactment } from "../world/enactment";
import { effectInWords } from "../world/standing-effects";
import type { WorldState } from "../world/world-state";
import { buildStation, type Station } from "./station";

/**
 * The measures of the player's state: those in force, and those before the
 * councils.
 *
 * Every carried measure leaves an `Enactment` behind -- what it does, as parts
 * -- and, since `record` was added, a note of its own passing: who carried it,
 * in which body, on what day and by what vote. A law could be described from
 * the enactment alone, but its title, its chamber and its sponsor lived only
 * in the procedure that carried it, and a procedure is the first thing a
 * constitutional change takes away (the chamber is abolished; the sponsor
 * dies). So the reader prefers the record and falls back on the procedure, and
 * where neither is left it says that the record does not say.
 *
 * What a citizen may know: the measures of their own state, and the business
 * public to it. How a vote stands goes only to those who sit in the body or
 * are party to the question -- the same line `readTheState` draws.
 */

export interface LawDetail {
  readonly body: string | null;
  readonly sponsor: Linked | null;
  /** Dates as sentences: "Put forward 3 March", "Carried 9 March", "Carried out 9 March". */
  readonly dates: readonly string[];
  /** Money and duties it puts on the state, one line each. */
  readonly obligations: readonly string[];
  /** Where it has got to: "In force", "Work under way", "Lapsed for want of upkeep". */
  readonly status: string;
  /** How the vote stood or stands: only for what the player may know. Null otherwise. */
  readonly vote: string | null;
  /** What the record does not say, each as a sentence. */
  readonly unknown: readonly string[];
}

export interface LawRow {
  /** The procedure's id. */
  readonly key: string;
  readonly name: string;
  /** What it does, or would do, in one plain sentence. */
  readonly sentence: string;
  /** It wants the player's word, or it has gone wrong. */
  readonly marked: boolean;
  readonly yours: boolean;
  readonly detail: LawDetail;
}

export interface LawsReading {
  readonly inForce: readonly LawRow[];
  readonly before: readonly LawRow[];
}

const EMPTY: LawsReading = { inForce: [], before: [] };
const OPEN_STAGES = new Set(["proposed", "gathering_support", "deliberating", "voting_or_deciding"]);
const STAGE_IN_WORDS: Readonly<Record<string, string>> = {
  proposed: "Put forward, not yet taken up",
  gathering_support: "Support being gathered",
  deliberating: "Under debate",
  voting_or_deciding: "Being put to the vote",
};
const SUCCESSION_IN_WORDS = { primogeniture: "inherited by the eldest", elective: "elective", appointment: "filled by appointment", seniority: "filled by seniority" } as const;

const upper = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
const money = (amount: number): string => Math.round(amount).toLocaleString("en-GB");

/** What an enactment does, one clause per part, with no full stop and no capital. */
export function enactmentClauses(world: WorldState, enactment: Enactment, offices: readonly Office[] = []): string[] {
  const clauses: string[] = [];
  const officeName = (id: string, label: string | null): string =>
    label ?? allOffices(world, offices).find((office) => office.id === id)?.label ?? labelFromCategoryId(id);
  const institutionName = (id: string | null): string | null =>
    id === null ? null : world.material.institutions.find((institution) => institution.id === id)?.name ?? null;

  for (const effect of enactment.effects) clauses.push(effectInWords(effect));
  if (enactment.office != null) {
    const reform = enactment.office;
    const name = officeName(reform.officeId, reform.officeLabel);
    if (reform.abolish) clauses.push(`abolishes the office of ${name}`);
    else {
      const parts: string[] = [];
      if (reform.seats != null) parts.push(`${reform.seats} ${reform.seats === 1 ? "seat" : "seats"}`);
      if (reform.termDays != null) parts.push(`a term of ${reform.termDays} days`);
      if (reform.authorises != null && reform.authorises.length > 0) parts.push(`power to ${reform.authorises.slice(0, 4).map((power) => power.replace(/_/g, " ")).join(", ")}`);
      const exists = allOffices(world, offices).some((office) => office.id === reform.officeId);
      clauses.push(`${exists ? "reforms" : "creates"} the office of ${name}${parts.length === 0 ? "" : `, with ${parts.join(" and ")}`}`);
    }
  }
  if (enactment.body != null) clauses.push(`founds ${enactment.body.name}`);
  if (enactment.constitution != null) {
    const amendment = enactment.constitution;
    if (amendment.form != null) clauses.push(`recasts the constitution as ${GOVERNMENT_FORM_IN_WORDS[amendment.form]}`);
    if (amendment.chamber != null) {
      const chamber = amendment.chamber;
      const name = chamber.name ?? institutionName(chamber.institutionId) ?? "a chamber";
      clauses.push(chamber.abolish ? `abolishes ${name}` : chamber.institutionId === null ? `founds ${name}` : `reforms ${name}`);
    }
    if (amendment.succession != null) clauses.push(`makes the office of ${officeName(amendment.succession.officeId, null)} ${SUCCESSION_IN_WORDS[amendment.succession.kind]}`);
  }
  if (enactment.department != null) {
    const department = enactment.department;
    const existing = department.departmentId === null ? undefined : (world.departments ?? []).find((candidate) => candidate.id === department.departmentId);
    const name = department.name ?? existing?.name ?? "a department";
    if (department.abolish) clauses.push(`abolishes ${name}`);
    else {
      const levers = (department.levers ?? existing?.levers ?? []).slice(0, 3).map((lever) => leverDefinition(lever).words);
      clauses.push(`${existing === undefined ? "founds" : "reforms"} ${name}${levers.length === 0 ? "" : `, in charge of ${levers.join(", ")}`}`);
    }
  }
  if (enactment.projectId != null) {
    const work = world.projects.find((project) => project.id === enactment.projectId);
    clauses.push(work === undefined ? "orders a work to be done" : `orders the work: ${work.label}`);
  }
  if (enactment.budget != null) {
    const budget = enactment.budget;
    const account = world.material.accounts.find((candidate) => candidate.id === budget.accountId);
    const from = account === undefined ? "the treasury" : accountLabel(world, account, "clause");
    clauses.push(budget.amount === null ? `sets aside a standing budget from ${from} for ${budget.purpose}` : `authorises ${money(budget.amount)} from ${from} for ${budget.purpose}`);
  }
  if (enactment.waiver !== null) {
    const excused = world.characters.find((character) => character.id === enactment.waiver!.characterId)?.name ?? "one man";
    clauses.push(`excuses ${excused} the usual ladder to ${officeName(enactment.waiver.officeId, null)}`);
  }
  return clauses;
}

/** The clauses as one sentence, or null where the measure sets nothing down. */
function sentenceOf(clauses: readonly string[], lead: string): string | null {
  if (clauses.length === 0) return null;
  const joined = clauses.length === 1 ? clauses[0]! : `${clauses.slice(0, -1).join(", ")} and ${clauses[clauses.length - 1]}`;
  return `${lead}${lead.length === 0 ? upper(joined) : joined}.`;
}

export function readLaws(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): LawsReading {
  if (characterId === null) return EMPTY;
  const station: Station = buildStation({ world, characterId, offices });
  const polityId = station.polityId;
  if (polityId === null) return EMPTY;
  const date = (day: number): string => (clock === undefined ? `day ${day}` : formatWorldDate({ day, minute: 0 }, clock));
  const person = (id: string): Linked => ({ label: world.characters.find((character) => character.id === id)?.name ?? "someone", key: entityKey("person", id) });
  const institution = (id: string | null) => (id === null ? undefined : world.material.institutions.find((candidate) => candidate.id === id));
  const procedures = new Map(world.material.politicalProcedures.map((procedure) => [procedure.id, procedure]));
  const voteOf = (id: string | null) => (id === null ? undefined : world.material.voteRecords.find((record) => record.id === id));
  const today = world.elapsedStep;

  /** How the player stands to a procedure: party to it, a member of its body, or a citizen of the power it is public in. */
  const stands = (procedureId: string) => {
    const procedure = procedures.get(procedureId);
    if (procedure === undefined) return { party: false, member: false, publicHere: true };
    const body = institution(procedure.institutionId);
    return {
      party: station.procedureIds.has(procedure.id),
      member: procedure.institutionId !== null && station.institutionIds.has(procedure.institutionId),
      publicHere: procedure.visibility === "public" && body?.polityId === polityId,
    };
  };

  const inForce: LawRow[] = [];
  for (const enactment of world.enactments) {
    if (enactment.polityId !== polityId || enactment.enactedAtStep === null) continue;
    const seen = stands(enactment.procedureId);
    if (!seen.party && !seen.member && !seen.publicHere) continue;
    const procedure = procedures.get(enactment.procedureId);
    const record = enactment.record ?? null;
    const name = record?.title ?? procedure?.label ?? "A measure whose title is not recorded";
    const clauses = enactmentClauses(world, enactment, offices);
    const sentence = sentenceOf(clauses, "") ?? record?.said.replace(/^./, (first) => first.toUpperCase()).replace(/\.?$/, ".") ?? "It sets nothing down that the record keeps.";

    const unknown: string[] = [];
    const bodyName = record?.bodyName ?? institution(procedure?.institutionId ?? null)?.name ?? null;
    const sponsorId = record?.sponsorCharacterId ?? procedure?.sponsorCharacterId ?? null;
    const decided = record?.decidedAtStep ?? procedure?.resolvedAtStep ?? null;
    if (bodyName === null) unknown.push(record === null || record === undefined ? "The record does not say which body carried it." : "It was decreed, not voted.");
    if (decided === null) unknown.push("The record does not say when it was carried.");
    const tallied = record?.vote ?? (() => { const found = voteOf(procedure?.voteRecordId ?? null); return found === undefined ? null : { yes: found.yesWeight, no: found.noWeight }; })();
    const mayKnowVote = seen.party || seen.member || seen.publicHere;
    const vote = tallied !== null && mayKnowVote ? `For ${tallied.yes}, against ${tallied.no}` : null;
    if (tallied === null && bodyName !== null && procedure?.resolutionMechanism === "vote") unknown.push("The record does not say how the vote stood.");

    const obligations: string[] = [];
    if (enactment.upkeep != null) {
      const account = world.material.accounts.find((candidate) => candidate.id === enactment.upkeep!.fromAccountId);
      obligations.push(`Kept up from ${account === undefined ? "the treasury" : accountLabel(world, account, "clause")} (${enactment.upkeep.band} upkeep each month)`);
    }
    if (enactment.budget != null) {
      const account = world.material.accounts.find((candidate) => candidate.id === enactment.budget!.accountId);
      const from = account === undefined ? "the treasury" : accountLabel(world, account, "clause");
      obligations.push(enactment.budget.amount === null ? `A standing budget from ${from}` : `Up to ${money(enactment.budget.amount)} from ${from}`);
    }
    const work = enactment.projectId == null ? undefined : world.projects.find((project) => project.id === enactment.projectId);
    if (work !== undefined) {
      const cost = work.milestones.reduce((sum, milestone) => sum + milestone.costAmount, 0);
      if (cost > 0) obligations.push(`${work.label}: ${money(cost)} in all`);
    }

    const lawEntity = world.genericEntities.find((entity) => entity.kind === "law" && entity.attributes["procedureId"] === enactment.procedureId);
    let status = `Carried out ${date(enactment.enactedAtStep)}`;
    let marked = false;
    if (lawEntity?.lapsedAtStep != null) { status = `Lapsed for want of upkeep on ${date(lawEntity.lapsedAtStep)}`; marked = true; }
    else if (lawEntity !== undefined) status = `In force since ${date(enactment.enactedAtStep)}`;
    if (work !== undefined) {
      status = work.status === "completed" ? `The work was finished`
        : work.status === "in_progress" || work.status === "funded" ? `Work under way${work.targetCompletionStep === null ? "" : `, due ${date(work.targetCompletionStep)}`}`
          : work.status === "proposed" ? "The work has not begun"
            : `The work was given up (${work.status})`;
      marked = work.status === "proposed" || work.status === "failed" || work.status === "cancelled";
    }

    inForce.push({
      key: enactment.procedureId,
      name,
      sentence,
      marked,
      yours: seen.party,
      detail: {
        body: bodyName,
        sponsor: sponsorId === null ? null : person(sponsorId),
        dates: [
          ...(procedure === undefined ? [] : [`Put forward ${date(procedure.openedAtStep)}`]),
          ...(decided === null ? [] : [`Carried ${date(decided)}`]),
          `Carried out ${date(enactment.enactedAtStep)}`,
        ],
        obligations,
        status,
        vote,
        unknown,
      },
    });
  }
  inForce.sort((a, b) => Number(b.marked) - Number(a.marked) || (laterDay(b, world) - laterDay(a, world)));

  const before: LawRow[] = [];
  for (const procedure of world.material.politicalProcedures) {
    if (!OPEN_STAGES.has(procedure.stage)) continue;
    const seen = stands(procedure.id);
    const body = institution(procedure.institutionId);
    // Every open procedure counts, as `readTheState` counts them, but only those of this power.
    const ownPublic = procedure.visibility === "public" && body?.polityId === polityId;
    if (!seen.party && !seen.member && !ownPublic) continue;
    const enactment = world.enactments.find((candidate) => candidate.procedureId === procedure.id);
    const clauses = enactment === undefined ? [] : enactmentClauses(world, enactment, offices);
    const sentence = sentenceOf(clauses, "If it passes, it ")
      ?? (enactment === undefined
        ? `${upper(procedure.type.replace(/_/g, " "))} before ${body?.name ?? "the council"}; the record does not say what it would change.`
        : "If it passes, it sets nothing down that anyone must do.");
    let vote: string | null = null;
    if (seen.party || seen.member) {
      const positions = world.material.supportPositions.filter((position) => position.procedureId === procedure.id);
      const weigh = (choice: string) => positions.filter((position) => position.position === choice).reduce((sum, position) => sum + position.influenceWeight, 0);
      const forIt = weigh("support");
      const against = weigh("oppose");
      vote = forIt + against === 0 ? "Nobody has declared yet" : `For ${forIt}, against ${against}`;
    }
    const obligations: string[] = [];
    if (enactment?.budget != null) {
      obligations.push(enactment.budget.amount === null ? "A standing budget" : `Up to ${money(enactment.budget.amount)}`);
    }
    const work = enactment?.projectId == null ? undefined : world.projects.find((project) => project.id === enactment.projectId);
    if (work !== undefined) {
      const cost = work.milestones.reduce((sum, milestone) => sum + milestone.costAmount, 0);
      if (cost > 0) obligations.push(`${work.label}: ${money(cost)} in all`);
    }
    before.push({
      key: procedure.id,
      name: procedure.label,
      sentence,
      marked: seen.party && (procedure.eligibleParticipantIds.length === 0 || procedure.eligibleParticipantIds.includes(characterId)),
      yours: seen.party,
      detail: {
        body: body?.name ?? null,
        sponsor: person(procedure.sponsorCharacterId),
        dates: [
          `Put forward ${date(procedure.openedAtStep)}`,
          ...(procedure.deadlineStep === null ? [] : [procedure.deadlineStep >= today ? `To be decided by ${date(procedure.deadlineStep)}` : `Should have been decided by ${date(procedure.deadlineStep)}`]),
        ],
        obligations,
        status: STAGE_IN_WORDS[procedure.stage] ?? "Before the council",
        vote,
        unknown: vote === null ? ["How the votes stand is told only to those who sit in the body or are party to the question."] : [],
      },
    });
  }
  before.sort((a, b) => Number(b.yours) - Number(a.yours) || a.name.localeCompare(b.name));
  return { inForce, before };
}

function laterDay(row: LawRow, world: WorldState): number {
  const enactment = world.enactments.find((candidate) => candidate.procedureId === row.key);
  return enactment?.enactedAtStep ?? 0;
}

/** The standard levers' words, exported for the administration reading. */
export const LEVER_WORDS: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(LEVERS).map(([id, lever]) => [id, lever.words]));
