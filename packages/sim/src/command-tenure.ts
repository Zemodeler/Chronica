import {
  allOffices,
  boundedId,
  computeOpinion,
  isMagistracy,
  kmBetween,
  marchDaysFor,
  type CommandHold,
  type FactProposalDraft,
  type Force,
  type PoliticalProcedure,
  type WorldState,
} from "@chronica/shared";
import { chamberThatDecides } from "./apply/nobody-listens";
import { commandTenureOf } from "./constitutions";
import type { ElectionGovernment } from "./elections";
import type { IdFactory } from "./ports";

/**
 * What becomes of a commander's army when his year of office runs out
 * (`CommandTenure`, `world/command.ts`).
 *
 * At Rome a consul's command did not lapse on the calendar: he kept his army
 * until his successor reached it, unless the Senate extended his command for
 * another year -- prorogation, which it gave Regulus in Africa and refused
 * plenty of others. Out of command he could stay on as his successor's legate,
 * come home and ask for a triumph, or be prosecuted for what went wrong, now
 * that office no longer protected him. Before this the year's end changed
 * nothing about who led an army, and took away every other power without a
 * word -- a consul went from head of state to private citizen mid-campaign and
 * found out from the order list.
 *
 * Kingdoms and Carthage keep their generals as long as they please; Carthage
 * tries the ones who lose (`trials.ts`). Only powers whose commanders hold
 * their armies by the year are kept here.
 */

/** How long before a year ends the chamber is asked whether to extend a commander's command. */
export const PROROGATION_NOTICE_DAYS = 40;
/** How long a prorogation extends a command. */
export const PROROGATION_DAYS = 365;
/** How long a triumph waits on its vote, and a prosecution on its trial. */
const TRIUMPH_VOTE_DAYS = 20;
const TRIAL_DAYS = 30;
/** What a triumph does for a man's standing. */
const TRIUMPH_STANDING_BPS = 1_500;
/** The weight of misdeeds and defeats that makes a man worth prosecuting, and an exile's. */
const PROSECUTE_AT = 3;
const EXILE_AT = 8;
/** The longest a successor takes to reach his army: a sea away, a season. */
const MAX_JOURNEY_DAYS = 90;

export interface CommandTenureInput {
  readonly world: WorldState;
  readonly government: ElectionGovernment;
  readonly toDay: number;
  readonly ids: IdFactory;
  /** Terms that ran out this tick: who held them, which seat, on what day. */
  readonly endedTerms: readonly { readonly characterId: string; readonly officeId: string; readonly seatId: string; readonly endedAtStep: number }[];
  readonly playerCharacterId?: string | null | undefined;
}

const fitOf = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);

/** The armies a man leads for his own power, with men in them. */
export function armiesLedBy(world: WorldState, characterId: string, polityId: string | null): Force[] {
  return world.material.forces.filter((force) => force.polityId === polityId && force.outlaw !== true && fitOf(force) > 0
    && (force.commanderCharacterId === characterId || force.controllerCharacterId === characterId));
}

const atWar = (world: WorldState, polityId: string): boolean =>
  world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === "war" && (agreement.polityId === polityId || agreement.otherPolityId === polityId));

/** The id of the question whether a man's command is extended past the day his year ends. */
export const prorogationId = (characterId: string, endsAtStep: number): string => boundedId("prorogation", characterId, endsAtStep);
export const isProrogation = (procedure: PoliticalProcedure): boolean => procedure.type === "command_assignment" && procedure.id.startsWith("prorogation");
export const isTriumphVote = (procedure: PoliticalProcedure): boolean => procedure.id.startsWith("triumph");

/** Days for a man to reach an army: on foot by road where there is one, else a season at most. */
function journeyDays(world: WorldState, fromProvinceId: string | null, toProvinceId: string): number {
  if (fromProvinceId === null || fromProvinceId === toProvinceId) return 1;
  const km = kmBetween(world, fromProvinceId, toProvinceId);
  return km === null ? 30 : Math.max(2, Math.min(MAX_JOURNEY_DAYS, Math.ceil(marchDaysFor(km))));
}

