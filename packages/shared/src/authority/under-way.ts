import { projectFundingAvailable } from "../world/money-reservations";
import { buildStation, holdsPolityStanding, type Station } from "./station";
import type { Office } from "../characters/character";
import type { WorldState } from "../world/world-state";
import type { Project } from "../world/project";
import { formatWorldDate, type ScenarioClock } from "../world/clock";
import { orderPartLabel, orderPartStatus } from "../world/orders";

/**
 * What the player's orders are doing, as they could know it.
 *
 * An order leaves the world one of three things: a project with milestones
 * and money set aside ("Raise two new legions"), an army on the march, or a
 * standing activity -- the "pursuit" every order records even when it changed
 * nothing else. The engine advances all three day by day, and the player saw
 * none of it: after sending an order they heard nothing until something
 * happened, and could not tell a recruitment under way from one that had
 * stalled for want of money.
 *
 * One line each, in words, with at most the one number that matters. A line
 * that has stalled -- a milestone overdue, the money short of the next step
 * -- is marked as wanting the player's word.
 */

export interface UnderWayItem {
  readonly key: string;
  readonly kind: "order" | "project" | "march" | "delegated" | "audit" | "plot" | "pursuit";
  /** Only its sponsor may know of it: a spy sent, an audit opened quietly. */
  readonly secret?: boolean;
  /** What is being done: "Raising the First New Legion". */
  readonly label: string;
  /** Where it has got to: "Next: enrolment in Latium, in 18 days. 1,200 of 3,000 spent." */
  readonly detail: string;
  /** It has stalled and wants the player's word. */
  readonly stalled: boolean;
}

const OPEN: ReadonlySet<Project["status"]> = new Set(["proposed", "funded", "in_progress"]);

