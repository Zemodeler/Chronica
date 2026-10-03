import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { OrderGoalSchema, goalsMet } from "./goals";
import type { WorldState } from "./world-state";

/**
 * What the player ordered, part by part, and the work each part set going.
 *
 * "Carry Legio I to Messana with the Roman fleet" was read, understood and
 * refused four times over five weeks, and each time the only trace it left was
 * a line of prose -- or, once, an inert "pursuit" the Council showed as under
 * way. The next order could not build on it, a passed vote could not wake it,
 * and a stopped burst dropped it. An order is a standing thing: each of its
 * parts is remembered with the work that answers it, and what that work is
 * doing now is read from the work itself (`orderPartStatus`), never from a
 * sentence written when the order was given.
 */
export const OrderWorkRefSchema = z
  .object({
    kind: z.enum(["project", "procedure", "message", "audit", "plot", "order_attempt", "force", "entity", "contract", "siege"]),
    id: EntityIdSchema,
  })
  .strict();
export type OrderWorkRef = z.infer<typeof OrderWorkRefSchema>;

/**
 * What a held act waits on before it is tried again: a vote to pass, an army
 * to arrive, money to be there.
 */
export const StageConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("transport_capacity"), forceId: EntityIdSchema, provinceId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("force_named"), name: z.string().min(1).max(160), polityId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("procedure_passed"), procedureId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("force_at"), forceId: EntityIdSchema, provinceId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("funds"), accountId: EntityIdSchema, amount: z.number().positive() }).strict(),
  /** A work the order set going finished: the fleet the crossing needs, built. */
  z.object({ kind: z.literal("project_done"), projectId: EntityIdSchema }).strict(),
  /** A letter answered as wanted: "if they refuse, then ..." waits on a refusal. */
  z.object({ kind: z.literal("letter_answered"), messageId: EntityIdSchema, answer: z.enum(["accepted", "refused", "countered", "any"]).default("any") }).strict(),
]);
export type StageCondition = z.infer<typeof StageConditionSchema>;

/**
 * An act of the order that could not be done yet, held until what it waits on
 * is settled, and then done as the order's without a second order.
 *
 * "Seek the Senate's leave and carry the legion over" was refused for want of
 * leave; the leave came ten days later, and the record said "what it allows
 * waits on somebody's order" -- although the order had been given.
 */
export const OrderStageSchema = z
  .object({
    /** The act, as written. */
    held: z.record(z.string(), z.unknown()),
    waitsOn: z.array(StageConditionSchema).min(1).max(4),
    status: z.enum(["waiting", "resumed", "failed"]).default("waiting"),
    /** Why it failed, when it did. */
    reason: z.string().trim().max(400).nullable().default(null),
  })
  .strict();
export type OrderStage = z.infer<typeof OrderStageSchema>;

/**
 * What the order allowed to be spent on a part, and from where: "allocate up
 * to 3,000 from the treasury". Kept with the part so the work done for it
 * later is held to it, and the record can say what was allowed, set aside and
 * spent as three different things.
 */
export const SpendEnvelopeSchema = z
  .object({
    payerAccountId: EntityIdSchema,
    cap: z.number().positive(),
    /** The money set aside once it could be (`world/money-reservations.ts`). */
    reservationId: EntityIdSchema.nullable().default(null),
  })
  .strict();
export type SpendEnvelope = z.infer<typeof SpendEnvelopeSchema>;

export const OrderPartSchema = z
  .object({
    /** The part in the orchestrator's reading of the order: "Carry Legio I to Messana". */
    said: z.string().trim().min(1).max(200),
    /**
     * What it is for, as the world can be read for it (`world/goals.ts`): the
     * legion in Messana, not the transport accepted. Empty for a part that
     * only wanted something said or done once.
     */
    goals: z.array(OrderGoalSchema).max(4).default([]),
    /** Everything this part set going, in the order it was made. */
    workRefs: z.array(OrderWorkRefSchema).max(12).default([]),
    /** Why the world would not have it, when it would not. */
    refusal: z.string().trim().max(600).nullable().default(null),
    /**
     * What the player should know about how it was done, when it was done in a
     * way his place did not allow: "bought bread for the legion out of the
     * treasury before the Senate's leave". Not a refusal -- the thing happened.
     */
    note: z.string().trim().max(400).nullable().default(null),
    /** Where the reader said why it could not be done. */
    whyNot: z.string().trim().max(300).nullable().default(null),
    /** Facts that answered it. */
    factIds: z.array(z.string().max(120)).max(12).default([]),
    /** Acts held until what they wait on is settled (`OrderStage`). */
    stages: z.array(OrderStageSchema).max(6).default([]),
    spend: SpendEnvelopeSchema.nullable().default(null),
    /**
     * Whether its acts were tied to it by the answer that did them, or guessed
     * by their words. A guess is shown as one.
     */
    attribution: z.enum(["tagged", "guessed"]).default("tagged"),
    /** Set when the part is finished with: done, refused for good, or superseded by a later order. */
    closedAtStep: ElapsedStepSchema.nullable().default(null),
  })
  .strict();
