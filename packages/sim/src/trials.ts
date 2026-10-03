import {
  computeOpinion,
  deriveReputation,
  leaning,
  readDepartments,
  shiftStanding,
  skillShare,
  vacateOfficesOf,
  boundedId,
  type Character,
  type BattleResult,
  type FactProposalDraft,
  type Force,
  type PoliticalProcedure,
  type WorldState,
} from "@chronica/shared";
import { killCharacter } from "./mortality";
import { hisMasters, kinOf, remember, teach, type Grievance } from "./grievances";

/**
 * Trials (docs/plans/departments.md §6, §9).
 *
 * A power whose constitution has a court over its generals -- Carthage's
 * Hundred and Four -- puts a commander who lost on trial when he comes home,
 * and a routed army is a capital matter. And any man convicted by a vote of
 * judgment pays back what an audit proved he took, and pays for it besides.
 */

/** How long the court takes to sit. */
const TRIAL_IN_DAYS = 30;
/** A fine is a fifth of what he has. */
const FINE_SHARE = 0.2;

/**
 * After a battle: each commander of the losing side whose power judges its
 * generals is summoned. The sentence asked is death for a force that was
 * destroyed or routed, a fine for one that was merely beaten.
 */
export function summonToJudgment(world: WorldState, result: BattleResult, losers: readonly Force[], provinceName: string): { world: WorldState; facts: FactProposalDraft[] } {
  if (result.outcome === "inconclusive") return { world, facts: [] };
  const reader = readDepartments(world);
  const facts: FactProposalDraft[] = [];
  // Before any court sits, the men he serves have already made up their minds.
  let next = judgedByTheirOwn(world, result, losers, provinceName);
  // Every beaten commander has it to answer for, whatever his power's courts:
  // a magistrate when his office no longer covers him (`command-tenure.ts`).
  next = {
    ...next,
    answerable: [...next.answerable, ...losers.flatMap((force) => {
      const after = next.material.forces.find((candidate) => candidate.id === force.id);
      const before = force.personnel.reduce((sum, category) => sum + category.fit, 0);
      const left = after === undefined ? 0 : after.personnel.reduce((sum, category) => sum + category.fit, 0);
      const destroyed = after === undefined || left < before * 0.5;
      return force.commanderCharacterId === null ? [] : [{
        characterId: force.commanderCharacterId, polityId: force.polityId, kind: "defeat" as const,
        label: `${destroyed ? "lost" : "was beaten with"} ${force.name} at ${provinceName}`.slice(0, 240), atStep: next.elapsedStep, weight: destroyed ? 5 : 2,
      }];
    })].slice(-400),
  };
  for (const force of losers) {
    const court = next.departments.find((department) => department.abolishedAtStep === null && department.scope.kind === "polity" && department.scope.id === force.polityId
      && department.gates.some((gate) => gate.act === "judge_commander"));
    const courtId = court?.gates.find((gate) => gate.act === "judge_commander")?.institutionId;
    if (court === undefined || courtId === undefined) continue;
    const commander = next.characters.find((character) => character.id === force.commanderCharacterId && character.alive);
    if (commander === undefined) continue;
    const id = boundedId("trial", result.battleId, commander.id);
    if (next.material.politicalProcedures.some((procedure) => procedure.id === id)) continue;
    const after = next.material.forces.find((candidate) => candidate.id === force.id);
    const before = force.personnel.reduce((sum, category) => sum + category.fit, 0);
    const left = after === undefined ? 0 : after.personnel.reduce((sum, category) => sum + category.fit, 0);
    const routed = after === undefined || left < before * 0.5;
    const sponsor = reader.rulers(force.polityId)[0] ?? commander;
    const procedure: PoliticalProcedure = {
      id,
      type: "denunciation",
      institutionId: courtId,
      sponsorCharacterId: sponsor.id,
      subjectKind: "character",
      subjectId: commander.id,
      label: `The trial of ${commander.name} for the defeat at ${provinceName}`.slice(0, 200),
      eligibilityRequirementIds: [],
      eligibleParticipantIds: [],
      stage: "gathering_support",
      resolutionMechanism: "vote",
      openedAtStep: next.elapsedStep,
      deadlineStep: next.elapsedStep + TRIAL_IN_DAYS,
      resolvedAtStep: null,
      visibility: "public",
      voteRecordId: null,
      outcome: null,
      outcomeReason: null,
      sourceEventIds: [],
      resultingEventIds: [],
      concerns: ["punishment"],
      sentence: routed ? "death" : "fine",
    };
    next = { ...next, material: { ...next.material, politicalProcedures: [...next.material.politicalProcedures, procedure] } };
    facts.push({
      localId: `trial_${commander.id}`.slice(0, 60),
      kind: "trial_called",
      summary: `${commander.name} is summoned before ${court.name} to answer for the defeat at ${provinceName}${routed ? ", and it is his life they will vote on" : ""}.`.slice(0, 400),
      affectedRefs: [{ kind: "character", id: commander.id }, { kind: "polity", id: force.polityId }],
      visibility: "public",
      discoveryState: "public",
      knowableInDays: 0,
      significance: routed ? 70 : 50,
    });
  }
  return { world: next, facts };
}