export function ordersUnderWay(
  world: WorldState,
  characterId: string | null,
  offices: readonly Office[] = [],
  clock?: ScenarioClock,
): readonly UnderWayItem[] {
  if (characterId === null) return [];
  const station: Station = buildStation({ world, characterId, offices });
  const governs = holdsPolityStanding(station);
  const today = world.elapsedStep;
  const when = (day: number): string => {
    const inDays = day - today;
    if (inDays <= 0) return "now";
    if (inDays === 1) return "tomorrow";
    if (inDays <= 60 || clock === undefined) return `in ${inDays} days`;
    return `on ${formatWorldDate({ day, minute: 0 }, clock)}`;
  };
  const money = (amount: number): string => Math.round(amount).toLocaleString("en-GB");
  const forceName = (id: string): string | null => world.material.forces.find((force) => force.id === id)?.name ?? null;
  const provinceName = (id: string): string | null => { const province = world.map.provinces.find((candidate) => candidate.id === id); return province?.settlements.find((settlement) => settlement.kind === "port")?.name ?? province?.name ?? null; };

  const items: UnderWayItem[] = [];
  // Assembly legs belong to the crossing they prepare, so one operation does
  // not crowd the desk with a march, a sailing and a crossing separately.
  const assemblyLegs = new Set(world.projects.filter((project) => OPEN.has(project.status) && project.kind === "crossing" && project.completionOutcome?.kind === "force_move").flatMap((crossing) => {
    const outcome = crossing.completionOutcome!;
    return world.projects.filter((leg) => leg.id !== crossing.id && OPEN.has(leg.status) && (leg.kind === "march" || leg.kind === "sailing") && leg.completionOutcome?.kind === "force_move" && leg.completionOutcome.provinceId === outcome.embarkProvinceId && (leg.completionOutcome.forceId === outcome.forceId || outcome.fleetIds?.includes(leg.completionOutcome.forceId ?? ""))).map((leg) => leg.id);
  }));

  for (const project of world.projects) {
    if (!OPEN.has(project.status) || assemblyLegs.has(project.id)) continue;
    const outcome = project.completionOutcome;
    const march = outcome?.kind === "force_move" && outcome.forceId !== null ? outcome : null;
    const sponsor = project.sponsorEntityRef;
    const yours = (sponsor.kind === "character" && sponsor.id === characterId)
      || (governs && sponsor.kind === "polity" && sponsor.id === station.polityId)
      || (march !== null && station.forceIds.has(march.forceId!));
    if (!yours) continue;

    if (march !== null) {
      const force = forceName(march.forceId!);
      const to = march.provinceId === null ? null : provinceName(march.provinceId);
      if (force === null) continue;
      items.push({
        key: `march:${project.id}`,
        kind: "march",
        label: project.kind === "sailing" || project.kind === "crossing" || project.kind === "military_transport"
          ? (to === null ? `The ${bare(force)} at sea` : `The ${bare(force)} being transported to ${to}`)
          : to === null ? `The ${bare(force)} on the march` : `The ${bare(force)} marching on ${to}`,
        detail: `${project.kind === "crossing" && world.projects.some((leg) => assemblyLegs.has(leg.id)) ? "The army and ships are assembling at their embarkation shore. " : ""}${project.targetCompletionStep === null ? "No one can say when it arrives." : `Expected ${when(project.targetCompletionStep)}.`}`,
        stalled: project.targetCompletionStep !== null && project.targetCompletionStep < today,
      });
      continue;
    }

    const pending = project.milestones
      .filter((milestone) => milestone.status === "pending")
      .map((milestone) => ({ milestone, due: project.startedAtStep + milestone.requiredAtElapsedOffset }))
      .sort((a, b) => a.due - b.due);
    const next = pending[0];
    const reservation = project.reservationId === null ? undefined
      : world.material.reservations.find((candidate) => candidate.id === project.reservationId);
    const overdue = next !== undefined && next.due < today;
    const short = next !== undefined && next.milestone.costAmount > 0
      && (projectFundingAvailable(world, project) < next.milestone.costAmount);

    const parts: string[] = [];
    // Who has it in hand, so the player can see that somebody does.
    const overseer = project.overseerCharacterId == null ? undefined : world.characters.find((character) => character.id === project.overseerCharacterId);
    if (overseer !== undefined && overseer.id !== characterId) parts.push(`In ${overseer.name}'s hands.`);
    if (next !== undefined) parts.push(overdue ? `${next.milestone.label}: overdue.` : `Next: ${lowerFirst(next.milestone.label)}, ${when(next.due)}.`);
    else if (project.targetCompletionStep !== null) parts.push(`Due to be finished ${when(project.targetCompletionStep)}.`);
    if (reservation !== undefined) parts.push(`${money(reservation.reservedAmount - reservation.remainingAmount)} of ${money(reservation.reservedAmount)} spent.`);
    if (short) parts.push("The available funding will not cover the next step.");

    items.push({
      key: `project:${project.id}`,
      kind: "project",
      label: project.label,
      detail: parts.join(" ") || "Under way.",
      stalled: overdue || short,
    });
  }

  // Each part of the player's orders that no project above already shows:
  // waiting on a vote, on a letter, on a man to take it up -- or stopped,
  // with the reason. The latest order's parts that came to nothing are here
  // too, so an order is never answered only in prose.
  const shown = new Set(items.map((item) => item.key.replace(/^(project|march):/, "")));
  const latest = [...world.orders].reverse().find((order) => order.actorCharacterId === characterId);
  for (const order of world.orders) {
    if (order.actorCharacterId !== characterId) continue;
    for (const [index, part] of order.parts.entries()) {
      if (part.closedAtStep !== null) continue;
      const status = orderPartStatus(world, part);
      const finished = status === "achieved" || status === "failed" || status === "refused" || status === "unanswered";
      if (finished && order !== latest) continue;
      if (status === "achieved" && part.note === null) continue;
      // Shown already, as its own work: a project above, or an audit, a plot or
      // a delegated order below.
      const listedBelow = (ref: { readonly kind: string; readonly id: string }): boolean =>
        (ref.kind === "audit" && world.audits.some((audit) => audit.id === ref.id && audit.status === "under_way"))
        || (ref.kind === "plot" && world.covertPlots.some((plot) => plot.id === ref.id && plot.outcome === null))
        || (ref.kind === "contract" && world.material.contracts.some((contract) => contract.id === ref.id && contract.status === "active"))
        || ref.kind === "order_attempt"
        || (ref.kind === "procedure" && world.material.politicalProcedures.some((procedure) => procedure.id === ref.id && procedure.outcome === "passed"));
      if (status !== "blocked" && status !== "failed" && status !== "authorized" && status !== "acknowledged" && part.note === null && part.workRefs.length > 0
        && part.workRefs.every((ref) => (ref.kind === "project" && shown.has(ref.id)) || listedBelow(ref) || ref.kind === "force" || ref.kind === "entity")) continue;
      const why = part.refusal ?? part.whyNot;
      const waiting = part.stages.filter((stage) => stage.status === "waiting").flatMap((stage) => stage.waitsOn).map((condition) => {
        switch (condition.kind) {
          case "force_at": return `${forceName(condition.forceId) ?? "the army"} to reach ${provinceName(condition.provinceId) ?? "its destination"}`;
          case "force_named": return `the ${condition.name} force to be raised`;
          case "transport_capacity": return "enough ships to carry the army";
          case "procedure_passed": return `the vote on ${world.material.politicalProcedures.find((procedure) => procedure.id === condition.procedureId)?.label ?? "the motion"}`;
          case "project_done": return `${world.projects.find((project) => project.id === condition.projectId)?.label ?? "the prerequisite work"} to finish`;
          case "funds": return `${money(condition.amount)} to be available`;
          case "letter_answered": return `${world.diplomacy.find((message) => message.id === condition.messageId)?.subject ?? "the letter"} to be ${condition.answer === "any" ? "answered" : condition.answer}`;
        }
      });
      const stateLabel = waiting.length > 0 ? `Waiting for ${[...new Set(waiting)].join(" and ")}` : upperFirst(orderPartLabel(status, part));
      items.push({
        key: `order:${order.id}:${index}`,
        kind: "order",
        label: part.said,
        detail: `${stateLabel}.${why === null || status === "achieved" ? "" : ` ${lastSentenceWithin(why, 320)}`}${part.note === null ? "" : ` ${upperFirst(part.note)}.`}`,
        stalled: status === "blocked" || status === "failed" || status === "refused" || status === "unanswered" || status === "authorized" || status === "acknowledged",
      });
    }
  }

  // Orders handed to others, and whether they have been taken up.
  for (const attempt of world.orderAttempts) {
    if (attempt.issuerRef.id !== characterId) continue;
    if (attempt.status !== "issued" && attempt.status !== "received" && attempt.status !== "delayed" && attempt.status !== "accepted") continue;
    const who = world.characters.find((character) => character.id === attempt.recipientRef.id)?.name ?? "Somebody";
    const work = world.orders.flatMap((order) => order.parts)
      .find((part) => part.workRefs.some((ref) => ref.kind === "order_attempt" && ref.id === attempt.id))
      ?.workRefs.filter((ref) => ref.kind !== "order_attempt").length ?? 0;
    const idleDays = attempt.decidedAtStep === null ? 0 : today - attempt.decidedAtStep;
    items.push({
      key: `delegated:${attempt.id}`,
      kind: "delegated",
      label: attempt.instruction || "An order",
      detail: attempt.status === "accepted"
        ? (work === 0 ? `${who} took it on${idleDays > 0 ? ` ${idleDays} days ago` : ""}, and nothing has been done about it yet.` : `${who} has it in hand: ${work} piece${work === 1 ? "" : "s"} of work set going.`)
        : attempt.status === "delayed" ? `${who} has put it off.` : `${who} has not yet answered.`,
      stalled: attempt.status === "accepted" && work === 0 && idleDays >= 20,
    });
  }

  // Books being gone through: those the player ordered, and his own.
  for (const audit of world.audits) {
    if (audit.status !== "under_way") continue;
    const ownBooks = audit.scope.kind === "household" && audit.scope.id === characterId;
    if (audit.orderedByCharacterId !== characterId && !ownBooks) continue;
    const auditor = world.characters.find((character) => character.id === audit.auditorCharacterId)?.name ?? "An auditor";
    const whose = audit.scope.kind === "household"
      ? (audit.scope.id === characterId ? "your own books" : `${world.characters.find((character) => character.id === audit.scope.id)?.name ?? "a household"}'s books`)
      : "the department's books";
    items.push({
      key: `audit:${audit.id}`,
      kind: "audit",
      label: `${auditor} going through ${whose}`,
      detail: `A finding is due ${when(audit.dueAtStep)}.`,
      stalled: audit.dueAtStep < today,
    });
  }

  /** Whose money it was, as he would say it. */
  const payerOf = (accountId: string | null): string => {
    if (accountId === null) return "";
    const account = world.material.accounts.find((candidate) => candidate.id === accountId);
    if (account === undefined) return "";
    if (account.owner.kind === "character" && account.owner.id === characterId) return " from your own purse";
    if (account.owner.kind === "polity") return ` from the ${world.map.polities.find((polity) => polity.id === account.owner.id)?.name ?? "state"}'s treasury`;
    return "";
  };
  // What the player has set going in secret. His to know, and nobody else's.
  for (const contract of world.material.contracts) {
    if (contract.status !== "active" || !["agent", "assassin", "mercenary", "envoy"].includes(contract.role)) continue;
    const account = world.material.accounts.find((candidate) => candidate.id === contract.employerAccountId);
    if (account?.owner.id !== characterId && !(governs && account?.owner.kind === "polity" && account.owner.id === station.polityId)) continue;
    const employee = world.characters.find((candidate) => candidate.id === contract.employeeCharacterId);
    items.push({ key: `contract:${contract.id}`, kind: "delegated", secret: contract.role === "agent" || contract.role === "assassin",
      label: contract.label, detail: `In ${employee?.name ?? "the contractor"}'s hands. ${money(contract.advance)} paid down; ${money(contract.monthlyPay)} a month.${contract.endsAtStep === null ? "" : ` Term ends ${when(contract.endsAtStep)}.`}`, stalled: employee === undefined || !employee.alive });
    if (contract.journey != null && contract.journey.arrivedAtStep === null) items[items.length - 1] = { ...items[items.length - 1]!, detail: `${items[items.length - 1]!.detail} Travelling; arrival ${when(contract.journey.arrivesAtStep)}.` };
  }

  for (const plot of world.covertPlots) {
    if (plot.sponsorCharacterId !== characterId || plot.outcome !== null) continue;
    const target = world.characters.find((character) => character.id === plot.targetCharacterId)?.name ?? "somebody";
    const agent = plot.agentCharacterId === null ? null : world.characters.find((character) => character.id === plot.agentCharacterId)?.name ?? null;
    items.push({
      key: `plot:${plot.id}`,
      kind: "plot",
      label: plot.kind === "espionage" ? `A spy set on ${target}` : `Something laid against ${target}`,
      detail: [
        agent === null ? null : `${agent} has it in hand.`,
        plot.spend > 0 ? `${money(plot.spend)} paid${payerOf(plot.fundingAccountId ?? null)}.` : null,
        `It comes to a head ${when(plot.resolvesAtStep)}.`,
      ].filter((part) => part !== null).join(" "),
      stalled: false,
      secret: true,
    });
  }

  // What an order set the player (or the power they speak for) to doing.
  for (const entity of world.genericEntities) {
    if (entity.kind !== "pursuit" || "retiredAtStep" in entity.attributes) continue;
    const owner = entity.ownerRef;
    const yours = owner !== null && ((owner.kind === "character" && owner.id === characterId)
      || (governs && owner.kind === "polity" && owner.id === station.polityId));
    if (!yours) continue;
    const since = entity.attributes.sinceDay;
    items.push({
      key: `pursuit:${entity.id}`,
      kind: "pursuit",
      label: entity.label,
      // Somebody's word for what he is doing is not work being done, unless
      // the world wrote it a rule that does something with it.
      detail: `${typeof since === "number" && clock !== undefined ? `Since ${formatWorldDate({ day: since, minute: 0 }, clock)}. ` : ""}${entity.mechanic === undefined ? "An intention only: nothing is being done about it." : "Going on by its own rule."}`,
      stalled: entity.mechanic === undefined,
    });
  }

  return items.sort((a, b) => Number(b.stalled) - Number(a.stalled) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));
}

const KIND_ORDER: Readonly<Record<UnderWayItem["kind"], number>> = { order: 0, project: 1, march: 2, delegated: 3, audit: 4, plot: 5, pursuit: 6 };
const bare = (name: string): string => name.replace(/^the\s+/i, "");
/** The reason in whole sentences, as much of it as fits. */
const lastSentenceWithin = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = cut.lastIndexOf(". ");
  return end > 0 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
};
const upperFirst = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toUpperCase()}${text.slice(1)}`);
const lowerFirst = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);
