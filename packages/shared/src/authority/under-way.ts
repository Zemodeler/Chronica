import { buildStation, holdsPolityStanding, type Station } from "./station";
import type { Office } from "../characters/character";
import type { WorldState } from "../world/world-state";
import type { Project } from "../world/project";
import { formatWorldDate, type ScenarioClock } from "../world/clock";

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
  readonly kind: "project" | "march" | "pursuit";
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
  const provinceName = (id: string): string | null => world.map.provinces.find((province) => province.id === id)?.name ?? null;

  const items: UnderWayItem[] = [];

  for (const project of world.projects) {
    if (!OPEN.has(project.status)) continue;
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
        label: to === null ? `The ${bare(force)} on the march` : `The ${bare(force)} marching on ${to}`,
        detail: project.targetCompletionStep === null ? "No one can say when it arrives." : `Expected ${when(project.targetCompletionStep)}.`,
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
      && (reservation === undefined || reservation.status !== "active" || reservation.remainingAmount < next.milestone.costAmount);

    const parts: string[] = [];
    // Who has it in hand, so the player can see that somebody does.
    const overseer = project.overseerCharacterId == null ? undefined : world.characters.find((character) => character.id === project.overseerCharacterId);
    if (overseer !== undefined && overseer.id !== characterId) parts.push(`In ${overseer.name}'s hands.`);
    if (next !== undefined) parts.push(overdue ? `${next.milestone.label}: overdue.` : `Next: ${lowerFirst(next.milestone.label)}, ${when(next.due)}.`);
    else if (project.targetCompletionStep !== null) parts.push(`Due to be finished ${when(project.targetCompletionStep)}.`);
    if (reservation !== undefined) parts.push(`${money(reservation.reservedAmount - reservation.remainingAmount)} of ${money(reservation.reservedAmount)} spent.`);
    if (short) parts.push("The money set aside will not cover the next step.");

    items.push({
      key: `project:${project.id}`,
      kind: "project",
      label: project.label,
      detail: parts.join(" ") || "Under way.",
      stalled: overdue || short,
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
      detail: typeof since === "number" && clock !== undefined ? `Since ${formatWorldDate({ day: since, minute: 0 }, clock)}.` : "Under way.",
      stalled: false,
    });
  }

  return items.sort((a, b) => Number(b.stalled) - Number(a.stalled) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.label.localeCompare(b.label));
}

const KIND_ORDER: Readonly<Record<UnderWayItem["kind"], number>> = { project: 0, march: 1, pursuit: 2 };
const bare = (name: string): string => name.replace(/^the\s+/i, "");
const lowerFirst = (text: string): string => (text.length === 0 ? text : `${text.charAt(0).toLowerCase()}${text.slice(1)}`);