/**
 * What the men a commander serves think of him after a battle: a winner is
 * respected and spoken well of, a loser less so, a man who lost his army
 * least of all. He himself learns what winning or losing teaches.
 */
function judgedByTheirOwn(world: WorldState, result: BattleResult, losers: readonly Force[], provinceName: string): WorldState {
  const lost = new Set(losers.map((force) => force.id));
  const fought = new Set(result.participantIds ?? []);
  const winners = world.material.forces.filter((force) => fought.has(force.id) && !lost.has(force.id));
  let next = world;
  const verdicts: Grievance[] = [];
  for (const force of winners) {
    for (const master of hisMasters(next, force.polityId)) {
      verdicts.push({ subjectCharacterId: master, targetCharacterId: force.commanderCharacterId, label: `He won at ${provinceName}.`, score: 8, dimensions: { respect: 15, trust: 5, reputation: 8 } });
    }
    next = teach(next, force.commanderCharacterId, "victory", next.elapsedStep);
  }
  for (const force of losers) {
    const survived = next.material.forces.some((candidate) => candidate.id === force.id);
    for (const master of hisMasters(next, force.polityId)) {
      verdicts.push({
        subjectCharacterId: master, targetCharacterId: force.commanderCharacterId,
        label: survived ? `He was beaten at ${provinceName}.` : `He lost his army at ${provinceName}.`,
        score: survived ? -6 : -12, dimensions: survived ? { respect: -12, reputation: -6 } : { respect: -25, trust: -10, reputation: -12 },
      });
    }
    next = teach(next, force.commanderCharacterId, "defeat", next.elapsedStep);
  }
  return remember(next, verdicts, next.elapsedStep, `${result.battleId}:field`);
}

/**
 * How the court leans on a man's trial, beyond what its members want (§6).
 *
 * Whoever holds the courts decides how fair it is. A court run well follows
 * the evidence -- what an audit proved he took, or the defeat he answers
 * for -- and acquits where there is none; a court run badly follows its
 * judge's feelings about the accused and the judge's own cruelty. And a man
 * well spoken of is harder to condemn than one nobody has a good word for.
 */