/**
 * What a commander did with his command since it began: battles won and lost
 * where his armies fought, and towns taken. The Senate weighs it for
 * prorogation and a triumph.
 */
export function recordOfCommand(world: WorldState, forceIds: ReadonlySet<string>, sinceStep: number): { readonly won: number; readonly lost: number; readonly taken: number; readonly what: readonly string[] } {
  const province = (id: string): string => world.map.provinces.find((candidate) => candidate.id === id)?.name ?? id;
  let won = 0;
  let lost = 0;
  const what: string[] = [];
  for (const engagement of world.engagements) {
    if (engagement.status !== "ended" || engagement.winner === null || (engagement.endedAtStep ?? 0) < sinceStep || engagement.pitchedRounds === 0) continue;
    const onAttack = engagement.attackerForceIds.some((id) => forceIds.has(id)) || (engagement.seenForceIds.some((id) => forceIds.has(id)) && engagement.openedByForceId !== undefined && forceIds.has(engagement.openedByForceId));
    const onDefence = engagement.defenderForceIds.some((id) => forceIds.has(id));
    if (!onAttack && !onDefence) continue;
    const side = onAttack ? "attacker" : "defender";
    if (engagement.winner === side) {
      won += 1;
      what.push(`the victory in ${province(engagement.provinceId)}`);
    } else lost += 1;
  }
  let taken = 0;
  for (const siege of world.sieges) {
    if (siege.status !== "taken" || !forceIds.has(siege.forceId) || (siege.endedAtStep ?? 0) < sinceStep) continue;
    taken += 1;
    const town = world.map.provinces.flatMap((candidate) => candidate.settlements).find((settlement) => settlement.id === siege.settlementId)?.name;
    if (town !== undefined) what.push(`the taking of ${town}`);
  }
  return { won, lost, taken, what };
}

/**
 * How a chamber leans on keeping a man in command, or on his triumph, beyond
 * what its blocs want: what he did with the command, his name, and whether the
 * war he is in is still to be won.
 */
export function tenureLean(world: WorldState, procedure: PoliticalProcedure): { readonly lean: number; readonly reasons: readonly string[] } {
  if (!isProrogation(procedure) && !isTriumphVote(procedure)) return { lean: 0, reasons: [] };
  const man = world.characters.find((character) => character.id === procedure.subjectId);
  if (man === undefined) return { lean: 0, reasons: [] };
  const forces = new Set(armiesLedBy(world, man.id, man.polityId).map((force) => force.id));
  for (const hold of world.commandHolds) if (hold.characterId === man.id) for (const id of hold.forceIds) forces.add(id);
  const record = recordOfCommand(world, forces, procedure.openedAtStep - 365);
  const reasons: string[] = [];
  let lean = 0;
  const deeds = record.won * 6 + record.taken * 5 - record.lost * 8;
  if (deeds !== 0) {
    lean += deeds;
    reasons.push(`he has ${record.won + record.taken > 0 ? `won ${record.won} battle(s) and taken ${record.taken} town(s)` : ""}${record.lost > 0 ? `${record.won + record.taken > 0 ? " and " : ""}lost ${record.lost}` : ""} (${deeds > 0 ? "+" : ""}${deeds})`);
  }
  const name = Math.round((man.prestigeBps - 5_000) / 500);
  if (name !== 0) {
    lean += name;
    reasons.push(`his name stands ${name > 0 ? "high" : "low"} (${name > 0 ? "+" : ""}${name})`);
  }
  if (isProrogation(procedure) && man.polityId !== null) {
    const war = atWar(world, man.polityId) ? 6 : -10;
    lean += war;
    reasons.push(war > 0 ? "the war is not yet won, and a new man would have to learn it (+6)" : "there is no war to keep him for (-10)");
  }
  if (isTriumphVote(procedure) && record.won + record.taken === 0) {
    lean -= 20;
    reasons.push("he won no victory worth a triumph (-20)");
  }
  return { lean: Math.max(-25, Math.min(25, lean)), reasons };
}

