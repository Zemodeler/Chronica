import {
  boundedId,
  isCombatDoctrine,
  refitDaysFor,
  type Doctrine,
  type DoctrineProposal,
  type FactProposalDraft,
  type Force,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";

/**
 * What an order to rest, rouse or work an army is worth, by its size and not
 * its figure. `moraleBpsDelta` was a number the model wrote and the engine
 * added, so "rest the army" could make it as steady as a veteran legion in a
 * day; now a small change is a small change, a large one a large one, and the
 * engine says what each is.
 */
export function bandedShift(delta: number | undefined): number {
  if (delta === undefined || delta === 0) return 0;
  const size = Math.abs(delta);
  return Math.sign(delta) * (size <= 800 ? 500 : size <= 2_000 ? 1_200 : 2_000);
}

type ForceModify = Extract<WorldDelta, { op: "force_modify" }>;

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/(^-|-$)/gu, "").slice(0, 40) || "practice";

/**
 * Who pays for an army's own practice: whoever pays the army, else the man
 * who commands it. A doctrine whose keep nobody can pay falls into disuse
 * (`ranks.ts`).
 */
function practicePayer(world: WorldState, force: Force): string | null {
  const obligation = force.payObligationId === null ? undefined : world.material.obligations.find((candidate) => candidate.id === force.payObligationId);
  if (obligation !== undefined) return obligation.payerAccountId;
  const commander = world.characters.find((character) => character.id === force.commanderCharacterId);
  return commander?.personalAccountId ?? null;
}

/** A doctrine made from what an order or a law says of it. */
export function doctrineFrom(proposal: DoctrineProposal, input: {
  readonly id: string;
  readonly origin: Doctrine["origin"];
  readonly polityId: string;
  readonly forceId: string | null;
  readonly upkeepAccountId: string | null;
  readonly atStep: number;
  readonly byCharacterId: string | null;
}): Doctrine {
  return {
    id: input.id,
    label: proposal.label,
    description: proposal.description,
    origin: input.origin,
    polityId: input.polityId,
    ...(proposal.lines === undefined && proposal.kinds === undefined ? {} : {
      appliesTo: { ...(proposal.lines === undefined ? {} : { lines: proposal.lines }), ...(proposal.kinds === undefined ? {} : { categoryIds: proposal.kinds }) },
    }),
    effects: proposal.effects,
    upkeepAccountId: input.upkeepAccountId,
    adoptedAtStep: input.atStep,
    adoptedByCharacterId: input.byCharacterId,
    forceId: input.forceId,
    settledThroughStep: null,
    lapsedAtStep: null,
  };
}

/**
 * Formations a new way of fighting reaches are refitted before they fight by
 * it: drilling the new way for as long as the change is large. A doctrine that
 * moves nothing a battle reads needs no refit.
 */
export function refitFor(force: Force, doctrine: Doctrine, atStep: number): Force {
  if (!isCombatDoctrine(doctrine) || (force.formations ?? []).length === 0) return force;
  const until = atStep + refitDaysFor(doctrine.effects);
  const scope = doctrine.appliesTo;
  return {
    ...force,
    formations: (force.formations ?? []).map((formation) => {
      const row = force.personnel.find((candidate) => candidate.formationId === formation.id);
      const reaches = scope === undefined || (
        (scope.formationIds === undefined || scope.formationIds.includes(formation.templateId))
        && (scope.lines === undefined || scope.lines.includes(formation.line))
        && (scope.categoryIds === undefined || (row !== undefined && scope.categoryIds.includes(row.categoryId))));
      if (!reaches) return formation;
      return { ...formation, refitUntilStep: Math.max(formation.refitUntilStep ?? 0, until) };
    }),
  };
}

export function practiseInArmy(
  world: WorldState,
  force: Force,
  delta: ForceModify,
  resolve: (ref: string) => string | undefined,
  atStep: number,
  actorId: string | null,
): { readonly force: Force; readonly doctrines: WorldState["doctrines"]; readonly facts: FactProposalDraft[] } {
  const facts: FactProposalDraft[] = [];
  let next = force;
  let doctrines = world.doctrines;

  // Drill: the whole army, or one formation of it on its officer's word.
  if (delta.drilling !== undefined) {
    const formationId = delta.formationRef === undefined ? null : resolve(delta.formationRef) ?? delta.formationRef;
    if (formationId !== null && (next.formations ?? []).some((formation) => formation.id === formationId)) {
      next = { ...next, formations: (next.formations ?? []).map((formation) => (formation.id === formationId ? { ...formation, drilling: delta.drilling } : formation)) };
    } else {
      next = { ...next, drilling: delta.drilling };
    }
  }

  if (delta.doctrine !== undefined) {
    const id = boundedId(force.id, "practice", slug(delta.doctrine.label));
    const doctrine = doctrineFrom(delta.doctrine, {
      id, origin: "practice", polityId: force.polityId, forceId: force.id,
      upkeepAccountId: practicePayer(world, force), atStep, byCharacterId: actorId,
    });
    doctrines = [...doctrines.filter((candidate) => candidate.id !== id), doctrine].slice(-400);
    next = refitFor(next, doctrine, atStep);
    facts.push({
      localId: `practice_${force.id}`.slice(0, 60),
      kind: "army_practice",
      summary: `${force.name} begins to train in a new way: ${doctrine.label}. ${doctrine.description}`.slice(0, 600),
      affectedRefs: [{ kind: "force", id: force.id }, { kind: "polity", id: force.polityId }],
      visibility: "polity",
      discoveryState: "polity",
      knowableInDays: 0,
      significance: 45,
    });
  }

  if (delta.dropDoctrineRef !== undefined) {
    const id = resolve(delta.dropDoctrineRef) ?? delta.dropDoctrineRef;
    // An army can give up what it took up itself; what the law brought in
    // stays until the law takes it away.
    doctrines = doctrines.map((candidate) => (candidate.id === id && candidate.forceId === force.id && candidate.lapsedAtStep === null ? { ...candidate, lapsedAtStep: atStep } : candidate));
  }
  return { force: next, doctrines, facts };
}