export function judgmentLean(world: WorldState, procedure: PoliticalProcedure, polityId: string): { readonly lean: number; readonly reasons: readonly string[] } {
  if (procedure.type !== "denunciation" || procedure.subjectKind !== "character" || procedure.subjectId === null) return { lean: 0, reasons: [] };
  const accused = world.characters.find((character) => character.id === procedure.subjectId);
  if (accused === undefined) return { lean: 0, reasons: [] };
  const reader = readDepartments(world);
  const scope = { kind: "polity" as const, id: polityId };
  const courts = reader.holding(scope, "courts");
  const judge = courts.head ?? courts.people[0];
  const fairness = skillShare(reader.skill(scope, "courts"), 1);
  const proven = procedure.sentence !== undefined && procedure.sentence !== null
    ? true
    : world.diversions.some((row) => row.byCharacterId === accused.id && row.foundAtStep !== null);
  const reasons: string[] = [];
  let lean = 0;
  // Fair courts follow the evidence; the fairer, the harder.
  const evidence = Math.round((proven ? 10 : -10) * Math.max(0, fairness));
  if (evidence !== 0) {
    lean += evidence;
    reasons.push(`the court weighs the evidence ${proven ? "against him" : "and finds little"} (${evidence > 0 ? "+" : ""}${evidence})`);
  }
  // An unfair one follows its judge.
  if (judge !== undefined && judge.id !== accused.id) {
    const swayed = 1 - Math.max(0, fairness);
    const feeling = Math.round((-computeOpinion(judge, accused.id) * 0.2 + leaning(judge, "cruelty") * 0.5) * swayed);
    if (feeling !== 0) {
      lean += feeling;
      reasons.push(`${judge.name}, who presides, is ${feeling > 0 ? "against" : "for"} him (${feeling > 0 ? "+" : ""}${feeling})`);
    }
  }
  const name = Math.round(-deriveReputation(world, accused.id) / 5);
  if (name !== 0) {
    lean += name;
    reasons.push(`he is ${name < 0 ? "well" : "ill"} spoken of (${name > 0 ? "+" : ""}${name})`);
  }
  return { lean: Math.max(-25, Math.min(25, lean)), reasons };
}

/** What a conviction costs a man's standing: a fine, and exile. */
const FINE_STANDING_BPS = -800;
const EXILE_STANDING_BPS = -1_500;

/**
 * A man convicted. He pays back what an audit found he took, to whoever it
 * was taken from, as far as his purse goes; and then his sentence. Acquitted,
 * he remembers who brought the charge.
 */
export function sentenceByOutcome(world: WorldState, procedure: PoliticalProcedure, atStep: number): WorldState {
  if (procedure.type !== "denunciation" || procedure.subjectKind !== "character" || procedure.subjectId === null) return world;
  if (procedure.outcome === "failed") return acquitted(world, procedure, atStep);
  if (procedure.outcome !== "passed") return world;
  const convicted = world.characters.find((character) => character.id === procedure.subjectId && character.alive);
  if (convicted === undefined) return world;
  let next = condemnedBy(world, procedure, convicted, atStep);
  const move = (from: string, to: string | null, amount: number): number => {
    const purse = next.material.accounts.find((account) => account.id === from);
    const paid = Math.min(amount, Math.max(0, purse?.balance ?? 0));
    if (paid <= 0 || to === null || to === from) return 0;
    next = {
      ...next,
      material: {
        ...next.material,
        accounts: next.material.accounts.map((account) => (account.id === from ? { ...account, balance: account.balance - paid } : account.id === to ? { ...account, balance: account.balance + paid } : account)),
        transactions: [...next.material.transactions, {
          id: boundedId("txn", "judgment", procedure.id, to), atStep, kind: "confiscation" as const, amount: paid, sourceAccountId: from, destinationAccountId: to,
          cause: { kind: "action" as const, id: procedure.id, explanation: procedure.label.slice(0, 200) }, visibility: "public" as const,
        }],
      },
    };
    return paid;
  };
  const treasuryOf = (polityId: string | null): string | null =>
    polityId === null ? null : next.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId)?.id ?? null;

  // What he was proved to have taken goes back where it came from.
  for (const row of next.diversions.filter((candidate) => candidate.byCharacterId === convicted.id && candidate.foundAtStep !== null)) {
    const victim = row.scope.kind === "polity" ? treasuryOf(row.scope.id) : next.characters.find((character) => character.id === row.scope.id)?.personalAccountId ?? null;
    move(convicted.personalAccountId, victim, row.amount);
  }
  next = { ...next, diversions: next.diversions.filter((candidate) => !(candidate.byCharacterId === convicted.id && candidate.foundAtStep !== null)) };

  const sentence = procedure.sentence ?? "fine";
  if (sentence === "death") return killCharacter(next, convicted.id, `Condemned: ${procedure.label}.`.slice(0, 200), atStep).world;
  const purse = next.material.accounts.find((account) => account.id === convicted.personalAccountId)?.balance ?? 0;
  move(convicted.personalAccountId, treasuryOf(convicted.polityId), Math.floor(purse * FINE_SHARE));
  next = vacateOfficesOf(next, convicted.id, "removal", atStep);
  // Convicted is disgraced: a fine is a blot, exile all but the end of a name.
  next = shiftStanding(next, convicted.id, sentence === "exile" ? EXILE_STANDING_BPS : FINE_STANDING_BPS, "scandal");
  if (sentence === "exile") {
    next = { ...next, characters: next.characters.map((character) => (character.id === convicted.id ? { ...character, disqualifyingStatuses: [...new Set([...character.disqualifyingStatuses, "exiled"])] } : character)) };
  }
  return next;
}

