import "server-only";
import {
  advanceWorldMatters,
  createPressure,
  evaluateMatterDisposition,
  matterPressureId,
  resolvePressure,
  type Fact,
  type FactualEvent,
  type WorldInstant,
  type WorldMatter,
  type WorldState,
} from "@chronica/shared";

/**
 * Server-side wrapper around `advanceWorldMatters` (docs/plans/
 * ai-world-matters-runtime.md, Phase 1): the pure lifecycle function lives
 * in `packages/shared` and knows nothing about `CharacterPressure` --
 * `world-development-scheduler.ts`'s old `advanceWorldDevelopments` did both
 * in one function, but pressures are presentation/motivation bookkeeping,
 * not core matter identity, so this phase splits them the same way the rest
 * of the codebase splits pure `packages/shared` logic from the
 * `"server-only"` web layer.
 *
 * Phase 1 caveat: a freshly detected matter has no `responsible` offer yet
 * (actor routing is Phase 2's job -- see `matters/detectors/*.ts`), so this
 * only creates/refreshes/resolves a pressure for a matter that already has
 * one -- in practice, today, a matter migrated from a `WorldDevelopment`
 * via `upgradeWorldDevelopmentsToMatters` (which seeds exactly one
 * `responsible` offer). A brand-new matter with no offer yet is scheduled
 * and reviewed like any other, just without a pressure until Phase 2 wires
 * up actor selection.
 */
const PRESSURE_KIND = {
  scarcity: "political_danger",
  reconstruction: "political_danger",
  civic: "political_danger",
  war_burden: "military_emergency",
  household: "family_obligation",
} as const;

export interface AdvanceMatterScheduleResult {
  readonly world: WorldState;
  readonly events: readonly Omit<FactualEvent, "id">[];
}

function primaryResponsibleCharacterId(matter: WorldMatter): string | null {
  const offer = matter.offers.find((o) => o.role === "responsible" && o.actorRef.kind === "character");
  return offer ? offer.actorRef.id : null;
}

function isTerminal(status: WorldMatter["status"]): boolean {
  return status === "addressed" || status === "cancelled";
}

export function advanceMatterSchedule(world: WorldState, atInstant: WorldInstant, atStep: number): AdvanceMatterScheduleResult {
  const advanced = advanceWorldMatters(world, atInstant, atStep);
  let next = advanced.world;

  // Disposition (docs/plans/ai-world-matters-runtime.md, Phase 3): every
  // predicate in `COMPLETION_PREDICATES` reads canonical state directly
  // (`world.material.transactions`, `.obligations`, `.officeSeats`,
  // `.forces`), so this still detects a real payment/term-change/supply
  // extension without needing the turn's other facts -- only the evidence
  // ids attached to the disposition entry are poorer here (falling back to
  // the transaction's own id) than at `pipeline.ts`'s post-GM-session pass,
  // which has this turn's real `Fact[]` in hand and re-runs this exact
  // function with them before Chronicle construction.
  const noTurnFactsAtThisCallSite: readonly Fact[] = [];
  next = { ...next, worldMatters: [...evaluateMatterDisposition(next, next.worldMatters ?? [], noTurnFactsAtThisCallSite)] };

  const mergePressure = (update: ReturnType<typeof resolvePressure>) => {
    next = { ...next, characters: [...update.characters], characterPressures: [...update.characterPressures] };
  };

  const touched = (next.worldMatters ?? []).filter((m) => m.lastReviewedStep === atStep);
  const updatedMatters = new Map<string, WorldMatter>();

  for (const matter of touched) {
    const characterId = primaryResponsibleCharacterId(matter);
    if (characterId === null) continue; // No responsible offer yet -- see module comment.
    const pressureId = matter.pressureId ?? matterPressureId(matter.id);

    if (isTerminal(matter.status)) {
      mergePressure(resolvePressure(next, pressureId));
    } else {
      // Same "resolve, drop, recreate" replace pattern the old scheduler
      // used, so the pressure id stays unique and its content stays in
      // sync with the matter's own current urgency/summary.
      mergePressure(resolvePressure(next, pressureId));
      next = { ...next, characterPressures: next.characterPressures.filter((p) => p.id !== pressureId) };
      const cadenceSteps = Math.max(1, matter.nextReviewStep - atStep);
      mergePressure(
        createPressure(next, {
          id: pressureId,
          characterId,
          kind: PRESSURE_KIND[matter.kind as keyof typeof PRESSURE_KIND] ?? "political_danger",
          intensity: matter.urgency,
          label: matter.summary.slice(0, 200),
          atStep,
          sourceEventId: null,
          reviewInSteps: cadenceSteps + 1,
          expiresInSteps: null,
          visibility: matter.visibility,
        }),
      );
    }
    if (matter.pressureId !== pressureId) updatedMatters.set(matter.id, { ...matter, pressureId });
  }

  if (updatedMatters.size > 0) {
    next = { ...next, worldMatters: (next.worldMatters ?? []).map((m) => updatedMatters.get(m.id) ?? m) };
  }

  return { world: next, events: advanced.events };
}
