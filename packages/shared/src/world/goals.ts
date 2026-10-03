import { z } from "zod";
import { ElapsedStepSchema, EntityIdSchema } from "../material-state";
import { PolityAgreementKindSchema } from "./agreements";
import type { WorldState } from "./world-state";

/**
 * What a part of an order is for, as something the world can be read for.
 *
 * Tiberius Coruncanius accepted "arrange the transport of Legio I to Messana",
 * the Senate voted the money, and the record called the order under way and
 * then done while the legion stood in Latium the whole summer: every test of
 * "done" read the life of the work -- an order taken up, a vote passed, a
 * project closed -- and none of them read the legion. A goal is the thing the
 * order wanted, named by ids, and `goalMet` reads the world for it and for
 * nothing else. Never a fact's words: a fact can say the legion crossed.
 */
export const OrderGoalSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("force_strength"), forceId: EntityIdSchema, minimum: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("contract_active"), contractId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("force_at"), forceId: EntityIdSchema, provinceId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("project_done"), projectId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("procedure_passed"), procedureId: EntityIdSchema }).strict(),
  /** A letter answered, one way or the other: the answer is what was asked for. */
  z.object({ kind: z.literal("answer_from"), messageId: EntityIdSchema }).strict(),
  /** Money reached an account since the order: `amount` in all, from `fromAccountId` where one was named. */
  z.object({
    kind: z.literal("paid"),
    toAccountId: EntityIdSchema,
    fromAccountId: EntityIdSchema.nullable().default(null),
    amount: z.number().positive(),
    sinceStep: ElapsedStepSchema,
  }).strict(),
  /** An inquiry that reached a finding. One that could not run is not one. */
  z.object({ kind: z.literal("audit_finding"), auditId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("plot_outcome"), plotId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("seat_held"), officeId: EntityIdSchema, characterId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("agreement_open"), agreementKind: PolityAgreementKindSchema, polityId: EntityIdSchema, withPolityId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("control"), provinceId: EntityIdSchema, settlementId: EntityIdSchema.nullable().default(null), polityId: EntityIdSchema }).strict(),
  /** A thing made: an army raised, an arrangement set up. It is met while the thing stands. */
  z.object({ kind: z.literal("exists"), of: z.enum(["force", "entity"]), id: EntityIdSchema }).strict(),
  /**
   * A person where the order sent him, and out of the army he left. "Leave
   * the army and travel to Rome" read "done" with the man still in the ranks
   * in Sicily: nothing could read a person's place or his service.
   */
  z.object({ kind: z.literal("character_at"), characterId: EntityIdSchema, provinceId: EntityIdSchema }).strict(),
  z.object({ kind: z.literal("out_of_service"), characterId: EntityIdSchema, forceId: EntityIdSchema }).strict(),
]).meta({ id: "OrderGoal" });
export type OrderGoal = z.infer<typeof OrderGoalSchema>;

/**
 * - `met`: the world is as the goal wants it.
 * - `not_yet`: it is not, and still could be.
 * - `impossible`: it cannot come about any more -- the army is gone, the vote
 *   failed, the plot was found out.
 */
export type GoalReading = "met" | "not_yet" | "impossible";

