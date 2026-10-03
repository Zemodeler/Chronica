import {
  isOwedATurn,
  negotiationIssue,
  formatWorldDate,
  type Ambition,
  type Character,
  type FactProposalDraft,
  type PlanProposal,
  type PlanStep,
  type ScenarioClock,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";
import { firedBetween, holdsIn, watchReading } from "./watch";
import { predicateInWords } from "./mechanics/mechanic-words";

/**
 * People who plan, not only react (gap document §5).
 *
 * The world acted through two routers, and neither knew what anybody was
 * trying to do: one woke people for news, the other rotated through whoever
 * had standing business. A man's ambition was a label in his prompt, so
 * whether Syracuse moved on Messana over two years depended on the rotation
 * landing on Hieron in the right week and on Hieron remembering.
 *
 * A plan is an ambition with steps. The person lays them; the engine keeps
 * them. It decides when it is time -- the day comes near, or what the step
 * waits on happens -- and puts him in front of the question. What the step
 * becomes is still his answer. A step not taken by its day is news for its
 * owner, not a silent failure: he is woken once more, to carry on late, to lay
 * the plan again, or to give it up.
 *
 * Deterministic and free throughout. Nothing here makes a model call.
 */

/** How long before a step's day its owner is asked about it, at the most. */
export const STEP_LEAD_DAYS = 7;

/**
 * The day a step that waits on nothing is asked about: a week before its day,
 * but never before half its time has run. Played by hand, a step laid with
 * eight days to go woke its owner the next morning -- a round paid for to be
 * told what he had decided the day before.
 */
export function wakeDay(step: PlanStep): number {
  return Math.max(step.laidOnDay + Math.ceil((step.dueDay - step.laidOnDay) / 2), step.dueDay - STEP_LEAD_DAYS);
}
/** Steps kept per ambition, taken or missed included: the history a portrait shows. */
const STEPS_KEPT = 8;
/** Owners a round reserves places for. Taken from the cast, never added to it (§5.5). */
export const PLAN_SLOTS = 2;

/** A step whose moment has come, and the sentence its owner is told. */
export interface DueStep {
  readonly ownerId: string;
  readonly ambitionId: string;
  readonly stepId: string;
  readonly why: string;
  readonly waiting?: boolean;
}

const activeAmbitions = (character: Character): readonly Ambition[] =>
  character.ambitions.filter((ambition) => ambition.status === "active");

const sameWant = (held: string, named: string): boolean => {
  const a = held.trim().toLowerCase();
  const b = named.trim().toLowerCase();
  return a === b || a.includes(b) || b.includes(a);
};

/** Whether what the step waits on has happened, read the way a contingency reads its trigger. */
function waitIsOver(step: PlanStep, world: WorldState): boolean {
  if (step.waitsOn === null) return false;
  if (step.waitsOn.kind === "province_control_changes" || step.waitsOn.kind === "settlement_control_changes" || step.waitsOn.kind === "letter_answered") {
    return firedBetween(step.waitsOn, step.armedReading ?? "", watchReading(step.waitsOn, step.waitsOn.kind === "letter_answered" ? dependencyWorld(world) : world));
  }
  return holdsIn(step.waitsOn, world);
}

/** The exact correspondence a dependency concerns; previous unrelated replies never release it. */
function dependencyLetters(step: PlanStep, world: WorldState) {
  const wait = step.waitsOn;
  if (wait?.kind !== "letter_answered") return [];
  return world.diplomacy.filter((message) => message.fromPolityId === wait.fromPolityId && message.toPolityId === wait.toPolityId
    && (wait.messageId === undefined ? message.sentAtStep >= step.laidOnDay : message.id === wait.messageId)
    && (wait.issueKey === undefined || negotiationIssue(message) === wait.issueKey.toLowerCase()));
}
function dependencyWorld(world: WorldState): WorldState {
  return { ...world, diplomacy: world.diplomacy.map((message) => message.status === "answered" && replyArrivalDay(message) > world.instant.day
    ? { ...message, status: "awaiting_reply" as const, answer: null, answeredAtStep: null } : message) };
}
function replyArrivalDay(message: WorldState["diplomacy"][number]): number {
  return (message.answeredAtStep ?? message.sentAtStep) + Math.max(0, (message.deliveredOnDay ?? message.sentAtStep) - message.sentAtStep);
}
const waitsForExternalDecision = (step: PlanStep): boolean => step.waitsOn?.kind === "letter_answered" || step.waitsOn?.kind === "question_decided";
function dependencyReviewDay(step: PlanStep, world: WorldState): number {
  if (step.waitsOn?.kind === "question_decided") {
    const procedureId = step.waitsOn.procedureId;
    const procedure = world.material.politicalProcedures.find((entry) => entry.id === procedureId);
    return Math.max(step.dueDay, procedure?.deadlineStep ?? step.dueDay);
  }
  const pending = dependencyLetters(step, world).filter((message) => message.status === "awaiting_reply" || replyArrivalDay(message) > world.instant.day).at(-1);
  return pending === undefined ? step.dueDay : Math.max(step.dueDay, pending.status === "answered" ? replyArrivalDay(pending) : pending.replyDueByStep ?? ((pending.deliveredOnDay ?? pending.sentAtStep) + 30));
}
function effectiveDueDay(step: PlanStep, world: WorldState): number {
  if (!waitsForExternalDecision(step)) return step.dueDay;
  const duration = step.afterConditionDays ?? Math.max(1, step.dueDay - step.laidOnDay);
  if (!waitIsOver(step, world)) return dependencyReviewDay(step, world) + duration;
  if (step.waitsOn?.kind === "question_decided") {
    const procedureId = step.waitsOn.procedureId;
    const procedure = world.material.politicalProcedures.find((entry) => entry.id === procedureId);
    return Math.max(step.dueDay, (procedure?.resolvedAtStep ?? step.laidOnDay) + duration);
  }
  const answered = dependencyLetters(step, world).filter((message) => message.status === "answered").at(-1);
  return Math.max(step.dueDay, (answered === undefined ? step.laidOnDay : replyArrivalDay(answered)) + duration);
}

const withAmbition = (world: WorldState, ownerId: string, ambitionId: string, change: (ambition: Ambition) => Ambition): WorldState => ({
  ...world,
  characters: world.characters.map((character) => (character.id !== ownerId ? character : {
    ...character,
    ambitions: character.ambitions.map((ambition) => (ambition.id === ambitionId ? change(ambition) : ambition)),
  })),
});

/** How many times a step may slip before it is missed: the most its schema holds (`PlanStepSchema.slips`). */
const MAX_SLIPS = 3;

/** How many missed steps in a row a plan may carry before laying it again gives it up. */
export const STALE_AFTER_MISSES = 3;

/** Missed steps since the last one done, counting back from the latest settled step. */
function trailingMisses(ambition: Ambition): number {
  let misses = 0;
  for (const step of [...ambition.steps].reverse()) {
    if (step.status === "pending") continue;
    if (step.status === "done") break;
    misses += 1;
  }
  return misses;
}

/**
 * A plan laid, or laid again.
 *
 * Named the way he already names an ambition he holds, it replaces what was
 * still to do and keeps what is done: a man who changes his plan does not
 * forget that he already sent the envoys. Anything missed is marked seen, so
 * the miss that made him replan does not wake him a second time.
 */
export function layPlan(world: WorldState, ownerId: string, plan: PlanProposal, ids: IdFactory, assignedIds: ReadonlyMap<string, string> = new Map()): { readonly world: WorldState; readonly ambitionId: string | null } {
  const owner = world.characters.find((character) => character.id === ownerId);
  if (owner === undefined || !owner.alive) return { world, ambitionId: null };
  const today = world.instant.day;
  // A reply dependency may name the letter just sent in this same answer.
  // Resolve its handle while that answer's assignments are still available.
  const resolved = plan.steps.map((step) => {
    if (step.when?.kind !== "letter_answered" || step.when.messageId === undefined) return step;
    const ref = step.when.messageId;
    const messageId = ref.startsWith("local:") ? assignedIds.get(ref.slice(6)) : ref;
    return messageId === undefined ? null : { ...step, when: { ...step.when, messageId } };
  });
  if (resolved.some((step) => step === null)) return { world, ambitionId: null };
  const steps: PlanStep[] = resolved.filter((step) => step !== null).map((step) => ({
    id: ids.next("plan-step"),
    act: step.act,
    dueDay: today + step.inDays,
    laidOnDay: today,
    waitsOn: step.when,
    ...(step.afterConditionDays === undefined ? {} : { afterConditionDays: step.afterConditionDays }),
    armedReading: step.when === null ? null : watchReading(step.when, step.when.kind === "letter_answered" ? dependencyWorld(world) : world),
    status: "pending",
    wokenOnDay: null,
    settledOnDay: null,
  }));

  const held = activeAmbitions(owner).find((ambition) => sameWant(ambition.label, plan.ambition));
  // A plan whose last steps all fell behind is not laid a fourth time. Decius
  // laid "hold Rhegium" again every few days for four months, each time with
  // the same review and the same scouts, and nothing ever came of it; the want
  // is given up, and what he does next has to be something else.
  if (held !== undefined && trailingMisses(held) >= STALE_AFTER_MISSES) {
    return { world: withAmbition(world, ownerId, held.id, (ambition) => ({ ...ambition, status: "abandoned" })), ambitionId: null };
  }
  if (held !== undefined) {
    const kept = held.steps
      .filter((step) => step.status !== "pending")
      .map((step) => (step.status === "missed" ? { ...step, wokenOnDay: step.wokenOnDay ?? today } : step))
      .slice(-(STEPS_KEPT - steps.length));
    return { world: withAmbition(world, ownerId, held.id, (ambition) => ({ ...ambition, steps: [...kept, ...steps] })), ambitionId: held.id };
  }

  const ambitionId = ids.next("ambition");
  const fresh: Ambition = { id: ambitionId, label: plan.ambition, kind: plan.kind, targetId: null, status: "active", steps };
  return {
    world: {
      ...world,
      characters: world.characters.map((character) => (character.id === ownerId ? { ...character, ambitions: [...character.ambitions, fresh].slice(-12) } : character)),
    },
    ambitionId,
  };
}

/**
 * Steps a man's answer carried out: the ones an act that changed the world
 * was written for (`servedByChange`).
 *
 * Only his own, and only ones not already done. A step is something that
 * happened, and an answer that only wrote about it did not happen -- nor did
 * one whose change was something else: letters to a friend do not raise the
 * fleet his plan wanted. A missed step done late still counts.
 */
export function takeSteps(world: WorldState, ownerId: string, stepIds: readonly string[]): { readonly world: WorldState; readonly taken: number } {
  if (stepIds.length === 0) return { world, taken: 0 };
  const owner = world.characters.find((character) => character.id === ownerId);
  if (owner === undefined) return { world, taken: 0 };
  const wanted = new Set(stepIds);
  const today = world.instant.day;
  let taken = 0;
  const ambitions = owner.ambitions.map((ambition) => {
    if (ambition.status !== "active") return ambition;
    return {
      ...ambition,
      steps: ambition.steps.map((step) => {
        if (!wanted.has(step.id) || step.status === "done") return step;
        taken += 1;
        return { ...step, status: "done" as const, settledOnDay: today };
      }),
    };
  });
  if (taken === 0) return { world, taken: 0 };
  return { world: { ...world, characters: world.characters.map((character) => (character.id === ownerId ? { ...character, ambitions } : character)) }, taken };
}

/**
 * Whose plans want them now, one step each, first ambition first.
 *
 * A missed step comes before a due one: a man whose plan has fallen behind
 * has to decide what it now is before its next step means anything. A step
 * that waits on something is asked about when it happens, not when the
 * calendar comes near; one that waits on nothing, at its `wakeDay`.
 */
export function dueSteps(world: WorldState, clock: ScenarioClock, excludeIds: readonly string[] = []): DueStep[] {
  const excluded = new Set(excludeIds);
  const today = world.instant.day;
  const due: DueStep[] = [];
  for (const character of world.characters) {
    if (!character.alive || excluded.has(character.id)) continue;
    let found: DueStep | undefined;
    for (const ambition of activeAmbitions(character)) {
      const missed = ambition.steps.find((step) => step.status === "missed" && step.wokenOnDay === null);
      if (missed !== undefined) {
        found = { ownerId: character.id, ambitionId: ambition.id, stepId: missed.id, why: `their plan to ${ambition.label} has fallen behind: "${missed.act}" was not done by ${dayInWords(missed.dueDay, clock)}` };
        break;
      }
      const next = ambition.steps.find((step) => step.status === "pending");
      if (next === undefined || next.wokenOnDay !== null) continue;
      if (waitsForExternalDecision(next) && !waitIsOver(next, world)) {
        if (today >= dependencyReviewDay(next, world) && next.waitingReviewOnDay == null) {
          found = { ownerId: character.id, ambitionId: ambition.id, stepId: next.id, waiting: true,
            why: `the decision needed for "${next.act}" has not arrived by its review day; decide whether to wait, send a due reminder, change terms or abandon it` };
          break;
        }
        continue;
      }
      if (next.waitsOn !== null ? waitIsOver(next, world) : today >= wakeDay(next)) {
        found = {
          ownerId: character.id,
          ambitionId: ambition.id,
          stepId: next.id,
          why: next.waitsOn !== null
            ? `what the next step of their plan to ${ambition.label} was waiting for has happened (${predicateInWords(next.waitsOn, world)}): "${next.act}"`
            : `the next step of their plan to ${ambition.label} is due by ${dayInWords(effectiveDueDay(next, world), clock)}: "${next.act}"`,
        };
        break;
      }
    }
    if (found !== undefined) due.push(found);
  }
  return due;
}

/** The steps whose owners were put in front of the question this round. */
export function markWoken(world: WorldState, woken: readonly DueStep[]): WorldState {
  if (woken.length === 0) return world;
  const today = world.instant.day;
  const byStep = new Set(woken.filter((entry) => !entry.waiting).map((entry) => entry.stepId));
  const waiting = new Set(woken.filter((entry) => entry.waiting).map((entry) => entry.stepId));
  const owners = new Set(woken.map((entry) => entry.ownerId));
  return {
    ...world,
    characters: world.characters.map((character) => (!owners.has(character.id) ? character : {
      ...character,
      ambitions: character.ambitions.map((ambition) => ({
        ...ambition,
        steps: ambition.steps.map((step) => (byStep.has(step.id) ? { ...step, wokenOnDay: today } : waiting.has(step.id) ? { ...step, waitingReviewOnDay: today } : step)),
      })),
    })),
  };
}

/**
 * Steps past their day, marked missed, and each owner's own record of it.
 *
 * A private fact the owner knows, so it is in his history and anyone who later
 * learns of it can: "failure is information" (§5.3). The step is left for
 * `dueSteps` to wake him for.
 */
export function settleOverdueSteps(world: WorldState, clock: ScenarioClock, localId: (prefix: string) => string): { readonly world: WorldState; readonly facts: readonly FactProposalDraft[]; readonly missed: number; readonly slipped: number } {
  const today = world.instant.day;
  const facts: FactProposalDraft[] = [];
  let missed = 0;
  let slipped = 0;
  const characters = world.characters.map((character) => {
    if (!character.alive) return character;
    let changed = false;
    const ambitions = character.ambitions.map((ambition) => {
      if (ambition.status !== "active") return ambition;
      const late = ambition.steps.filter((step) => step.status === "pending" && today > effectiveDueDay(step, world));
      if (late.length === 0) return ambition;
      changed = true;
      // The first time a step his owner has already been shown runs past its
      // day, the engine gives it the grace he would nearly always give it
      // himself -- carry on, later -- and asks nobody. It is a settled rule,
      // not a judgment: a plan that has not yet missed anything, and a step
      // that has not yet slipped, are slipped once. Whoever has missed already,
      // or a step already slipped, is asked what the plan now is.
      // And a man the burst never got round to asking has missed nothing: his
      // turn is owed him (`WorldState.owed`), and his steps wait for it (E06).
      // Only so far, though: a step slipped three times is missed whether he
      // was asked or not. Graced without end, an owed man's step slipped past
      // the limit its own schema sets, and the saved world would not load (E1).
      const owed = isOwedATurn(world, character.id);
      const graced = owed
        ? new Set(late.filter((step) => (step.slips ?? 0) < MAX_SLIPS).map((step) => step.id))
        : trailingMisses(ambition) === 0
          ? new Set(late.filter((step) => (step.slips ?? 0) === 0 && step.wokenOnDay !== null).map((step) => step.id))
          : new Set<string>();
      const behind = late.filter((step) => !graced.has(step.id));
      slipped += graced.size;
      missed += behind.length;
      const lateIds = new Set(behind.map((step) => step.id));
      if (behind.length > 0) {
        facts.push({
          localId: localId("plan_behind"),
          kind: "plan_fell_behind",
          summary: `${character.name}'s plan to ${ambition.label} fell behind: ${behind.map((step) => `"${step.act}" was not done by ${dayInWords(effectiveDueDay(step, world), clock)}`).join("; ")}.`,
          affectedRefs: [{ kind: "character", id: character.id }],
          visibility: "private",
          discoveryState: "private",
          knowableInDays: 0,
          knownToRefs: [{ kind: "character", id: character.id }],
          significance: 15,
        });
      }
      return {
        ...ambition,
        steps: ambition.steps.map((step) => {
          if (lateIds.has(step.id)) return { ...step, status: "missed" as const, settledOnDay: today, wokenOnDay: null };
          // Slipped: as long again as it was given, and never less than a fortnight.
          // His owner has seen it once already, so it stays seen.
          if (graced.has(step.id)) return { ...step, dueDay: today + Math.min(120, Math.max(14, step.dueDay - step.laidOnDay)), slips: Math.min(MAX_SLIPS, (step.slips ?? 0) + 1) };
          return step;
        }),
      };
    });
    return changed ? { ...character, ambitions } : character;
  });
  return { world: missed === 0 && slipped === 0 ? world : { ...world, characters }, facts, missed, slipped };
}

/**
 * The next day a plan wants the clock stopped for: a step coming into its
 * week, or a step's day passing. A burst walks to the next thing on the
 * calendar, and a plan is on the calendar -- without this, "let a month pass"
 * jumped straight over the day a man meant to act.
 */
export function nextPlanDay(world: WorldState): number | undefined {
  const today = world.instant.day;
  let soonest: number | undefined;
  const consider = (day: number): void => {
    if (day > today && (soonest === undefined || day < soonest)) soonest = day;
  };
  for (const character of world.characters) {
    if (!character.alive) continue;
    for (const ambition of activeAmbitions(character)) {
      for (const step of ambition.steps) {
        if (step.status !== "pending") continue;
        if (step.waitsOn === null && step.wokenOnDay === null) consider(wakeDay(step));
        if (waitsForExternalDecision(step) && !waitIsOver(step, world)) {
          if (step.waitingReviewOnDay == null) consider(dependencyReviewDay(step, world));
          for (const message of dependencyLetters(step, world)) if (message.status === "answered") consider(replyArrivalDay(message));
        }
        consider(effectiveDueDay(step, world) + 1);
      }
    }
  }
  return soonest;
}

function dayInWords(day: number, clock: ScenarioClock): string {
  return formatWorldDate({ day, minute: 0 }, clock);
}

/**
 * What a man wants, and how far he has got with it, in his own section.
 *
 * Every step is printed with its id because those are what he names in
 * "serves"; the ones done and missed are printed because a plan he
 * cannot see the history of is a plan he will lay again from the start.
 */
export function describePlans(character: Character, world: WorldState, clock: ScenarioClock, limit: number): string[] {
  const today = world.instant.day;
  const ambitions = activeAmbitions(character).slice(0, limit);
  if (ambitions.length === 0) return [];
  const lines = ["They want:"];
  for (const ambition of ambitions) {
    lines.push(`  - ${ambition.label} [${ambition.id}]`);
    let nextShown = false;
    for (const step of ambition.steps) {
      if (step.status === "done") { lines.push(`      done: ${step.act}`); continue; }
      if (step.status === "missed") { lines.push(`      missed [${step.id}]: ${step.act} (was due by ${dayInWords(step.dueDay, clock)})`); continue; }
      const dueDay = effectiveDueDay(step, world);
      const days = dueDay - today;
      const when = `by ${dayInWords(dueDay, clock)} (${days <= 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`})`;
      const waits = step.waitsOn === null ? "" : `, once ${predicateInWords(step.waitsOn, world)}${waitIsOver(step, world) ? " -- which has happened" : ""}`;
      if (waitsForExternalDecision(step) && !waitIsOver(step, world)) lines.push(`      waiting on an external decision; review day ${dependencyReviewDay(step, world)}. Waiting itself is not a missed action.`);
      lines.push(`      ${nextShown ? "then" : "next"} [${step.id}] ${when}${waits}: ${step.act}`);
      nextShown = true;
    }
    if (ambition.steps.length > 0 && !ambition.steps.some((step) => step.status === "pending")) {
      lines.push("      every step laid is behind them: see it fulfilled, lay the next, or give it up.");
    }
  }
  return lines;
}

/** How many of a burst's plans moved, for the burst's own line in the log (§5's "done when"). */
export interface PlanTally {
  /** Plans laid or laid again. */
  laid: number;
  /** Steps carried out. */
  taken: number;
  /** Steps that passed their day undone. */
  missed: number;
  /** Owners the engine put in the cast because a step wanted them. */
  woken: number;
  /** People who answered in cognition and left a mark on the record. */
  acted: number;
  /** Of those, the ones whose answer laid a plan or took a step of one. */
  actedOnAPlan: number;
}

export const emptyPlanTally = (): PlanTally => ({ laid: 0, taken: 0, missed: 0, woken: 0, acted: 0, actedOnAPlan: 0 });
