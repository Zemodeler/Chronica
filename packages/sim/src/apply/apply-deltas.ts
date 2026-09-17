import {
  DELTA_AUTHORITY_DOMAIN,
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
    case "force_create":
      return { kind: "polity", id: delta.polityId };
    case "force_modify":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    case "polity_stance_shift":
      return { kind: "polity", id: delta.polityId };
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
  authority_grant_upsert: "appoint",
  order_attempt_decide: "command",
  polity_stance_shift: "negotiate",
};

export function applyDeltas(world: WorldState, deltas: readonly WorldDelta[], context: ApplyContext): ApplyResult {
  const assignedIds = new Map<string, string>();
  const applied: AppliedDelta[] = [];
  const rejected: RejectedDelta[] = [];
  const breaches: AuthorityBreach[] = [];

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
    let authority: AuthorityCheckResult;
    try {
      authority = checkAuthority(authorityIndex, {
        holder: context.actorRef,
        domain: DELTA_AUTHORITY_DOMAIN[delta.op],
        scope: scopeOf(delta, current, resolve, context.actorRef),
        power: POWER_BY_OP[delta.op],
      });
      current = applyOne(current, delta, context, assignedIds, resolve);
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
      rejected: deltas.map((delta) => ({ delta, reason: `The batch would have left the world invalid: ${parsed.error.issues[0]?.message ?? "unknown"}.`, kind: "reference" as const })),
      assignedIds: new Map(),
    };
  }

  return { world: parsed.data, applied, rejected, breaches, assignedIds };
}

function applyOne(
  world: WorldState,
  delta: WorldDelta,
  context: ApplyContext,
  assignedIds: Map<string, string>,
  resolve: (ref: string) => string | undefined,
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
        linkedWorkflowId: null,
        linkedWorkflowParams: {},
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
        completionWorkflowId: null,
        completionWorkflowParams: {},
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
