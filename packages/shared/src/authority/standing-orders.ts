import type { Office } from "../characters/character";
import { accountLabel } from "../material/account-names";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import type { Contingency } from "../world/contingency";
import type { OrderStage, StageCondition } from "../world/orders";
import type { WatchPredicate } from "../world/watch";
import type { WorldState } from "../world/world-state";
import { buildStation, holdsPolityStanding } from "./station";

/**
 * The player's conditional orders: "if the enemy reaches the crossing,
 * withdraw the garrison".
 *
 * Two things in the world are standing orders. A plan laid against a day that
 * has not come (`world.contingencies`: armed, sprung, called off or lapsed),
 * and an act of an order held until what it waits on is settled (an
 * `OrderStage`: waiting, resumed, failed). Each is written here as a sentence
 * the player would have said, with its trigger, what it does, and who answers
 * for it -- from the record, never from a model.
 *
 * Only orders the character may inspect: their own; those laid in their
 * power's name by someone who governs it, if they do too; and those that
 * involve a force they command. A trap laid by an enemy is not in this list,
 * and neither is an order of somebody else's that happens to name a place the
 * player is.
 */

export type StandingOrderStatus = "waiting" | "triggered" | "completed" | "cancelled";

export interface StandingOrderRow {
  /** `contingency:<id>` or `stage:<orderId>:<part>:<stage>`. */
  readonly key: string;
  readonly kind: "plan" | "held";
  readonly status: StandingOrderStatus;
  /** "If the enemy reaches the crossing, withdraw the garrison." */
  readonly summary: string;
  readonly detail: {
    readonly trigger: string;
    /** What is to be done, in the words the order was given in. */
    readonly instructions: string;
    /** The man or force who answers for it. */
    readonly responsible: string;
    readonly statusNote: string;
    readonly layer: readonly string[];
    /** Amend and call-off are available: only an order still waiting can be changed. */
    readonly changeable: boolean;
  };
  /** The words to start a change with, handed to the desk. */
  readonly label: string;
}

export interface StandingOrders {
  readonly rows: readonly StandingOrderRow[];
  /** How many are still waiting. */
  readonly waiting: number;
}

const EMPTY: StandingOrders = { rows: [], waiting: 0 };
const KEPT = 30;

const lowerFirst = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);
const trimStop = (text: string): string => text.trim().replace(/[.\s]+$/, "");