/** Who a condemned man and his blood hold to account: whoever brought it, and whoever presided. */
function accusersOf(world: WorldState, procedure: PoliticalProcedure, accusedId: string): string[] {
  const institution = world.material.institutions.find((candidate) => candidate.id === procedure.institutionId);
  const courts = institution === undefined ? undefined : readDepartments(world).holding({ kind: "polity", id: institution.polityId }, "courts");
  return [...new Set([procedure.sponsorCharacterId, courts?.head?.id ?? null])]
    .filter((id): id is string => id !== null && id !== accusedId);
}

function condemnedBy(world: WorldState, procedure: PoliticalProcedure, convicted: Character, atStep: number): WorldState {
  const death = procedure.sentence === "death";
  const accusers = accusersOf(world, procedure, convicted.id);
  const kin = kinOf(world, convicted.id);
  const grievances: Grievance[] = accusers.flatMap((accuser) => [
    { subjectCharacterId: convicted.id, targetCharacterId: accuser, label: "He had me condemned.", score: -20, dimensions: { trust: -40, affection: -40, fear: 20 }, decayPerYearBps: 0 },
    ...kin.map((relative) => ({
      subjectCharacterId: relative, targetCharacterId: accuser, label: death ? `He had ${convicted.name} put to death.` : `He had ${convicted.name} condemned.`,
      score: death ? -20 : -12, dimensions: death ? { trust: -40, affection: -50, fear: 15 } : { trust: -20, affection: -20 }, decayPerYearBps: death ? 0 : 400,
    })),
  ]);
  let next = remember(world, grievances, atStep, `${procedure.id}:condemned`);
  next = teach(next, convicted.id, "convicted", atStep);
  if (death) for (const relative of kin) next = teach(next, relative, "bereaved", atStep);
  return next;
}

function acquitted(world: WorldState, procedure: PoliticalProcedure, atStep: number): WorldState {
  const accused = world.characters.find((character) => character.id === procedure.subjectId && character.alive);
  if (accused === undefined || procedure.sponsorCharacterId === null || procedure.sponsorCharacterId === accused.id) return teach(world, procedure.subjectId ?? "", "acquitted", atStep);
  return teach(remember(world, [{
    subjectCharacterId: accused.id, targetCharacterId: procedure.sponsorCharacterId, label: "He tried to ruin me in the courts, and failed.",
    score: -12, dimensions: { trust: -25, affection: -15 },
  }], atStep, `${procedure.id}:acquitted`), accused.id, "acquitted", atStep);
}