function procedureOf(input: {
  readonly id: string; readonly type: PoliticalProcedure["type"]; readonly institutionId: string; readonly sponsorId: string; readonly subjectId: string;
  readonly label: string; readonly openedAt: number; readonly deadline: number; readonly concerns: NonNullable<PoliticalProcedure["concerns"]>;
  readonly sentence?: PoliticalProcedure["sentence"];
}): PoliticalProcedure {
  return {
    id: input.id, type: input.type, institutionId: input.institutionId, sponsorCharacterId: input.sponsorId,
    subjectKind: "character", subjectId: input.subjectId, label: input.label.slice(0, 200),
    eligibilityRequirementIds: [], eligibleParticipantIds: [], stage: "gathering_support", resolutionMechanism: "vote",
    openedAtStep: input.openedAt, deadlineStep: input.deadline, resolvedAtStep: null, visibility: "public",
    voteRecordId: null, outcome: null, outcomeReason: null, sourceEventIds: [], resultingEventIds: [],
    concerns: [...input.concerns], ...(input.sentence === undefined ? {} : { sentence: input.sentence }),
  } as PoliticalProcedure;
}

export function keepCommandTenure(input: CommandTenureInput): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const day = input.toDay;
  const offices = allOffices(world, input.government.offices);
  const officeOf = (id: string) => offices.find((office) => office.id === id);
  const name = (id: string | null): string => world.characters.find((character) => character.id === id)?.name ?? "somebody";
  const province = (id: string | null): string => world.map.provinces.find((candidate) => candidate.id === id)?.name ?? "the field";
  const forceNames = (forces: readonly Force[]): string => forces.map((force) => force.name).join(" and ");
  const byYear = (polityId: string): boolean => {
    const tenure = commandTenureOf(world, polityId);
    return tenure === "annual_prorogable" || tenure === "annual_no_iteration";
  };
  let serial = 0;
  const localId = (kind: string): string => `tenure_${kind}_${(serial += 1)}`;
  const tell = (fact: Omit<FactProposalDraft, "localId"> & { readonly kind: string }): void => {
    facts.push({ localId: localId(fact.kind), ...fact } as FactProposalDraft);
  };
  const addProcedure = (procedure: PoliticalProcedure): void => {
    world = { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] } };
  };
  const addHold = (hold: Omit<CommandHold, "id" | "status" | "endedAtStep" | "endedHow">): CommandHold => {
    const made: CommandHold = { ...hold, id: input.ids.next("command"), status: "active", endedAtStep: null, endedHow: null };
    world = { ...world, commandHolds: [...world.commandHolds, made].slice(-200) };
    return made;
  };
  const endHold = (id: string, how: string): void => {
    world = { ...world, commandHolds: world.commandHolds.map((hold) => (hold.id === id ? { ...hold, status: "ended" as const, endedAtStep: day, endedHow: how.slice(0, 240) } : hold)) };
  };
  const reviseHold = (id: string, change: Partial<CommandHold>): void => {
    world = { ...world, commandHolds: world.commandHolds.map((hold) => (hold.id === id ? { ...hold, ...change } : hold)) };
  };
  const holdOf = (characterId: string, basis?: CommandHold["basis"]) =>
    world.commandHolds.find((hold) => hold.status === "active" && hold.characterId === characterId && (basis === undefined || hold.basis === basis));
  const knownTo = (...ids: readonly (string | null)[]) => ids.filter((id): id is string => id !== null).map((id) => ({ kind: "character" as const, id }));

  // ── A. The question asked before the year runs out ─────────────────────────
  for (const seat of world.material.officeSeats) {
    if (seat.status !== "held" || seat.holderCharacterId === null || seat.termExpiresAtStep === null) continue;
    const left = seat.termExpiresAtStep - day;
    if (left <= 0 || left > PROROGATION_NOTICE_DAYS) continue;
    const office = officeOf(seat.officeId);
    if (office === undefined || !isMagistracy(office) || commandTenureOf(world, office.polityId) !== "annual_prorogable") continue;
    const commander = world.characters.find((character) => character.id === seat.holderCharacterId && character.alive);
    if (commander === undefined) continue;
    const armies = armiesLedBy(world, commander.id, office.polityId);
    if (armies.length === 0 || !atWar(world, office.polityId)) continue;
    const id = prorogationId(commander.id, seat.termExpiresAtStep);
    if (world.material.politicalProcedures.some((procedure) => procedure.id === id)) continue;
    const chamber = chamberThatDecides(world, office.polityId, "war");
    if (chamber === undefined) continue;
    const voteDay = Math.max(day + 3, seat.termExpiresAtStep - 5);
    addProcedure(procedureOf({
      id, type: "command_assignment", institutionId: chamber.id, sponsorId: commander.id, subjectId: commander.id,
      label: `Prorogation: ${commander.name} to keep his command of ${forceNames(armies)} for another year`,
      openedAt: day, deadline: voteDay, concerns: ["war"],
    }));
    tell({
      kind: "prorogation_debated",
      summary: `${commander.name}'s year as ${office.label} ends in ${left} days. The ${chamber.name} will decide in ${voteDay - day} days whether he keeps ${forceNames(armies)} for another year as pro-magistrate, or hands it to his successor when he arrives [${id}].`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: commander.id }, { kind: "procedure", id }, { kind: "polity", id: office.polityId }, ...armies.slice(0, 3).map((force) => ({ kind: "force" as const, id: force.id }))],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: commander.id === input.playerCharacterId ? 70 : 40,
    });
  }

  // ── B. The year ends ───────────────────────────────────────────────────────
  for (const ended of input.endedTerms) {
    const office = officeOf(ended.officeId);
    const man = world.characters.find((character) => character.id === ended.characterId && character.alive);
    if (office === undefined || man === undefined || !isMagistracy(office) || !byYear(office.polityId)) continue;
    const armies = armiesLedBy(world, man.id, office.polityId);
    if (armies.length === 0 || holdOf(man.id) !== undefined) {
      if (armies.length === 0) answerFor(man.id, office.polityId, ended.endedAtStep - 365);
      continue;
    }
    const vote = world.material.politicalProcedures.find((procedure) => procedure.id === prorogationId(man.id, ended.endedAtStep));
    if (vote?.outcome === "passed" && commandTenureOf(world, office.polityId) === "annual_prorogable") {
      addHold({ polityId: office.polityId, characterId: man.id, forceIds: armies.map((force) => force.id).slice(0, 8), officeId: office.id, basis: "prorogued",
        successorCharacterId: null, superiorCharacterId: null, procedureId: vote.id, atProvinceId: null, sinceStep: day, untilStep: day + PROROGATION_DAYS });
      tell({
        kind: "command_prorogued",
        summary: `${man.name}'s year as ${office.label} is over, but his command is not: by the vote of the chamber he holds ${forceNames(armies)} for another year as pro-magistrate.`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: man.id }, { kind: "polity", id: office.polityId }, ...armies.slice(0, 3).map((force) => ({ kind: "force" as const, id: force.id }))],
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: man.id === input.playerCharacterId ? 70 : 40,
      });
      continue;
    }
    // His successor: the man who took his seat today, else any new holder of the office.
    const successor = successorFor(man.id, office.id);
    const journey = successor === null ? null : journeyDays(world, world.characters.find((character) => character.id === successor)?.locationProvinceId ?? null, armies[0]!.locationId);
    addHold({ polityId: office.polityId, characterId: man.id, forceIds: armies.map((force) => force.id).slice(0, 8), officeId: office.id, basis: "awaiting_successor",
      successorCharacterId: successor, superiorCharacterId: null, procedureId: null, atProvinceId: null, sinceStep: day, untilStep: journey === null ? null : day + journey });
    tell({
      kind: "command_awaits_successor",
      summary: (successor === null
        ? `${man.name}'s year as ${office.label} is over, and nobody has yet been chosen to follow him: he keeps ${forceNames(armies)} until somebody is.`
        : `${man.name}'s year as ${office.label} is over${vote?.outcome === "failed" ? ", and the chamber would not extend his command" : ""}. He keeps ${forceNames(armies)} until ${name(successor)} reaches it, in about ${journey} days, and hands it over then.`).slice(0, 600),
      affectedRefs: [{ kind: "character", id: man.id }, ...knownTo(successor), { kind: "polity", id: office.polityId }, ...armies.slice(0, 3).map((force) => ({ kind: "force" as const, id: force.id }))],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: man.id === input.playerCharacterId ? 70 : 35,
    });
  }

  // ── C. Holds kept, run out, handed over ────────────────────────────────────
  for (const hold of world.commandHolds.filter((candidate) => candidate.status === "active")) {
    const man = world.characters.find((character) => character.id === hold.characterId && character.alive);
    if (man === undefined) {
      endHold(hold.id, "He died.");
      continue;
    }
    const armies = world.material.forces.filter((force) => hold.forceIds.includes(force.id) && fitOf(force) > 0);
    if (hold.basis === "triumph") {
      const vote = world.material.politicalProcedures.find((procedure) => procedure.id === hold.procedureId);
      if (vote === undefined || vote.outcome === null) continue;
      if (vote.outcome === "passed") {
        world = { ...world, characters: world.characters.map((character) => (character.id === man.id ? { ...character, prestigeBps: Math.min(10_000, character.prestigeBps + TRIUMPH_STANDING_BPS) } : character)) };
        tell({
          kind: "triumph",
          summary: `${man.name} entered the city in triumph, his soldiers singing behind him, and laid down his command at the Capitol.`,
          affectedRefs: [{ kind: "character", id: man.id }, { kind: "polity", id: hold.polityId }],
          visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 70,
        });
        endHold(hold.id, "He triumphed.");
      } else {
        tell({
          kind: "triumph_refused",
          summary: `The chamber refused ${man.name} a triumph. He came into the city a private man, like any other.`,
          affectedRefs: [{ kind: "character", id: man.id }, { kind: "polity", id: hold.polityId }],
          visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 45,
        });
        endHold(hold.id, "His triumph was refused.");
      }
      continue;
    }
    if (hold.basis === "legate") {
      const army = armies[0];
      const underHim = army !== undefined && (army.commanderCharacterId === hold.superiorCharacterId || army.controllerCharacterId === hold.superiorCharacterId);
      const leftIt = hold.atProvinceId !== null && man.locationProvinceId !== hold.atProvinceId;
      if (army === undefined || !underHim || leftIt) {
        endHold(hold.id, leftIt ? "He left the army." : "The army he served is gone, or no longer his general's.");
        world = { ...world, authorityGrants: world.authorityGrants.map((grant) => (grant.sourceRef === hold.id && grant.revokedAtStep === null ? { ...grant, revokedAtStep: day, revocationReason: "His legateship ended." } : grant)) };
        continue;
      }
      // He goes where the army goes.
      if (man.locationProvinceId !== army.locationId) {
        world = { ...world, characters: world.characters.map((character) => (character.id === man.id ? { ...character, locationProvinceId: army.locationId } : character)) };
      }
      reviseHold(hold.id, { atProvinceId: army.locationId });
      continue;
    }
    if (armies.length === 0) {
      endHold(hold.id, "The army he held is gone.");
      answerFor(man.id, hold.polityId, hold.sinceStep - 365);
      continue;
    }
    if (hold.basis === "prorogued") {
      if (hold.untilStep === null || hold.untilStep > day) continue;
      // The year of his prorogation is out: his command goes to a magistrate in office, when one comes.
      const successor = hold.officeId === null ? null : successorFor(man.id, hold.officeId);
      endHold(hold.id, "His prorogation ran out.");
      const journey = successor === null ? null : journeyDays(world, world.characters.find((character) => character.id === successor)?.locationProvinceId ?? null, armies[0]!.locationId);
      addHold({ polityId: hold.polityId, characterId: man.id, forceIds: hold.forceIds, officeId: hold.officeId, basis: "awaiting_successor",
        successorCharacterId: successor, superiorCharacterId: null, procedureId: null, atProvinceId: null, sinceStep: hold.sinceStep, untilStep: journey === null ? null : day + journey });
      tell({
        kind: "command_awaits_successor",
        summary: `${man.name}'s prorogued command has run its year. ${successor === null ? "He keeps the army until a successor is sent." : `${name(successor)} is coming to take it over, in about ${journey} days.`}`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: man.id }, ...knownTo(successor), { kind: "polity", id: hold.polityId }],
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 40,
      });
      continue;
    }
    // Awaiting a successor.
    if (hold.successorCharacterId === null) {
      const successor = hold.officeId === null ? null : successorFor(man.id, hold.officeId);
      if (successor === null) continue;
      const journey = journeyDays(world, world.characters.find((character) => character.id === successor)?.locationProvinceId ?? null, armies[0]!.locationId);
      reviseHold(hold.id, { successorCharacterId: successor, untilStep: day + journey });
      tell({
        kind: "successor_named",
        summary: `${name(successor)} is to take over ${forceNames(armies)} from ${man.name}, and sets out to reach it: about ${journey} days.`.slice(0, 600),
        affectedRefs: [{ kind: "character", id: man.id }, { kind: "character", id: successor }, { kind: "polity", id: hold.polityId }],
        visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 35,
      });
      continue;
    }
    if (hold.untilStep === null || hold.untilStep > day) continue;
    const successorId = hold.successorCharacterId;
    const successor = world.characters.find((character) => character.id === successorId && character.alive);
    const stillInOffice = successor !== undefined && world.material.officeSeats.some((seat) => seat.holderCharacterId === successor.id && seat.status === "held" && seat.officeId === hold.officeId);
    if (successor === undefined || !stillInOffice) {
      reviseHold(hold.id, { successorCharacterId: null, untilStep: null });
      continue;
    }
    handOver(hold, man.id, successor.id, armies);
  }

  return { world, facts };

  /** The man who takes over from him: whoever now holds his office and has no army of his own, nearest first. */
  function successorFor(outgoingId: string, officeId: string): string | null {
    const holders = world.material.officeSeats
      .filter((seat) => seat.officeId === officeId && seat.status === "held" && seat.holderCharacterId !== null && seat.holderCharacterId !== outgoingId)
      .map((seat) => world.characters.find((character) => character.id === seat.holderCharacterId))
      .filter((character): character is NonNullable<typeof character> => character !== undefined && character.alive);
    // One already coming to another army is spoken for.
    const spoken = new Set(world.commandHolds.filter((hold) => hold.status === "active" && hold.basis === "awaiting_successor" && hold.characterId !== outgoingId).map((hold) => hold.successorCharacterId));
    const free = holders.filter((character) => !spoken.has(character.id) && armiesLedBy(world, character.id, character.polityId).length === 0);
    return (free[0] ?? holders.find((character) => !spoken.has(character.id)) ?? null)?.id ?? null;
  }

  /** The army passes to the man who came for it; the man who had it stays on as his legate, or goes home. */
  function handOver(hold: CommandHold, outgoingId: string, successorId: string, armies: readonly Force[]): void {
    const where = armies[0]!.locationId;
    const ids = new Set(armies.map((force) => force.id));
    world = {
      ...world,
      material: {
        ...world.material,
        forces: world.material.forces.map((force) => (!ids.has(force.id) ? force : {
          ...force,
          commanderCharacterId: force.commanderCharacterId === outgoingId ? successorId : force.commanderCharacterId,
          controllerCharacterId: force.controllerCharacterId === outgoingId ? successorId : force.controllerCharacterId,
        })),
      },
      characters: world.characters.map((character) => (character.id === successorId ? { ...character, locationProvinceId: where } : character)),
    };
    endHold(hold.id, `Handed over to ${name(successorId)}.`);
    const isPlayer = outgoingId === input.playerCharacterId;
    // The player stays on under his successor, as a legate: in the field, with
    // a voice and a share of the command, until he chooses to leave it.
    if (isPlayer) {
      const legate = addHold({ polityId: hold.polityId, characterId: outgoingId, forceIds: [...ids].slice(0, 8), officeId: null, basis: "legate",
        successorCharacterId: null, superiorCharacterId: successorId, procedureId: null, atProvinceId: where, sinceStep: day, untilStep: null });
      world = {
        ...world,
        authorityGrants: [...world.authorityGrants, {
          id: input.ids.next("grant"), holder: { kind: "character", id: outgoingId }, source: "delegation", sourceRef: legate.id,
          domain: "military", scope: { kind: "force", id: armies[0]!.id }, powers: ["command"], standing: "delegated", legitimacyBps: 10_000,
          visibility: "public", grantedAtStep: day, expiresAtStep: null, revokedAtStep: null, revocationReason: null, succeedsGrantId: null,
        }],
      };
    }
    tell({
      kind: "command_handed_over",
      summary: `${name(successorId)} reached ${forceNames(armies)} in ${province(where)} and took over its command from ${name(outgoingId)}${isPlayer ? `, who stays with the army as his legate -- he may give its men orders while ${name(successorId)} lets him, or leave it and go home` : ", who goes home"}.`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: successorId }, { kind: "character", id: outgoingId }, { kind: "polity", id: hold.polityId }, ...armies.slice(0, 3).map((force) => ({ kind: "force" as const, id: force.id }))],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: isPlayer ? 70 : 40,
    });
    // Home from a victory, he may ask for a triumph.
    const record = recordOfCommand(world, ids, hold.sinceStep - 365);
    if (record.won + record.taken > 0) askForTriumph(outgoingId, hold.polityId, record.what, [...ids]);
    answerFor(outgoingId, hold.polityId, hold.sinceStep - 365);
  }

  function askForTriumph(characterId: string, polityId: string, deeds: readonly string[], forceIds: readonly string[]): void {
    if (forceIds.length === 0) return;
    const chamber = chamberThatDecides(world, polityId, "war");
    if (chamber === undefined) return;
    const id = boundedId("triumph", characterId, day);
    if (world.material.politicalProcedures.some((procedure) => procedure.id === id)) return;
    const what = deeds.slice(0, 3).join(", ") || "his victories";
    addProcedure(procedureOf({ id, type: "council_deliberation", institutionId: chamber.id, sponsorId: characterId, subjectId: characterId,
      label: `A triumph for ${name(characterId)}, for ${what}`, openedAt: day, deadline: day + TRIUMPH_VOTE_DAYS, concerns: ["war"] }));
    addHold({ polityId, characterId, forceIds: [...forceIds].slice(0, 8),
      officeId: null, basis: "triumph", successorCharacterId: null, superiorCharacterId: null, procedureId: id, atProvinceId: null, sinceStep: day, untilStep: day + TRIUMPH_VOTE_DAYS });
    tell({
      kind: "triumph_asked",
      summary: `${name(characterId)} waits outside the city and asks the ${chamber.name} for a triumph, for ${what}. Entering it before the vote, he would lay down his command and lose the chance [${id}].`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: characterId }, { kind: "procedure", id }, { kind: "polity", id: polityId }],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 55,
    });
  }

  /**
   * Out of office, a man answers for what his office covered: defeats, and
   * acts beyond his powers. Whoever likes him least, and can bring it, brings
   * a charge before the chamber that judges; the rest is forgiven by time.
   */
  function answerFor(characterId: string, polityId: string, sinceStep: number): void {
    const charges = world.answerable.filter((entry) => entry.characterId === characterId && entry.atStep >= sinceStep);
    world = { ...world, answerable: world.answerable.filter((entry) => entry.characterId !== characterId) };
    const brought = prosecutionOf(world, characterId, polityId, charges, day, input.playerCharacterId ?? null, "No longer protected by his office, ");
    if (brought === null) return;
    addProcedure(brought.procedure);
    tell(brought.fact);
  }
}