export type OrderPart = z.infer<typeof OrderPartSchema>;

export const OrderRecordSchema = z
  .object({
    id: EntityIdSchema,
    /** Who gave it. */
    actorCharacterId: EntityIdSchema,
    text: z.string().trim().min(1).max(4_000),
    givenAtStep: ElapsedStepSchema,
    parts: z.array(OrderPartSchema).max(10),
  })
  .strict();
export type OrderRecord = z.infer<typeof OrderRecordSchema>;

/** Somebody the burst had to ask and could not pay to (`WorldState.owed`). */
export const OwedTurnSchema = z
  .object({
    characterId: EntityIdSchema,
    /** What he was wanted for, as he will be told it. */
    why: z.string().trim().min(1).max(300),
    sinceStep: ElapsedStepSchema,
    /** How many bursts have ended with him still owed. */
    bursts: z.number().int().nonnegative().default(0),
  })
  .strict();
export type OwedTurn = z.infer<typeof OwedTurnSchema>;

/** A man is owed his turn for this many bursts, and then the world stops waiting. */
export const MAX_OWED_BURSTS = 2;

/** Whether somebody is owed a turn the world has not given him. */
export function isOwedATurn(world: Pick<WorldState, "owed">, characterId: string): boolean {
  return world.owed.some((entry) => entry.characterId === characterId);
}

/** How many orders are remembered. The oldest closed ones go first. */
export const MAX_ORDER_RECORDS = 60;

/** The id a part is known by everywhere its work and facts go: `<record>-p<index>`. */
export function orderPartRef(recordId: string, index: number): string {
  return `${recordId}-p${index}`;
}

/** The record and part a part ref names, or null. */
export function findOrderPart(world: WorldState, ref: string): { readonly order: OrderRecord; readonly index: number; readonly part: OrderPart } | null {
  const match = /^(.*)-p(\d+)$/.exec(ref);
  if (match === null) return null;
  const order = world.orders.find((candidate) => candidate.id === match[1]);
  const index = Number(match[2]);
  const part = order?.parts[index];
  return order === undefined || part === undefined ? null : { order, index, part };
}

/**
 * Where one part of an order stands, read from its goals and its work.
 *
 * - `achieved`: what it was for is so -- the legion stands in Messana.
 * - `under_way`: something is being done: a march, an audit, a plot.
 * - `acknowledged`: whoever it was handed to took it up, and has done nothing yet.
 * - `authorized`: the leave or the money was given, and nothing is being done with it.
 * - `awaiting_authority`: it waits on a vote.
 * - `awaiting_reply`: a letter is on its way or unanswered.
 * - `pending`: handed to somebody who has not yet taken it up.
 * - `blocked`: its work was stopped.
 * - `failed`: it cannot come about any more, or its work finished without it.
 * - `refused`, `unanswered`: nobody would, or nothing came of it.
 *
 * Taking an order up, and being allowed to, are progress and are shown as
 * such; neither is the thing done.
 */
export type OrderPartStatus =
  | "achieved" | "under_way" | "acknowledged" | "authorized" | "awaiting_authority" | "awaiting_reply" | "pending"
  | "blocked" | "failed" | "refused" | "unanswered";

/** Least finished first: a part stands where its least finished work stands. */
const RANK: Record<OrderPartStatus, number> = {
  blocked: 0, failed: 1, under_way: 2, acknowledged: 3, awaiting_authority: 4, awaiting_reply: 5, pending: 6, authorized: 7, refused: 8, unanswered: 9, achieved: 10,
};

/** The statuses a part is finished at, one way or another. */
const FINISHED: ReadonlySet<OrderPartStatus> = new Set(["achieved", "failed", "refused", "unanswered"]);

