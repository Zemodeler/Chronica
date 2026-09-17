import {
  DELTA_AUTHORITY_DOMAIN,
  adjustPolityLegitimacy,
  ensureProvinceMaterial,
  WorldStateSchema,
  buildAuthorityIndex,
  checkAuthority,
  CharacterSocialEventSchema,
  applySocialEvents,
  createCanonicalNpc,
  decideOrderAttempt,
  findWorldReferenceViolations,
  receiveOrderAttempt,
  resolveRef,
  type AuthorityCheckResult,
  type AuthorityIndex,
  type AuthorityPower,
  type AuthorityScope,
  type FactProposal,
  type OrderPartyRef,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import type { ApplyContext, ApplyResult, AppliedDelta, AuthorityBreach, RejectedDelta } from "./context";

/**
 * Applies a validated batch of deltas to the world.
 *
 * This is the half of the engine the model does not own. Everything above it
 * decides *what should happen*; this decides whether the books still balance
 * afterwards, and it is the only code that writes `WorldState`.
 *
 * Three rules shape it:
 *
 *  1. **Rejection is friction, not failure** (VISION §8). A delta that cannot
 *     apply comes back in `rejected` with a reason the caller turns into a
 *     fact. The rest of the batch still applies, so an over-ambitious order
 *     partly succeeds instead of being refused.
 *  2. **Lack of authority does not block an act** (VISION §12). It is recorded
 *     as a breach and applied anyway -- that is what makes coups, embezzlement
 *     and unauthorized wars expressible at all.
 *  3. **A delta may not introduce a dangling reference.** Checked per delta and
 *     rolled back individually, so one bad reference costs one delta rather
 *     than the batch.
 */

class DeltaRejection extends Error {
  constructor(message: string, readonly kind: "world" | "reference") {
    super(message);
  }
}

function reject(reason: string, kind: "world" | "reference" = "world"): never {
  throw new DeltaRejection(reason, kind);
}

/** Which scope a delta acts over, so authority is judged against the thing itself rather than the whole polity. */
function scopeOf(delta: WorldDelta, world: WorldState, resolve: (ref: string) => string | undefined, actorRef: OrderPartyRef): AuthorityScope {
  // Anything without a scope of its own is judged in the actor's own polity.
  // Reaching for the first polity in the world instead -- as this once did --
  // judged a Roman consul's every unscoped act against Carthage, and recorded
  // a breach for each one.
  const actorPolityId = actorRef.kind === "character"
    ? world.characters.find((character) => character.id === actorRef.id)?.polityId ?? null
    : actorRef.kind === "polity" ? actorRef.id : null;
  const polityFallback: AuthorityScope = { kind: "polity", id: actorPolityId ?? world.map.polities[0]?.id ?? "unknown" };
  switch (delta.op) {
    case "money_transfer":
      return { kind: "account", id: resolve(delta.fromAccountRef) ?? delta.fromAccountRef };
    case "income_source_upsert":
      return { kind: "account", id: resolve(delta.beneficiaryAccountRef) ?? delta.beneficiaryAccountRef };
    case "obligation_upsert":
      return { kind: "account", id: resolve(delta.payerAccountRef) ?? delta.payerAccountRef };
    case "loan_open":
      return { kind: "account", id: resolve(delta.borrowerAccountRef) ?? delta.borrowerAccountRef };
    case "force_create":
      return { kind: "polity", id: delta.polityId };
    case "force_modify":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    case "polity_stance_shift":
      return { kind: "polity", id: delta.polityId };
    case "polity_outlook_set":
      return { kind: "polity", id: delta.polityId };
    case "legitimacy_shift":
      return { kind: delta.target === "polity" ? "polity" : "institution", id: delta.targetId };
    case "province_material_shift":
      return { kind: "province", id: delta.provinceId };
    case "political_procedure_open":
      return delta.institutionRef === null
        ? polityFallback
        : { kind: "institution", id: resolve(delta.institutionRef) ?? delta.institutionRef };
    case "character_create":
      return { kind: "polity", id: delta.polityId };
    default:
      return polityFallback;
  }
}

const POWER_BY_OP: Record<WorldDelta["op"], AuthorityPower> = {
  money_transfer: "spend",
  income_source_upsert: "spend",
  obligation_upsert: "spend",
  project_create: "propose",
  project_milestone_update: "propose",
  force_create: "command",
  force_modify: "command",
  character_create: "appoint",
  character_intent_set: "propose",
  social_events: "propose",
  generic_entity_create: "propose",
  generic_entity_update: "propose",
  loan_open: "spend",
  loan_settle: "spend",
  authority_grant_upsert: "appoint",
  order_attempt_decide: "command",
  polity_stance_shift: "negotiate",
  polity_outlook_set: "propose",
  legitimacy_shift: "propose",
  province_material_shift: "propose",
  political_procedure_open: "propose",
  political_support_set: "propose",
  political_procedure_resolve: "override",
  holding_transfer: "punish",
};

export function applyDeltas(world: WorldState, deltas: readonly WorldDelta[], context: ApplyContext): ApplyResult {
  const assignedIds = new Map<string, string>();
  const applied: AppliedDelta[] = [];
  const rejected: RejectedDelta[] = [];
  const breaches: AuthorityBreach[] = [];
  const factProposals: FactProposal[] = [];

  const resolve = (ref: string): string | undefined => resolveRef(ref, assignedIds);
  let current = world;
  let violations = new Set(findWorldReferenceViolations(world));

  const authorityIndex: AuthorityIndex = buildAuthorityIndex(
    { officeSeats: world.material.officeSeats, forces: world.material.forces, accounts: world.material.accounts },
    world.authorityGrants,
    context.offices,
    world.elapsedStep,
  );

  for (const delta of deltas) {
    const previous = current;
    // Buffered per delta: a delta that is rolled back must not leave the world
    // asserting consequences that never happened.
    const emitted: FactProposal[] = [];
    const emitFact = (fact: FactProposal): void => {
      emitted.push(fact);
    };
    let authority: AuthorityCheckResult;
    try {
      authority = checkAuthority(authorityIndex, {
        holder: context.actorRef,
        domain: DELTA_AUTHORITY_DOMAIN[delta.op],
        scope: scopeOf(delta, current, resolve, context.actorRef),
        power: POWER_BY_OP[delta.op],
      });
      current = applyOne(current, delta, context, assignedIds, resolve, emitFact);
    } catch (error) {
      if (error instanceof DeltaRejection) {
        rejected.push({ delta, reason: error.message, kind: error.kind });
        current = previous;
        continue;
      }
      throw error;
    }

    const afterViolations = findWorldReferenceViolations(current);
    const introduced = afterViolations.filter((violation) => !violations.has(violation));
    if (introduced.length > 0) {
      rejected.push({ delta, reason: `Would leave a reference to something that does not exist: ${introduced[0]}.`, kind: "reference" });
      current = previous;
      continue;
    }
    violations = new Set(afterViolations);

    applied.push({ delta, authority });
    factProposals.push(...emitted);
    if (!authority.authorized) breaches.push({ delta, reason: authority.reason });
  }

  // One structural check at the end rather than per delta: the per-delta guard
  // above already catches the realistic failure, and re-parsing a whole world
  // fourteen times over is not worth the marginal safety.
  const parsed = WorldStateSchema.safeParse(current);
  if (!parsed.success) {
    return {
      world,
      applied: [],
      breaches: [],
      rejected: deltas.map((delta) => ({
        delta,
        // The path matters more than the message: "Too small: expected array to
        // have >=1 items" names nothing on its own.
        reason: `The batch would have left the world invalid: ${describeIssue(parsed.error.issues[0])}.`,
        kind: "reference" as const,
      })),
      factProposals: [],
      assignedIds: new Map(),
    };
  }

  return { world: parsed.data, applied, rejected, breaches, factProposals, assignedIds };
}

/** Basis points never leave 0..10 000, and the schema refuses anything that does. */
function clampBps(value: number): number {
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

/** The signed -100..100 score every political cause is weighed on. */
function clampScore(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

/** A Zod issue as something a person can act on: where it was, then what was wrong. */
function describeIssue(issue: { path: PropertyKey[]; message: string } | undefined): string {
  if (issue === undefined) return "unknown";
  const where = issue.path.map(String).join(".");
  return where.length === 0 ? issue.message : `${where}: ${issue.message}`;
}

function applyOne(
  world: WorldState,
  delta: WorldDelta,
  context: ApplyContext,
  assignedIds: Map<string, string>,
  resolve: (ref: string) => string | undefined,
  // Unused until an act has consequences the model may not author -- battle
  // casualties are the first. The channel exists here so those arrive as facts
  // rather than as silent state.
  _emitFact: (fact: FactProposal) => void,
): WorldState {
  const required = (ref: string, label: string): string => {
    const resolved = resolve(ref);
    if (resolved === undefined) reject(`${label} refers to "${ref}", which nothing in this batch created.`, "reference");
    return resolved;
  };
  const mint = (prefix: string, localId: string | undefined): string => {
    const id = context.ids.next(prefix);
    if (localId !== undefined) assignedIds.set(localId, id);
    return id;
  };
  const atStep = world.elapsedStep;

  switch (delta.op) {
    case "money_transfer": {
      const fromId = required(delta.fromAccountRef, "The paying account");
      const from = world.material.accounts.find((account) => account.id === fromId);
      if (from === undefined) reject(`No account "${fromId}" exists to pay from.`, "reference");
      if (from.balance < delta.amount) {
        reject(`Account "${fromId}" holds ${from.balance}, which cannot cover ${delta.amount}.`);
      }
      const toId = delta.toAccountRef === null ? null : required(delta.toAccountRef, "The receiving account");
      if (toId !== null && !world.material.accounts.some((account) => account.id === toId)) {
        reject(`No account "${toId}" exists to receive payment.`, "reference");
      }
      const accounts = world.material.accounts.map((account) => {
        if (account.id === fromId) return { ...account, balance: account.balance - delta.amount };
        if (toId !== null && account.id === toId) return { ...account, balance: account.balance + delta.amount };
        return account;
      });
      return { ...world, material: { ...world.material, accounts } };
    }

    case "income_source_upsert": {
      const beneficiaryId = required(delta.beneficiaryAccountRef, "The receiving account");
      if (!world.material.accounts.some((account) => account.id === beneficiaryId)) {
        reject(`No account "${beneficiaryId}" exists to receive this income.`, "reference");
      }
      const existingId = delta.incomeSourceRef === null ? null : required(delta.incomeSourceRef, "The income source");
      const base = {
        kind: delta.kind,
        label: delta.label,
        beneficiaryAccountId: beneficiaryId,
        originKind: "polity" as const,
        originId: beneficiaryId,
        amount: delta.amount,
        cadenceSteps: delta.cadenceDays,
        nextDueStep: atStep + delta.cadenceDays,
        collectionRateBps: delta.collectionRateBps ?? 10_000,
        counterpartyPolityId: delta.counterpartyPolityId,
        active: delta.active,
      };
      if (existingId !== null) {
        if (!world.material.incomeSources.some((source) => source.id === existingId)) reject(`No income source "${existingId}" exists to change.`, "reference");
        return {
          ...world,
          material: {
            ...world.material,
            incomeSources: world.material.incomeSources.map((source) => (source.id === existingId ? { ...source, ...base } : source)),
          },
        };
      }
      const id = mint("income", delta.localId);
      return { ...world, material: { ...world.material, incomeSources: [...world.material.incomeSources, { id, ...base }] } };
    }

    case "obligation_upsert": {
      const payerId = required(delta.payerAccountRef, "The paying account");
      if (!world.material.accounts.some((account) => account.id === payerId)) reject(`No account "${payerId}" exists to carry this obligation.`, "reference");
      const recipientId = delta.recipientAccountRef === null ? undefined : required(delta.recipientAccountRef, "The receiving account");
      const base = {
        kind: delta.kind,
        label: delta.label,
        payerAccountId: payerId,
        ...(recipientId === undefined ? {} : { recipientAccountId: recipientId }),
        amount: delta.amount,
        cadenceSteps: delta.cadenceDays,
        nextDueStep: atStep + delta.cadenceDays,
        priority: delta.priority,
        arrears: 0,
        missedPeriods: 0,
        active: delta.active,
      };
      const existingId = delta.obligationRef === null ? null : required(delta.obligationRef, "The obligation");
      if (existingId !== null) {
        if (!world.material.obligations.some((obligation) => obligation.id === existingId)) reject(`No obligation "${existingId}" exists to change.`, "reference");
        return {
          ...world,
          material: {
            ...world.material,
            obligations: world.material.obligations.map((obligation) => (obligation.id === existingId ? { ...obligation, ...base } : obligation)),
          },
        };
      }
      const id = mint("obligation", delta.localId);
      return { ...world, material: { ...world.material, obligations: [...world.material.obligations, { id, ...base }] } };
    }

    case "project_create": {
      const id = mint("project", delta.localId);
      // Resolved here rather than at completion: the people and accounts an
      // outcome names exist now, and a reference that has gone stale by the
      // time the last milestone falls should fail loudly at proposal time.
      const outcome = delta.completionOutcome;
      const completionOutcome = outcome === null
        ? null
        : {
          kind: outcome.kind,
          label: outcome.label,
          amount: outcome.amount,
          provinceId: outcome.provinceId,
          polityId: outcome.polityId,
          commanderCharacterId: outcome.commanderCharacterRef === null ? null : required(outcome.commanderCharacterRef, "The commander this project is to raise a force for"),
          beneficiaryAccountId: outcome.beneficiaryAccountRef === null ? null : required(outcome.beneficiaryAccountRef, "The account this project is to pay into"),
          cadenceDays: outcome.cadenceDays,
        };
      const fundingId = delta.fundingAccountRef === null ? null : required(delta.fundingAccountRef, "The funding account");
      if (fundingId !== null && !world.material.accounts.some((account) => account.id === fundingId)) {
        reject(`No account "${fundingId}" exists to fund this project.`, "reference");
      }
      const milestones = delta.milestones.map((milestone, index) => ({
        id: `${id}-m${index + 1}`,
        label: milestone.label,
        requiredAtElapsedOffset: milestone.dueInDays,
        costAmount: milestone.costAmount,
        status: "pending" as const,
        completedAtStep: null,
      }));
      const project = {
        id,
        kind: delta.kind,
        sponsorEntityRef: delta.sponsorRef,
        label: delta.label,
        status: "in_progress" as const,
        reservationId: null,
        milestones,
        completionOutcome,
        linkedEntityIds: [],
        startedAtStep: atStep,
        targetCompletionStep: atStep + Math.max(...delta.milestones.map((milestone) => milestone.dueInDays)),
        completedAtStep: null,
        provenanceEventIds: [],
      };
      return { ...world, projects: [...world.projects, project] };
    }

    case "project_milestone_update": {
      const projectId = required(delta.projectRef, "The project");
      const project = world.projects.find((candidate) => candidate.id === projectId);
      if (project === undefined) reject(`No project "${projectId}" exists.`, "reference");
      if (!project.milestones.some((milestone) => milestone.id === delta.milestoneId)) {
        reject(`Project "${projectId}" has no milestone "${delta.milestoneId}".`, "reference");
      }
      const milestones = project.milestones.map((milestone) =>
        milestone.id === delta.milestoneId ? { ...milestone, status: delta.status, completedAtStep: atStep } : milestone,
      );
      const allDone = milestones.every((milestone) => milestone.status !== "pending");
      const updated = { ...project, milestones, status: allDone ? ("completed" as const) : project.status, completedAtStep: allDone ? atStep : null };
      return { ...world, projects: world.projects.map((candidate) => (candidate.id === projectId ? updated : candidate)) };
    }

    case "force_create": {
      const commanderId = required(delta.commanderCharacterRef, "The commander");
      const controllerId = required(delta.controllerCharacterRef, "The controller");
      if (!world.characters.some((character) => character.id === commanderId)) reject(`No character "${commanderId}" exists to command this force.`, "reference");
      if (!world.map.provinces.some((province) => province.id === delta.locationId)) reject(`No province "${delta.locationId}" exists to raise this force in.`, "reference");
      const id = mint("force", delta.localId);
      const force = {
        id,
        name: delta.name,
        polityId: delta.polityId,
        commanderCharacterId: commanderId,
        controllerCharacterId: controllerId,
        locationId: delta.locationId,
        positionId: null,
        authorizedStrength: delta.authorizedStrength,
        personnel: [{ categoryId: "infantry", label: "Infantry", fit: delta.authorizedStrength, unavailable: [] }],
        moraleBps: 6_000,
        cohesionBps: 5_000,
        fatigueBps: 0,
        provisionStatus: "provisioned" as const,
        provisionedThroughStep: atStep + 30,
        payObligationId: null,
        payArrearsPeriods: 0,
        history: [],
      };
      return { ...world, material: { ...world.material, forces: [...world.material.forces, force] } };
    }

    case "force_modify": {
      const forceId = required(delta.forceRef, "The force");
      const force = world.material.forces.find((candidate) => candidate.id === forceId);
      if (force === undefined) reject(`No force "${forceId}" exists.`, "reference");
      if (delta.locationId !== undefined && !world.map.provinces.some((province) => province.id === delta.locationId)) {
        reject(`No province "${delta.locationId}" exists to move this force to.`, "reference");
      }
      const commanderId = delta.commanderCharacterRef === undefined ? undefined : required(delta.commanderCharacterRef, "The commander");
      if (commanderId !== undefined && !world.characters.some((character) => character.id === commanderId)) {
        reject(`No character "${commanderId}" exists to take command.`, "reference");
      }
      const strength = Math.max(0, force.authorizedStrength + (delta.authorizedStrengthDelta ?? 0));
      const updated = {
        ...force,
        ...(delta.locationId === undefined ? {} : { locationId: delta.locationId }),
        ...(commanderId === undefined ? {} : { commanderCharacterId: commanderId }),
        ...(delta.provisionStatus === undefined ? {} : { provisionStatus: delta.provisionStatus }),
        authorizedStrength: Math.max(1, strength),
        moraleBps: Math.min(10_000, Math.max(0, force.moraleBps + (delta.moraleBpsDelta ?? 0))),
      };
      return { ...world, material: { ...world.material, forces: world.material.forces.map((candidate) => (candidate.id === forceId ? updated : candidate)) } };
    }

    case "character_create": {
      const provinceId = delta.provinceId ?? world.map.provinces[0]?.id;
      if (provinceId === undefined) reject("The world has no province to place a new character in.");
      const id = mint("character", delta.localId);
      const created = createCanonicalNpc(world, {
        characterId: id,
        name: delta.name,
        locationProvinceId: provinceId,
        polityId: delta.polityId,
        officeId: null,
        createdAtStep: atStep,
        creationReason: delta.generatedBecause,
      });
      if (created === null) reject(`Could not create "${delta.name}" at province "${provinceId}".`);
      const withTraits = created.world.characters.map((character) =>
        character.id === id ? { ...character, traits: delta.traits.slice(0, 8) } : character,
      );
      return { ...created.world, characters: withTraits };
    }

    case "character_intent_set": {
      const actorId = required(delta.actorCharacterRef, "The acting character");
      if (!world.characters.some((character) => character.id === actorId)) reject(`No character "${actorId}" exists to hold this intent.`, "reference");
      const targetIds = delta.targetRefs.map((ref) => required(ref, "An intent target"));
      const intent = {
        id: context.ids.next("intent"),
        actorCharacterId: actorId,
        sourceGoalId: null,
        sourcePlotId: null,
        sourceCommitmentId: null,
        actionType: delta.actionType,
        targetIds,
        rationale: delta.rationale,
        prerequisites: [],
        intendedWorkflowIds: [],
        priority: delta.priority,
        status: "proposed" as const,
        createdAtStep: atStep,
        reviewedAtStep: null,
        expiresAtStep: null,
        visibility: delta.visibility,
        sourceEventIds: [],
        resolutionReason: null,
      };
      return { ...world, characterIntents: [...world.characterIntents, intent] };
    }

    case "polity_stance_shift": {
      if (delta.polityId === delta.towardPolityId) reject("A polity holds no stance toward itself.");
      const known = new Set(world.map.polities.map((polity) => polity.id));
      if (!known.has(delta.polityId) || !known.has(delta.towardPolityId)) reject("A stance must be between two polities that exist.");
      const existing = world.polityStances.find((stance) => stance.polityId === delta.polityId && stance.towardPolityId === delta.towardPolityId);
      const clamp = (value: number) => Math.max(-100, Math.min(100, value));
      if (existing === undefined) {
        return {
          ...world,
          polityStances: [
            ...world.polityStances,
            { polityId: delta.polityId, towardPolityId: delta.towardPolityId, trustScore: clamp(delta.trustDelta), lastShiftReason: delta.reason, lastShiftAtStep: atStep },
          ],
        };
      }
      return {
        ...world,
        polityStances: world.polityStances.map((stance) =>
          stance === existing
            ? { ...stance, trustScore: clamp(stance.trustScore + delta.trustDelta), lastShiftReason: delta.reason, lastShiftAtStep: atStep }
            : stance,
        ),
      };
    }

    case "polity_outlook_set": {
      if (!world.map.polities.some((polity) => polity.id === delta.polityId)) {
        reject(`No polity "${delta.polityId}" exists to hold an outlook.`, "reference");
      }
      const outlook = {
        polityId: delta.polityId,
        primaryObjective: delta.primaryObjective,
        concerns: delta.concerns,
        intentions: delta.intentions,
        riskTolerance: delta.riskTolerance,
        updatedAtStep: atStep,
        lastChangeReason: delta.reason,
      };
      // A country holds one outlook at a time. Keeping the old one beside the
      // new would leave the world unable to say what it currently wants.
      const existing = world.polityOutlooks.some((candidate) => candidate.polityId === delta.polityId);
      return {
        ...world,
        polityOutlooks: existing
          ? world.polityOutlooks.map((candidate) => (candidate.polityId === delta.polityId ? outlook : candidate))
          : [...world.polityOutlooks, outlook],
      };
    }

    case "legitimacy_shift": {
      if (delta.target === "polity") {
        if (!world.map.polities.some((polity) => polity.id === delta.targetId)) {
          reject(`No polity "${delta.targetId}" exists to gain or lose standing.`, "reference");
        }
        // The shared helper already creates the record on first use, bounds the
        // result and records the cause. Reimplementing that here is how the two
        // would drift apart.
        const adjusted = adjustPolityLegitimacy(
          world.material.polityLegitimacy,
          delta.targetId,
          delta.legitimacyBpsDelta,
          delta.causeLabel,
          context.ids.next("cause"),
        );
        const confidenceDelta = delta.institutionalConfidenceBpsDelta ?? 0;
        const withConfidence = confidenceDelta === 0
          ? adjusted
          : adjusted.map((entry) =>
            entry.polityId === delta.targetId
              ? { ...entry, institutionalConfidenceBps: clampBps(entry.institutionalConfidenceBps + confidenceDelta) }
              : entry,
          );
        return { ...world, material: { ...world.material, polityLegitimacy: withConfidence } };
      }

      if (!world.material.institutions.some((institution) => institution.id === delta.targetId)) {
        reject(`No institution "${delta.targetId}" exists to gain or lose standing.`, "reference");
      }
      const cause = { id: context.ids.next("cause"), label: delta.causeLabel, score: clampScore(Math.round(delta.legitimacyBpsDelta / 10)), sourceId: delta.targetId };
      const existing = world.material.institutionLegitimacy.find((entry) => entry.institutionId === delta.targetId);
      const institutionLegitimacy = existing === undefined
        ? [...world.material.institutionLegitimacy, { institutionId: delta.targetId, legitimacyBps: clampBps(5_000 + delta.legitimacyBpsDelta), causes: [cause] }]
        : world.material.institutionLegitimacy.map((entry) =>
          entry.institutionId === delta.targetId
            ? { ...entry, legitimacyBps: clampBps(entry.legitimacyBps + delta.legitimacyBpsDelta), causes: [...entry.causes, cause] }
            : entry,
        );
      return { ...world, material: { ...world.material, institutionLegitimacy } };
    }

    case "province_material_shift": {
      if (!world.map.provinces.some((province) => province.id === delta.provinceId)) {
        reject(`No province "${delta.provinceId}" exists to be changed.`, "reference");
      }
      // A province with no material row yet is the ordinary case on an older
      // world, not an error: derive one from its settlements and then move it.
      const backfilled = ensureProvinceMaterial(world, atStep);
      const provinceMaterial = backfilled.material.provinceMaterial.map((material) => {
        if (material.provinceId !== delta.provinceId) return material;
        return {
          ...material,
          population: Math.max(0, material.population + (delta.populationDelta ?? 0)),
          availableManpower: Math.max(0, material.availableManpower + (delta.availableManpowerDelta ?? 0)),
          stabilityBps: clampBps(material.stabilityBps + (delta.stabilityBpsDelta ?? 0)),
          foodSecurityBps: clampBps(material.foodSecurityBps + (delta.foodSecurityBpsDelta ?? 0)),
          productiveCapacityBps: clampBps(material.productiveCapacityBps + (delta.productiveCapacityBpsDelta ?? 0)),
          warDamageBps: clampBps(material.warDamageBps + (delta.warDamageBpsDelta ?? 0)),
          taxCapacity: Math.max(0, material.taxCapacity + (delta.taxCapacityDelta ?? 0)),
          displacedPopulation: Math.max(0, material.displacedPopulation + (delta.displacedPopulationDelta ?? 0)),
          lastMaterialUpdateStep: atStep,
        };
      });
      return { ...backfilled, material: { ...backfilled.material, provinceMaterial } };
    }

    case "political_procedure_open": {
      const sponsorId = required(delta.sponsorCharacterRef, "The sponsor");
      if (!world.characters.some((character) => character.id === sponsorId)) {
        reject(`No character "${sponsorId}" exists to sponsor this.`, "reference");
      }
      const institutionId = delta.institutionRef === null ? null : required(delta.institutionRef, "The institution");
      if (institutionId !== null && !world.material.institutions.some((institution) => institution.id === institutionId)) {
        reject(`No institution "${institutionId}" exists to put this before.`, "reference");
      }
      // A vote needs a body to hold it. The schema enforces this too; catching
      // it here means the player hears why rather than losing the whole batch.
      if (delta.resolutionMechanism === "vote" && institutionId === null) {
        reject("A question can only be put to a vote before an institution that can hold one.");
      }
      const subjectId = delta.subjectRef === null ? null : required(delta.subjectRef, "The subject");
      const id = mint("procedure", delta.localId);
      const procedure = {
        id,
        type: delta.type,
        institutionId,
        sponsorCharacterId: sponsorId,
        subjectKind: delta.subjectKind,
        subjectId,
        label: delta.label,
        eligibilityRequirementIds: [],
        eligibleParticipantIds: [],
        stage: "gathering_support" as const,
        resolutionMechanism: delta.resolutionMechanism,
        openedAtStep: atStep,
        deadlineStep: delta.deadlineInDays === null ? null : atStep + delta.deadlineInDays,
        resolvedAtStep: null,
        visibility: delta.visibility,
        voteRecordId: null,
        outcome: null,
        outcomeReason: null,
        sourceEventIds: [],
        resultingEventIds: [],
      };
      return { ...world, material: { ...world.material, politicalProcedures: [...world.material.politicalProcedures, procedure] } };
    }

    case "political_support_set": {
      const procedureId = required(delta.procedureRef, "The question");
      if (!world.material.politicalProcedures.some((procedure) => procedure.id === procedureId)) {
        reject(`No open question "${procedureId}" exists to take a side on.`, "reference");
      }
      const supporterId = required(delta.supporterRef, "The supporter");
      const supporterExists = delta.supporterKind === "character"
        ? world.characters.some((character) => character.id === supporterId)
        : world.material.politicalGroups.some((group) => group.id === supporterId);
      if (!supporterExists) reject(`No ${delta.supporterKind} "${supporterId}" exists to hold a position.`, "reference");

      // Positions are append-only: someone who changes their mind leaves both
      // rows behind, and the later one is what counts. That is what lets the
      // world say a senator turned, rather than only that he opposes.
      const position = {
        id: context.ids.next("support"),
        procedureId,
        supporterKind: delta.supporterKind,
        supporterId,
        position: delta.position,
        influenceWeight: delta.influenceWeight,
        visibility: delta.visibility,
        reasons: [{ kind: delta.reasonKind, label: delta.reasonLabel, score: delta.position === "support" ? 50 : delta.position === "oppose" ? -50 : 0, sourceId: supporterId }],
        provenanceEventIds: [],
        changedAtStep: atStep,
      };
      return { ...world, material: { ...world.material, supportPositions: [...world.material.supportPositions, position] } };
    }

    case "political_procedure_resolve": {
      const procedureId = required(delta.procedureRef, "The question");
      const procedure = world.material.politicalProcedures.find((candidate) => candidate.id === procedureId);
      if (procedure === undefined) reject(`No question "${procedureId}" exists to settle.`, "reference");
      if (procedure.stage === "resolved" || procedure.stage === "withdrawn" || procedure.stage === "blocked") {
        reject(`The question "${procedureId}" has already been settled (${procedure.outcome ?? procedure.stage}).`);
      }
      // Stage and outcome move together: the schema refuses a resolved
      // procedure with no outcome, and an unresolved one that has one.
      const stage = delta.outcome === "withdrawn" ? "withdrawn" as const : delta.outcome === "blocked" ? "blocked" as const : "resolved" as const;
      const settled = {
        ...procedure,
        stage,
        outcome: delta.outcome,
        outcomeReason: delta.outcomeReason,
        resolvedAtStep: atStep,
      };
      return {
        ...world,
        material: {
          ...world.material,
          politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === procedureId ? settled : candidate)),
        },
      };
    }

    case "holding_transfer": {
      const holdingId = required(delta.holdingRef, "The holding");
      const holding = world.material.holdings.find((candidate) => candidate.id === holdingId);
      if (holding === undefined) reject(`No holding "${holdingId}" exists to change hands.`, "reference");
      const toId = delta.toCharacterRef === null ? null : required(delta.toCharacterRef, "The new holder");
      if (toId !== null && !world.characters.some((character) => character.id === toId)) {
        reject(`No character "${toId}" exists to receive it.`, "reference");
      }
      const moved = {
        ...holding,
        ...(toId === null ? {} : { legalHolderCharacterId: toId }),
        physicalControlBps: clampBps(holding.physicalControlBps + (delta.physicalControlBpsDelta ?? 0)),
      };
      return {
        ...world,
        material: { ...world.material, holdings: world.material.holdings.map((candidate) => (candidate.id === holdingId ? moved : candidate)) },
      };
    }

    case "generic_entity_create": {
      const id = mint("entity", delta.localId);
      const entity = {
        id,
        kind: delta.kind,
        label: delta.label,
        ownerRef: delta.ownerRef,
        attributes: delta.attributes,
        linkedEntityIds: [],
        createdAtStep: atStep,
        provenanceEventIds: [],
      };
      return { ...world, genericEntities: [...world.genericEntities, entity] };
    }

    case "generic_entity_update": {
      const entityId = required(delta.entityRef, "The arrangement");
      const entity = world.genericEntities.find((candidate) => candidate.id === entityId);
      if (entity === undefined) reject(`No arrangement "${entityId}" exists to change.`, "reference");

      // Merge, never replace: an update that named one attribute would
      // otherwise quietly erase everything the arrangement already recorded.
      // A null is the one way to actually take an attribute away.
      const attributes: Record<string, string | number | boolean | null> = { ...entity.attributes };
      for (const [key, value] of Object.entries(delta.attributes)) {
        if (value === null) delete attributes[key];
        else attributes[key] = value;
      }
      if (delta.retire) attributes["retiredAtStep"] = atStep;

      const updated = {
        ...entity,
        ...(delta.label === undefined ? {} : { label: delta.label }),
        attributes,
      };
      return { ...world, genericEntities: world.genericEntities.map((candidate) => (candidate.id === entityId ? updated : candidate)) };
    }

    case "loan_open": {
      const borrowerId = required(delta.borrowerAccountRef, "The borrowing account");
      const borrower = world.material.accounts.find((account) => account.id === borrowerId);
      if (borrower === undefined) reject(`No account "${borrowerId}" exists to receive the money.`, "reference");

      const lenderId = delta.lenderRef === null ? null : required(delta.lenderRef, "The lender");
      if (delta.lenderKind !== "foreign" && lenderId === null) {
        reject("A loan from someone in this world has to say who they are.");
      }
      const collateralId = delta.collateralHoldingRef === null ? null : required(delta.collateralHoldingRef, "The collateral");
      if (collateralId !== null && !world.material.holdings.some((holding) => holding.id === collateralId)) {
        reject(`No holding "${collateralId}" exists to pledge against it.`, "reference");
      }

      // Money from inside the world comes out of someone's own reserves, and
      // they have to actually have it. Money from outside does not: that is the
      // whole difference between a merchant of ours and a foreign banker.
      let accounts = world.material.accounts;
      if (delta.lenderKind !== "foreign") {
        const lenderAccount = world.material.accounts.find(
          (account) => account.owner.kind === delta.lenderKind && account.owner.id === lenderId,
        );
        if (lenderAccount === undefined) reject(`${lenderId ?? "The lender"} keeps no account to lend from.`, "reference");
        if (lenderAccount.balance < delta.principal) {
          reject(`${lenderId ?? "The lender"} holds ${lenderAccount.balance}, which will not cover a loan of ${delta.principal}.`);
        }
        accounts = accounts.map((account) => (account.id === lenderAccount.id ? { ...account, balance: account.balance - delta.principal } : account));
      }
      accounts = accounts.map((account) => (account.id === borrowerId ? { ...account, balance: account.balance + delta.principal } : account));

      const loanId = mint("loan", delta.localId);
      // Servicing goes through an ordinary obligation, so arrears, priority and
      // missed periods all behave as they do for army pay -- a debt crisis is
      // already modelled by whatever models an unpaid army.
      const serviceObligationId = context.ids.next("obligation");
      const servicing = Math.max(1, Math.round((delta.principal * delta.interestBps) / 10_000));
      const obligation = {
        id: serviceObligationId,
        kind: "debt_service" as const,
        label: `Interest on ${delta.terms}`.slice(0, 120),
        payerAccountId: borrowerId,
        ...(delta.lenderKind === "foreign" ? {} : { recipientAccountId: world.material.accounts.find((account) => account.owner.kind === delta.lenderKind && account.owner.id === lenderId)?.id }),
        amount: servicing,
        cadenceSteps: delta.cadenceDays,
        nextDueStep: atStep + delta.cadenceDays,
        // Below army pay: a state short of money starves its creditors before
        // it starves its soldiers, and that choice is what causes the crisis.
        priority: 400,
        arrears: 0,
        missedPeriods: 0,
        active: true,
      };

      const loan = {
        id: loanId,
        lenderKind: delta.lenderKind,
        lenderId,
        borrowerAccountId: borrowerId,
        principal: delta.principal,
        outstanding: delta.principal,
        interestBps: delta.interestBps,
        cadenceSteps: delta.cadenceDays,
        serviceObligationId,
        terms: delta.terms,
        collateralHoldingId: collateralId,
        status: "active" as const,
        openedAtStep: atStep,
      };

      return {
        ...world,
        material: {
          ...world.material,
          accounts,
          obligations: [...world.material.obligations, obligation],
          loans: [...world.material.loans, loan],
        },
      };
    }

    case "loan_settle": {
      const loanId = required(delta.loanRef, "The loan");
      const loan = world.material.loans.find((candidate) => candidate.id === loanId);
      if (loan === undefined) reject(`No loan "${loanId}" exists to settle.`, "reference");
      if (loan.status !== "active") reject(`The loan "${loanId}" is already ${loan.status}.`);

      if (delta.action === "renegotiate") {
        const renegotiated = {
          ...loan,
          interestBps: delta.newInterestBps ?? loan.interestBps,
          cadenceSteps: delta.newCadenceDays ?? loan.cadenceSteps,
          terms: delta.reason.slice(0, 300),
        };
        const servicing = Math.max(1, Math.round((renegotiated.outstanding * renegotiated.interestBps) / 10_000));
        return {
          ...world,
          material: {
            ...world.material,
            loans: world.material.loans.map((candidate) => (candidate.id === loanId ? renegotiated : candidate)),
            obligations: world.material.obligations.map((obligation) =>
              obligation.id === loan.serviceObligationId
                ? { ...obligation, amount: servicing, cadenceSteps: renegotiated.cadenceSteps }
                : obligation,
            ),
          },
        };
      }

      if (delta.action === "default") {
        // The debt stops being serviced and stops being paid. What that costs
        // politically is for the creditor to decide, and they are a person.
        return {
          ...world,
          material: {
            ...world.material,
            loans: world.material.loans.map((candidate) => (candidate.id === loanId ? { ...candidate, status: "defaulted" as const } : candidate)),
            obligations: world.material.obligations.map((obligation) =>
              obligation.id === loan.serviceObligationId ? { ...obligation, active: false } : obligation,
            ),
          },
        };
      }

      const paying = Math.min(delta.amount, loan.outstanding);
      if (paying <= 0) reject("A repayment has to pay something.");
      const borrower = world.material.accounts.find((account) => account.id === loan.borrowerAccountId);
      if (borrower === undefined) reject(`No account "${loan.borrowerAccountId}" exists to repay from.`, "reference");
      if (borrower.balance < paying) reject(`The account holds ${borrower.balance}, which cannot repay ${paying}.`);

      const lenderAccount = loan.lenderKind === "foreign" || loan.lenderId === null
        ? undefined
        : world.material.accounts.find((account) => account.owner.kind === loan.lenderKind && account.owner.id === loan.lenderId);
      const accounts = world.material.accounts.map((account) => {
        if (account.id === borrower.id) return { ...account, balance: account.balance - paying };
        if (lenderAccount !== undefined && account.id === lenderAccount.id) return { ...account, balance: account.balance + paying };
        return account;
      });

      const outstanding = loan.outstanding - paying;
      const settled = { ...loan, outstanding, status: outstanding === 0 ? ("repaid" as const) : loan.status };
      const servicing = Math.max(1, Math.round((outstanding * loan.interestBps) / 10_000));
      return {
        ...world,
        material: {
          ...world.material,
          accounts,
          loans: world.material.loans.map((candidate) => (candidate.id === loanId ? settled : candidate)),
          obligations: world.material.obligations.map((obligation) =>
            obligation.id === loan.serviceObligationId
              ? { ...obligation, amount: servicing, active: outstanding > 0 }
              : obligation,
          ),
        },
      };
    }

    case "authority_grant_upsert": {
      const existingId = delta.grantRef === null ? null : required(delta.grantRef, "The authority grant");
      const base = {
        holder: delta.holder,
        source: delta.source,
        sourceRef: null,
        domain: delta.domain,
        scope: delta.scope,
        powers: delta.powers,
        standing: delta.standing,
        legitimacyBps: 10_000,
        visibility: "public" as const,
        grantedAtStep: atStep,
        expiresAtStep: delta.expiresInDays === null ? null : atStep + delta.expiresInDays,
        revokedAtStep: null,
        revocationReason: null,
        succeedsGrantId: null,
      };
      if (existingId !== null) {
        if (!world.authorityGrants.some((grant) => grant.id === existingId)) reject(`No authority grant "${existingId}" exists to change.`, "reference");
        return { ...world, authorityGrants: world.authorityGrants.map((grant) => (grant.id === existingId ? { ...grant, ...base } : grant)) };
      }
      const id = mint("grant", delta.localId);
      return { ...world, authorityGrants: [...world.authorityGrants, { id, ...base }] };
    }

    case "order_attempt_decide": {
      const attemptId = required(delta.orderAttemptRef, "The order");
      const attempt = world.orderAttempts.find((candidate) => candidate.id === attemptId);
      if (attempt === undefined) reject(`No order attempt "${attemptId}" exists to answer.`, "reference");
      if (attempt.status !== "received" && attempt.status !== "delayed" && attempt.status !== "issued") {
        reject(`Order attempt "${attemptId}" has already been answered (${attempt.status}).`);
      }
      // An unauthorized order that is nonetheless obeyed is recorded as
      // subversion, never as compliance -- `decideOrderAttempt` enforces this,
      // and it is the difference between a lawful chain of command and a
      // private one.
      const received = attempt.status === "issued" ? receiveOrderAttempt(attempt) : attempt;
      const decided = decideOrderAttempt(received, delta.decision, delta.reason, atStep);
      return { ...world, orderAttempts: world.orderAttempts.map((candidate) => (candidate.id === attemptId ? decided : candidate)) };
    }

    case "social_events": {
      // Routed through the character system's own `applySocialEvents` rather
      // than reimplemented here: relationships, beliefs, pressures and
      // commitments have one applier, whether the cause was a conversation or
      // the world at large.
      const events = delta.events.map((draft) => {
        const participants = draft.participantCharacterRefs.map((ref, index) => required(ref, `Participant ${index + 1}`));
        for (const participantId of participants) {
          if (!world.characters.some((character) => character.id === participantId)) {
            reject(`No character "${participantId}" exists to take part in this.`, "reference");
          }
        }
        return CharacterSocialEventSchema.parse({
          id: context.ids.next("social"),
          gameId: context.gameId,
          sourceTurnId: null,
          sourceSessionId: null,
          sourceMessageId: null,
          participantCharacterIds: participants,
          kind: draft.kind,
          visibility: draft.visibility,
          knownByCharacterIds: participants,
          relationCauses: [],
          knowledgeClaims: [],
          proposedBeliefs: [],
          pressureChanges: [],
          commitmentProposal: null,
          introducedCharacter: null,
          introducedProfile: null,
          createdAtStep: atStep,
          appliedAtStep: null,
          appliedInTurnId: null,
          status: "proposed",
          rejectionReason: null,
        });
      });

      const outcome = applySocialEvents(world, events, atStep, context.ids.next("social-batch"));
      const refused = outcome.rejectedIds[0];
      if (refused !== undefined) reject(refused.reason);
      return outcome.world;
    }
  }
}
