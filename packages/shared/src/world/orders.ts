import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
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
    kind: z.enum(["project", "procedure", "message", "audit", "plot", "order_attempt", "force", "entity"]),
    id: EntityIdSchema,
  })
  .strict();
export type OrderWorkRef = z.infer<typeof OrderWorkRefSchema>;

export const OrderPartSchema = z
  .object({
    /** The part in the orchestrator's reading of the order: "Carry Legio I to Messana". */
    said: z.string().trim().min(1).max(200),
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
    /**
     * A vote this part waits on, where it needed one: "seek the Senate's leave
     * and allocate up to 3,000". When it passes, the act refused for want of it
     * is tried again (`retry`), without a second order.
     */
    waitingOnProcedureId: EntityIdSchema.nullable().default(null),
    /** The act the world refused, as written, to try again once what it waited on is settled. Tried once. */
    retry: z.record(z.string(), z.unknown()).nullable().default(null),
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

/** How many orders are remembered. The oldest closed ones go first. */
export const MAX_ORDER_RECORDS = 60;

/**
 * Where one part of an order stands, read from its work.
 *
 * - `started`: something is being done -- a project under way, an audit open, a plot laid.
 * - `awaiting_authority`: it waits on a vote.
 * - `awaiting_reply`: a letter is on its way or unanswered.
 * - `pending`: handed to somebody who has not yet taken it up.
 * - `blocked`: its work stopped, or a delegate took it and nothing is being done.
 * - `done`, `refused`, `unanswered`: finished, one way or another.
 */
export type OrderPartStatus = "started" | "awaiting_authority" | "awaiting_reply" | "pending" | "blocked" | "done" | "refused" | "unanswered";

const RANK: Record<OrderPartStatus, number> = { blocked: 0, started: 1, awaiting_authority: 2, awaiting_reply: 3, pending: 4, refused: 5, unanswered: 6, done: 7 };

/** Where one piece of work stands, or null when it no longer exists. */
function workStatus(world: WorldState, ref: OrderWorkRef): OrderPartStatus | null {
  switch (ref.kind) {
    case "project": {
      const project = world.projects.find((candidate) => candidate.id === ref.id);
      if (project === undefined) return null;
      if (project.status === "completed") return "done";
      if (project.status === "cancelled" || project.status === "failed") return "blocked";
      return "started";
    }
    case "procedure": {
      const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === ref.id);
      if (procedure === undefined) return null;
      if (procedure.outcome === null) return "awaiting_authority";
      return procedure.outcome === "passed" ? "done" : "refused";
    }
    case "message": {
      const message = world.diplomacy.find((candidate) => candidate.id === ref.id);
      if (message === undefined) return null;
      if (message.status === "awaiting_reply") return "awaiting_reply";
      return message.answer === "refused" || message.answer === "ignored" ? "refused" : "done";
    }
    case "audit": {
      const audit = world.audits.find((candidate) => candidate.id === ref.id);
      if (audit === undefined) return null;
      return audit.status === "under_way" ? "started" : "done";
    }
    case "plot": {
      const plot = world.covertPlots.find((candidate) => candidate.id === ref.id);
      if (plot === undefined) return null;
      return plot.outcome === null ? "started" : "done";
    }
    case "order_attempt": {
      const attempt = world.orderAttempts.find((candidate) => candidate.id === ref.id);
      if (attempt === undefined) return null;
      if (attempt.status === "carried_out") return "done";
      if (attempt.status === "issued" || attempt.status === "received" || attempt.status === "delayed") return "pending";
      if (attempt.status === "accepted") return "started";
      return "refused";
    }
    case "force":
    case "entity":
      return "done";
  }
}

export function orderPartStatus(world: WorldState, part: OrderPart): OrderPartStatus {
  const statuses = part.workRefs.map((ref) => workStatus(world, ref)).filter((status): status is OrderPartStatus => status !== null);
  if (part.waitingOnProcedureId !== null && part.retry !== null) {
    const waited = workStatus(world, { kind: "procedure", id: part.waitingOnProcedureId });
    if (waited === "awaiting_authority") statuses.push("awaiting_authority");
  }
  if (statuses.length === 0) {
    if (part.refusal !== null) return "refused";
    return part.factIds.length > 0 ? "done" : "unanswered";
  }
  // The part stands where its least finished work stands.
  return statuses.reduce((worst, status) => (RANK[status] < RANK[worst] ? status : worst));
}

/** Still wanting something done: neither finished nor closed. */
export function isOrderPartOpen(world: WorldState, part: OrderPart): boolean {
  if (part.closedAtStep !== null) return false;
  const status = orderPartStatus(world, part);
  return status !== "done" && status !== "refused" && status !== "unanswered";
}

/** A short, plain word for the status, as the player reads it. */
export const ORDER_PART_STATUS_LABEL: Record<OrderPartStatus, string> = {
  started: "under way",
  awaiting_authority: "waiting on a vote",
  awaiting_reply: "waiting on an answer",
  pending: "handed on, not yet taken up",
  blocked: "stopped",
  done: "done",
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