export function readStandingOrders(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): StandingOrders {
  if (characterId === null) return EMPTY;
  const station = buildStation({ world, characterId, offices });
  const governs = holdsPolityStanding(station);
  const date = (day: number): string => (clock === undefined ? `day ${day}` : formatWorldDate({ day, minute: 0 }, clock));
  const nameOf = (id: string): string =>
    world.characters.find((character) => character.id === id)?.name
    ?? world.map.polities.find((polity) => polity.id === id)?.name
    ?? world.material.forces.find((force) => force.id === id)?.name
    ?? world.map.provinces.find((province) => province.id === id)?.name
    ?? world.map.provinces.flatMap((province) => province.settlements).find((settlement) => settlement.id === id)?.name
    ?? world.map.provinces.flatMap((province) => province.positions ?? []).find((position) => position.id === id)?.label
    ?? "somewhere";

  const rows: StandingOrderRow[] = [];

  for (const plan of world.contingencies) {
    const mine = plan.ownerCharacterId === characterId
      || (governs && plan.ownerPolityId !== null && plan.ownerPolityId === station.polityId)
      || (plan.ambushForceId !== null && station.forceIds.has(plan.ambushForceId));
    if (!mine) continue;
    rows.push(planRow(plan));
  }

  const orderStageRows: StandingOrderRow[] = [];
  world.orders.forEach((order) => {
    if (order.actorCharacterId !== characterId) return;
    order.parts.forEach((part, partIndex) => {
      part.stages.forEach((stage, stageIndex) => {
        // A part a later order closed waits on nothing any more, whatever its
        // stage was left saying.
        const settled = part.closedAtStep !== null && stage.status === "waiting" ? { ...stage, status: "failed" as const } : stage;
        orderStageRows.push(stageRow(order.id, order.text, partIndex, stageIndex, part.said, settled));
      });
    });
  });
  rows.push(...orderStageRows);

  // Waiting first; then the most recently dealt with. Ids carry no date, so
  // the creation order of the list stands in for it and newest are last.
  const rank: Record<StandingOrderStatus, number> = { waiting: 0, triggered: 1, completed: 2, cancelled: 3 };
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank[a.row.status] - rank[b.row.status] || b.index - a.index)
    .map(({ row }) => row)
    .slice(0, KEPT);
  return { rows: ordered, waiting: ordered.filter((row) => row.status === "waiting").length };

  function planRow(plan: Contingency): StandingOrderRow {
    const status: StandingOrderStatus = plan.status === "armed" ? "waiting"
      : plan.status === "sprung" ? (plan.effect === "spring_trap" ? "completed" : "triggered")
        : "cancelled";
    const trigger = triggerInWords(plan.trigger, world, nameOf);
    const where = plan.positionId !== null ? nameOf(plan.positionId) : nameOf(plan.provinceId);
    const doing = plan.standingOrder != null
      ? trimStop(plan.standingOrder)
      : plan.effect === "spring_trap" ? `spring ${plan.label} at ${where}` : `stand to at ${where}, and put the matter to me`;
    const against = plan.againstPolityId === null ? null : nameOf(plan.againstPolityId);
    const responsible = plan.ambushForceId !== null ? `${nameOf(plan.ownerCharacterId)}, with ${nameOf(plan.ambushForceId)}` : nameOf(plan.ownerCharacterId);
    const statusNote = plan.status === "armed"
      ? `Laid ${date(plan.armedAtStep)}; waiting${plan.expiresAtStep === null ? "" : `, and will lapse ${date(plan.expiresAtStep)}`}.`
      : plan.status === "sprung"
        ? `Its trigger was met ${plan.sprungAtStep === null ? "" : date(plan.sprungAtStep)}${plan.tollBps === null ? "" : `, and it took about ${Math.round(plan.tollBps / 100)} in every hundred of the men caught in it`}.`
        : plan.status === "disarmed" ? "Called off." : `It lapsed${plan.expiresAtStep === null ? "" : ` on ${date(plan.expiresAtStep)}`} without being sprung.`;
    return {
      key: `contingency:${plan.id}`,
      kind: "plan",
      status,
      summary: `If ${trigger}, ${doing}.`,
      label: plan.label,
      detail: {
        trigger: upper(trigger) + ".",
        instructions: `${upper(doing)}.`,
        responsible,
        statusNote,
        layer: [
          `Laid at ${where}.`,
          ...(against === null ? [] : [`Against ${against}.`]),
          ...(plan.preparationSpend > 0 ? [`${plan.preparationSpend.toLocaleString("en-GB")} spent preparing it.`] : []),
        ],
        changeable: plan.status === "armed",
      },
    };
  }

  function stageRow(orderId: string, orderText: string, partIndex: number, stageIndex: number, said: string, stage: OrderStage): StandingOrderRow {
    const status: StandingOrderStatus = stage.status === "waiting" ? "waiting" : stage.status === "resumed" ? "completed" : "cancelled";
    const conditions = stage.waitsOn.map((condition) => conditionInWords(condition)).join(" and ");
    return {
      key: `stage:${orderId}:${partIndex}:${stageIndex}`,
      kind: "held",
      status,
      summary: `Once ${conditions}, ${lowerFirst(trimStop(said))}.`,
      label: trimStop(said),
      detail: {
        trigger: `${upper(conditions)}.`,
        instructions: `${upper(trimStop(said))}.`,
        responsible: nameOf(characterId!),
        statusNote: stage.status === "waiting" ? "Held until that is settled, and then done without a second order."
          : stage.status === "resumed" ? "What it waited on was settled, and it was done."
            : `It could not be done${stage.reason === null ? "" : `: ${trimStop(stage.reason)}`}.`,
        layer: [`Part of the order: "${trimStop(orderText).slice(0, 120)}".`],
        changeable: stage.status === "waiting",
      },
    };
  }

  function conditionInWords(condition: StageCondition): string {
    switch (condition.kind) {
      case "procedure_passed": return `${world.material.politicalProcedures.find((procedure) => procedure.id === condition.procedureId)?.label ?? "the question"} is carried`;
      case "force_at": return `${nameOf(condition.forceId)} is at ${nameOf(condition.provinceId)}`;
      case "force_named": return `${condition.name} is raised`;
      case "transport_capacity": return `there are ships to carry ${nameOf(condition.forceId)} to ${nameOf(condition.provinceId)}`;
      case "funds": {
        const account = world.material.accounts.find((candidate) => candidate.id === condition.accountId);
        return `${account === undefined ? "the treasury" : accountLabel(world, account, "clause")} holds ${condition.amount.toLocaleString("en-GB")}`;
      }
      case "project_done": return `${world.projects.find((project) => project.id === condition.projectId)?.label ?? "the work"} is finished`;
      case "letter_answered": return `"${world.diplomacy.find((message) => message.id === condition.messageId)?.subject ?? "the letter"}" is ${condition.answer === "any" ? "answered" : condition.answer}`;
    }
  }
}

const upper = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);

/** A watch predicate as the player would have said it, for the arms a plan can be laid on. */
export function triggerInWords(predicate: WatchPredicate, world: WorldState, nameOf: (id: string) => string): string {
  switch (predicate.kind) {
    case "force_enters_province": return `${predicate.polityId === undefined ? "an enemy army" : `an army of ${nameOf(predicate.polityId)}`} enters ${nameOf(predicate.provinceId)}`;
    case "force_enters_position": return `${predicate.polityId === undefined ? "the enemy" : nameOf(predicate.polityId)} reaches ${nameOf(predicate.positionId)}`;
    case "province_control_changes": return `${nameOf(predicate.provinceId)} changes hands`;
    case "settlement_control_changes": return `${nameOf(predicate.settlementId)} falls`;
    case "polity_strength_above": return `${nameOf(predicate.polityId)} has more than ${predicate.headcount.toLocaleString("en-GB")} men under arms`;
    case "force_strength_below": return `${nameOf(predicate.forceId)} falls below ${predicate.headcount.toLocaleString("en-GB")} fit men`;
    case "account_below": {
      const account = world.material.accounts.find((candidate) => candidate.id === predicate.accountId);
      return `${account === undefined ? "the treasury" : accountLabel(world, account, "clause")} falls below ${predicate.amount.toLocaleString("en-GB")}`;
    }
    case "arrears_reach": return `pay falls ${predicate.periods} ${predicate.periods === 1 ? "month" : "months"} behind`;
    case "character_dies": return `${nameOf(predicate.characterId)} dies`;
    case "question_decided": return `${world.material.politicalProcedures.find((procedure) => procedure.id === predicate.procedureId)?.label ?? "the question"} is ${predicate.outcome === undefined ? "decided" : predicate.outcome === "passed" ? "carried" : "rejected"}`;
    case "letter_answered": return `${nameOf(predicate.toPolityId)} ${predicate.answer === undefined ? "answers" : predicate.answer === "accepted" ? "accepts" : "refuses"}`;
    case "office_vacant": return `the office of ${predicate.officeId.replace(/[-_:]/g, " ")} is ${predicate.vacant ? "vacant" : "filled"}`;
  }
}