/** Reads the world for one goal. Pure: the same world gives the same answer. */
export function goalMet(world: WorldState, goal: OrderGoal): GoalReading {
  switch (goal.kind) {
    case "force_strength": {
      const force = world.material.forces.find((candidate) => candidate.id === goal.forceId);
      return force === undefined ? "impossible" : force.personnel.reduce((sum, category) => sum + category.fit, 0) >= goal.minimum ? "met" : "not_yet";
    }
    case "contract_active": {
      const contract = world.material.contracts.find((candidate) => candidate.id === goal.contractId);
      if (contract === undefined || contract.status === "broken") return "impossible";
      // A hire that ran its term was served: the work it was hired for is not
      // undone by the contract coming to its end.
      if (contract.status !== "active") return "met";
      return contract.forceId !== null && !world.material.forces.some((force) => force.id === contract.forceId) ? "impossible" : "met";
    }
    case "force_at": {
      const force = world.material.forces.find((candidate) => candidate.id === goal.forceId);
      if (force === undefined) return "impossible";
      return force.locationId === goal.provinceId ? "met" : "not_yet";
    }
    case "project_done": {
      const project = world.projects.find((candidate) => candidate.id === goal.projectId);
      if (project === undefined || project.status === "failed" || project.status === "cancelled") return "impossible";
      return project.status === "completed" ? "met" : "not_yet";
    }
    case "procedure_passed": {
      const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === goal.procedureId);
      if (procedure === undefined) return "impossible";
      if (procedure.outcome === null) return "not_yet";
      return procedure.outcome === "passed" ? "met" : "impossible";
    }
    case "answer_from": {
      const message = world.diplomacy.find((candidate) => candidate.id === goal.messageId);
      if (message === undefined) return "impossible";
      if (message.status === "awaiting_reply") return "not_yet";
      return message.answer === "ignored" ? "impossible" : "met";
    }
    case "paid": {
      if (!world.material.accounts.some((account) => account.id === goal.toAccountId)) return "impossible";
      const paid = world.material.transactions
        .filter((transaction) => transaction.atStep >= goal.sinceStep && transaction.destinationAccountId === goal.toAccountId
          && (goal.fromAccountId === null || transaction.sourceAccountId === goal.fromAccountId))
        .reduce((total, transaction) => total + transaction.amount, 0);
      return paid >= goal.amount ? "met" : "not_yet";
    }
    case "audit_finding": {
      const audit = world.audits.find((candidate) => candidate.id === goal.auditId);
      if (audit === undefined) return "impossible";
      if (audit.status === "under_way") return "not_yet";
      return audit.status === "interrupted" ? "impossible" : "met";
    }
    case "plot_outcome": {
      const plot = world.covertPlots.find((candidate) => candidate.id === goal.plotId);
      if (plot === undefined) return "impossible";
      if (plot.outcome === null) return "not_yet";
      return plot.outcome === "discovered" || plot.outcome === "nothing" ? "impossible" : "met";
    }
    case "seat_held": {
      const held = world.material.officeSeats.some((seat) => seat.officeId === goal.officeId && seat.status === "held" && seat.holderCharacterId === goal.characterId);
      if (held) return "met";
      const alive = world.characters.some((character) => character.id === goal.characterId && character.alive);
      return alive ? "not_yet" : "impossible";
    }
    case "agreement_open": {
      const open = world.polityAgreements.some((agreement) => agreement.status === "active" && agreement.kind === goal.agreementKind
        && ((agreement.polityId === goal.polityId && agreement.otherPolityId === goal.withPolityId)
          || (agreement.polityId === goal.withPolityId && agreement.otherPolityId === goal.polityId)));
      return open ? "met" : "not_yet";
    }
    case "control": {
      const province = world.map.provinces.find((candidate) => candidate.id === goal.provinceId);
      if (province === undefined) return "impossible";
      // Holding every city of a province is holding it, as far as an order to take it goes.
      if (goal.settlementId === null) return province.controllerPolityId === goal.polityId
        || (province.settlements.length > 0 && province.settlements.every((city) => city.controllerPolityId === goal.polityId)) ? "met" : "not_yet";
      const settlement = province.settlements.find((candidate) => candidate.id === goal.settlementId);
      if (settlement === undefined) return "impossible";
      return settlement.controllerPolityId === goal.polityId ? "met" : "not_yet";
    }
    case "character_at": {
      const person = world.characters.find((character) => character.id === goal.characterId);
      if (person === undefined || !person.alive) return "impossible";
      return person.locationProvinceId === goal.provinceId ? "met" : "not_yet";
    }
    case "out_of_service": {
      const person = world.characters.find((character) => character.id === goal.characterId);
      if (person === undefined || !person.alive) return "impossible";
      const inTheRanks = world.material.forces.some((force) => force.id === goal.forceId && force.memberCharacterIds.includes(goal.characterId))
        || person.service?.forceId === goal.forceId;
      return inTheRanks ? "not_yet" : "met";
    }
    case "exists": {
      const stands = goal.of === "force"
        ? world.material.forces.some((force) => force.id === goal.id)
        : world.genericEntities.some((entity) => entity.id === goal.id && !("retiredAtStep" in entity.attributes));
      return stands ? "met" : "impossible";
    }
  }
}

/** Every goal read together: met when all are, impossible when any is. */
export function goalsMet(world: WorldState, goals: readonly OrderGoal[]): GoalReading | null {
  if (goals.length === 0) return null;
  const readings = goals.map((goal) => goalMet(world, goal));
  if (readings.includes("impossible")) return "impossible";
  return readings.every((reading) => reading === "met") ? "met" : "not_yet";
}

/** Two goals that want the same thing. */
export function sameGoal(a: OrderGoal, b: OrderGoal): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