/** Where one piece of work stands, or null when it has no life of its own to read (a made army, an arrangement) or no longer exists. */
export function workStatus(world: WorldState, ref: OrderWorkRef): OrderPartStatus | null {
  switch (ref.kind) {
    case "contract": {
      const contract = world.material.contracts.find((candidate) => candidate.id === ref.id);
      return contract === undefined ? null : contract.status === "active" ? "under_way" : "failed";
    }
    case "project": {
      const project = world.projects.find((candidate) => candidate.id === ref.id);
      if (project === undefined) return null;
      if (project.status === "completed") return "achieved";
      if (project.status === "failed") return "failed";
      if (project.status === "cancelled") return "blocked";
      if (project.status === "proposed") return "awaiting_authority";
      return "under_way";
    }
    case "procedure": {
      const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === ref.id);
      if (procedure === undefined) return null;
      if (procedure.outcome === null) return "awaiting_authority";
      return procedure.outcome === "passed" ? "authorized" : "refused";
    }
    case "message": {
      const message = world.diplomacy.find((candidate) => candidate.id === ref.id);
      if (message === undefined) return null;
      if (message.status === "awaiting_reply") return "awaiting_reply";
      return message.answer === "refused" || message.answer === "ignored" ? "refused" : "achieved";
    }
    case "audit": {
      const audit = world.audits.find((candidate) => candidate.id === ref.id);
      if (audit === undefined) return null;
      if (audit.status === "under_way") return "under_way";
      return audit.status === "interrupted" ? "failed" : "achieved";
    }
    case "plot": {
      const plot = world.covertPlots.find((candidate) => candidate.id === ref.id);
      if (plot === undefined) return null;
      if (plot.outcome === null) return "under_way";
      return plot.outcome === "discovered" || plot.outcome === "nothing" ? "failed" : "achieved";
    }
    case "siege": {
      const siege = world.sieges.find((candidate) => candidate.id === ref.id);
      if (siege === undefined) return null;
      return siege.status === "active" ? "under_way" : siege.status === "taken" ? "achieved" : "failed";
    }
    case "order_attempt": {
      const attempt = world.orderAttempts.find((candidate) => candidate.id === ref.id);
      if (attempt === undefined) return null;
      if (attempt.status === "carried_out") return "achieved";
      if (attempt.status === "issued" || attempt.status === "received" || attempt.status === "delayed") return "pending";
      if (attempt.status === "accepted") return "acknowledged";
      if (attempt.status === "abandoned") return "failed";
      return "refused";
    }
    case "force":
    case "entity":
      // A made thing is not progress by being made: what it was made for is
      // the part's goal (`exists`, or whatever the part was for).
      return null;
  }
}

/** Where a held act stands, as a status of the part. */
function stageStatus(world: WorldState, stage: OrderStage): OrderPartStatus | null {
  if (stage.status === "resumed") return null;
  if (stage.status === "failed") return "failed";
  const waitsOnVote = stage.waitsOn.some((condition) => condition.kind === "procedure_passed"
    && world.material.politicalProcedures.find((procedure) => procedure.id === condition.procedureId)?.outcome === null);
  if (waitsOnVote) return "awaiting_authority";
  const waitsOnLetter = stage.waitsOn.some((condition) => condition.kind === "letter_answered"
    && world.diplomacy.find((message) => message.id === condition.messageId)?.status === "awaiting_reply");
  return waitsOnLetter ? "awaiting_reply" : "pending";
}

export function orderPartStatus(world: WorldState, part: OrderPart, options: { readonly without?: OrderWorkRef } = {}): OrderPartStatus {
  const reading = goalsMet(world, part.goals);
  if (reading === "met") return "achieved";
  const work = options.without === undefined ? part.workRefs : part.workRefs.filter((ref) => ref.kind !== options.without!.kind || ref.id !== options.without!.id);
  const statuses = [
    ...work.map((ref) => workStatus(world, ref)),
    ...part.stages.map((stage) => stageStatus(world, stage)),
  ].filter((status): status is OrderPartStatus => status !== null);
  if (reading === "impossible") return statuses.includes("refused") || (statuses.length === 0 && part.refusal !== null) ? "refused" : "failed";
  if (statuses.length === 0) {
    if (part.refusal !== null) return "refused";
    // A part with nothing to read the world for was answered by being said.
    return reading === null && part.factIds.length > 0 ? "achieved" : "unanswered";
  }
  const worst = statuses.reduce((least, status) => (RANK[status] < RANK[least] ? status : least));
  // Its work is finished and what it was for is not so: finishing was not enough.
  if (reading === "not_yet" && worst === "achieved") return "failed";
  return worst;
}

/**
 * The status word for a part, as the player reads it. Done beyond the actor's
 * authority is said so: "Declare war on Carthage -- done" read as success
 * while the breach was in a private fact nobody showed him.
 */
export function orderPartLabel(status: OrderPartStatus, part: Pick<OrderPart, "note">): string {
  if (status === "achieved" && part.note !== null && !/^Not needed/.test(part.note)) return "done, beyond his authority";
  return ORDER_PART_STATUS_LABEL[status];
}

/** Still wanting something done: neither finished nor closed. */
export function isOrderPartOpen(world: WorldState, part: OrderPart): boolean {
  if (part.closedAtStep !== null) return false;
  return !FINISHED.has(orderPartStatus(world, part));
}

/** A short, plain word for the status, as the player reads it. */
export const ORDER_PART_STATUS_LABEL: Record<OrderPartStatus, string> = {
  achieved: "done",
  under_way: "under way",
  acknowledged: "taken up, nothing done yet",
  authorized: "allowed, not yet carried out",
  awaiting_authority: "waiting on a vote",
  awaiting_reply: "waiting on an answer",
  pending: "handed on, not yet taken up",
  blocked: "stopped",
  failed: "failed",
  refused: "refused",
  unanswered: "nothing came of it",
};

/** Records past the cap drop their oldest wholly-closed ones first, then the oldest of all. */
export function capOrders(world: WorldState, orders: readonly OrderRecord[]): OrderRecord[] {
  const kept = [...orders];
  while (kept.length > MAX_ORDER_RECORDS) {
    const closed = kept.findIndex((order) => order.parts.every((part) => !isOrderPartOpen(world, part)));
    kept.splice(closed < 0 ? 0 : closed, 1);
  }
  return kept;
}