/**
 * A prosecution for what a man has to answer for, or null: the weight of it
 * is past `prosecuteAt` (the difficulty's, `PROSECUTE_AT` by default), the
 * chamber that judges exists, and somebody of his power who thinks ill of him
 * will bring it. Shared by a magistrate leaving office (`answerFor`) and a
 * private man weighed each month (`personal-pushback.ts`, play-test L11).
 */
export function prosecutionOf(
  world: WorldState,
  characterId: string,
  polityId: string,
  charges: readonly { readonly label: string; readonly weight: number }[],
  day: number,
  playerCharacterId: string | null,
  lead: string,
  prosecuteAt: number = PROSECUTE_AT,
): { readonly procedure: PoliticalProcedure; readonly fact: Omit<FactProposalDraft, "localId"> & { readonly kind: string } } | null {
  const weight = charges.reduce((sum, entry) => sum + entry.weight, 0);
  if (weight < prosecuteAt) return null;
  const court = chamberThatDecides(world, polityId, "judgment");
  const accused = world.characters.find((character) => character.id === characterId);
  if (court === undefined || accused === undefined) return null;
  const prosecutor = world.characters
    .filter((character) => character.alive && character.id !== characterId && character.polityId === polityId && computeOpinion(character, characterId) <= -10)
    .sort((a, b) => computeOpinion(a, characterId) - computeOpinion(b, characterId) || b.prestigeBps - a.prestigeBps || a.id.localeCompare(b.id))[0];
  if (prosecutor === undefined) return null;
  const id = boundedId("prosecution", characterId, day);
  if (world.material.politicalProcedures.some((procedure) => procedure.id === id)) return null;
  const counts = charges.slice(0, 3).map((entry) => entry.label).join("; ");
  const sentence = weight >= EXILE_AT ? "exile" : "fine";
  return {
    procedure: procedureOf({ id, type: "denunciation", institutionId: court.id, sponsorId: prosecutor.id, subjectId: characterId,
      label: `${prosecutor.name} prosecutes ${accused.name}: ${counts}`, openedAt: day, deadline: day + TRIAL_DAYS, concerns: ["punishment"], sentence }),
    fact: {
      kind: "prosecution_brought",
      summary: `${lead}${accused.name} is prosecuted by ${prosecutor.name} before the ${court.name}: ${counts}. ${sentence === "exile" ? "It is exile they will vote on." : "It is a fine they will vote on."} The vote is in ${TRIAL_DAYS} days [${id}].`.slice(0, 600),
      affectedRefs: [{ kind: "character", id: characterId }, { kind: "character", id: prosecutor.id }, { kind: "procedure", id }, { kind: "polity", id: polityId }],
      visibility: "public", discoveryState: "public", knowableInDays: 0, significance: characterId === playerCharacterId ? 75 : 45,
    },
  };
}
