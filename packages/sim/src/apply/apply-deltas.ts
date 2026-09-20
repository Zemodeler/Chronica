import {
  DELTA_AUTHORITY_DOMAIN,
  adjustPolityLegitimacy,
  agreementsBetween,
  applyDiplomaticAnswerToStance,
  canMoveTo,
  crossingAdmitted,
  WORLD_DELTA_OPS,
  allOffices,
  findOfficeForRole,
  findOfficeSeatForRole,
  seatCharacterInOffice,
  vacateOfficesOf,
  fitStrengthOf,
  isNavalForce,
  isWaterCrossing,
  transportFor,
  ensureProvinceMaterial,
  WorldStateSchema,
  buildAuthorityIndex,
  checkAuthority,
  CharacterSocialEventSchema,
  applySocialEvents,
  createCanonicalNpc,
  createPressure,
  decideOrderAttempt,
  findWorldReferenceViolations,
  openStorylines,
  receiveOrderAttempt,
  refreshPressure,
  resolvePressure,
  resolveRef,
  type AuthorityCheckResult,
  type AuthorityIndex,
  type AuthorityPower,
  type AuthorityScope,
  type FactProposalDraft,
  type OrderPartyRef,
  type WorldDelta,
  type WorldDeltaOp,
  type WorldState,
} from "@chronica/shared";
import { resolveEngagement, type BattleAccount } from "../battle";
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
    case "force_engage":
      return { kind: "force", id: resolve(delta.forceRef) ?? delta.forceRef };
    case "polity_stance_shift":
      return { kind: "polity", id: delta.polityId };
    // Writing in a power's name is that power's act. A senator who writes to
    // Carthage over Rome's name is scoped to Rome and breaches for it, which is
    // exactly what private correspondence with a foreign power should be.
    case "diplomatic_message_send":
      return { kind: "polity", id: delta.fromPolityId };
    case "agreement_open":
      return { kind: "polity", id: delta.polityId };
    case "polity_outlook_set":
      return { kind: "polity", id: delta.polityId };
    case "legitimacy_shift":
      return { kind: delta.target === "polity" ? "polity" : "institution", id: delta.targetId };
    case "province_material_shift":
      return { kind: "province", id: delta.provinceId };
    case "office_seat_set":
      // Scoped to the power whose office it is: seating a man is an act over a
      // government, and judging it against the office itself would let anybody
      // who could name an office fill it.
      return { kind: "institution", id: delta.officeId };
    case "province_control_set":
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

/** The pressure helpers hand back the two collections they touch; the world takes them. */
function withPressures(world: WorldState, next: { readonly characters: readonly WorldState["characters"][number][]; readonly characterPressures: readonly WorldState["characterPressures"][number][] }): WorldState {
  return { ...world, characters: [...next.characters], characterPressures: [...next.characterPressures] };
}

/** How many threads the world follows at once before it must close one. */
const MAX_OPEN_STORYLINES = 12;

/**
 * How many battles the map shows at once.
 *
 * A battle is a moment, not a condition: what the overlay is for is showing
 * where fighting is happening now, and an unbounded list would end a campaign
 * drawing every engagement of the whole war on top of each other.
 */
const MAX_SHOWN_BATTLES = 6;

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
  belief_set: "propose",
  force_engage: "command",
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
  storyline_open: "propose",
  storyline_advance: "propose",
  character_pressure_set: "propose",
  diplomatic_message_send: "negotiate",
  diplomatic_message_answer: "negotiate",
  agreement_open: "negotiate",
  agreement_close: "negotiate",
  province_control_set: "command",
  polity_create: "override",
  office_seat_set: "appoint",
};

/**
 * Which polity an act falls in, where that can be told.
 *
 * Used to decide whether an act is the actor's at all -- not to decide whether
 * they may do it, which is `checkAuthority`'s business.
 */
function polityOfScope(scope: AuthorityScope, world: WorldState): string | null {
  switch (scope.kind) {
    case "polity":
      return scope.id;
    case "province":
      return world.map.provinces.find((province) => province.id === scope.id)?.controllerPolityId ?? null;
    case "force":
      return world.material.forces.find((force) => force.id === scope.id)?.polityId ?? null;
    case "institution":
      return world.material.institutions.find((institution) => institution.id === scope.id)?.polityId ?? null;
    case "account": {
      const owner = world.material.accounts.find((account) => account.id === scope.id)?.owner;
      if (owner === undefined) return null;
      if (owner.kind === "polity") return owner.id;
      return world.characters.find((character) => character.id === owner.id)?.polityId ?? null;
    }
    default:
      return null;
  }
}

/**
 * Whether a delta is the actor overreaching, or simply the world moving.
 *
 * The orchestrator speaks for the whole world, not only for the ruler whose
 * order it is answering: it gives the Boii a chieftain, decides what Carthage
 * privately wants, and moves a neighbour's army. Judging those against the
 * Roman consul recorded ten breaches for a single tax order and accused him of
 * insubordination for things he did not do -- the third time false
 * insubordination has come out of this check.
 *
 * So the exemption follows who is speaking. When a person acts for themselves,
 * through their own cognition, everything they do is theirs to answer for, and
 * a Carthaginian who moves a Roman legion has committed exactly the
 * insubordination VISION §12 is about. It is only when the world itself is
 * speaking that an act inside another power is somebody else's business.
 */
function actorIsAnswerableFor(delta: WorldDelta, scope: AuthorityScope, world: WorldState, context: ApplyContext): boolean {
  // Meaning to do something is not doing it. An intention has no scope of its
  // own, so it fell back to the whole polity, and an official who merely
  // resolved to act was recorded as having exceeded his authority over the
  // republic. Whatever he then actually does is checked on its own terms.
  if (delta.op === "character_intent_set") return false;
  // A thread of history is the world's bookkeeping, and a circumstance that
  // befalls someone is nobody's act. Neither is a power an office could hold,
  // so judging them against one would make the first seed to land at home an
  // act of insubordination by the ruler -- the sixth time this check would
  // have manufactured it.
  if (delta.op === "storyline_open" || delta.op === "storyline_advance" || delta.op === "character_pressure_set") return false;
  // A country coming apart is not an act of office. Scoped to the power it
  // breaks from -- which for a rising is usually the ruler's own -- it would
  // have recorded the ruler as personally insubordinate for a rebellion in his
  // own provinces, which is the seventh way this check has found to manufacture
  // insubordination out of the world simply moving.
  if (delta.op === "polity_create") return false;
  // Answering an order put to *you* is not an exercise of authority over your
  // own power. Scoped to the decider's polity -- which is where it falls
  // through to -- every refusal and every acceptance would have recorded a
  // breach for the act of replying. It has never fired only because no order
  // attempt has ever been decided; fixing that without this would make
  // insubordination the ordinary consequence of answering your post, and is
  // the eighth way this check has found to manufacture it.
  if (delta.op === "order_attempt_decide") return false;

  if (context.actsForTheWorld !== true) return true;

  // A polity's standing aims are nobody's personal act, whoever is speaking.
  if (delta.op === "polity_outlook_set") return false;

  const actorPolityId = context.actorRef.kind === "character"
    ? world.characters.find((character) => character.id === context.actorRef.id)?.polityId ?? null
    : context.actorRef.kind === "polity" ? context.actorRef.id : null;
  if (actorPolityId === null) return true;

  const scopePolityId = polityOfScope(scope, world);
  // Where the act belongs to nobody in particular, the actor still answers for
  // it: an unattributable act is exactly where overreach would hide.
  if (scopePolityId === null) return true;
  return scopePolityId === actorPolityId;
}

export function applyDeltas(world: WorldState, deltas: readonly WorldDelta[], context: ApplyContext): ApplyResult {
  const assignedIds = new Map<string, string>();
  const applied: AppliedDelta[] = [];
  const rejected: RejectedDelta[] = [];
  const breaches: AuthorityBreach[] = [];
  const factProposals: FactProposalDraft[] = [];
  const battleAccounts: BattleAccount[] = [];

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
    const emitted: FactProposalDraft[] = [];
    const emitFact = (fact: FactProposalDraft): void => {
      emitted.push(fact);
    };
    // Buffered with the facts, for the same reason: a delta rolled back must
    // not leave an account of a battle that never happened.
    const emittedAccounts: BattleAccount[] = [];
    const emitAccount = (account: BattleAccount): void => {
      emittedAccounts.push(account);
    };
    let authority: AuthorityCheckResult;
    let answerable = true;
    try {
      const scope = scopeOf(delta, current, resolve, context.actorRef);
      answerable = actorIsAnswerableFor(delta, scope, current, context);
      authority = checkAuthority(
        authorityIndex,
        {
          holder: context.actorRef,
          domain: DELTA_AUTHORITY_DOMAIN[delta.op],
          scope,
          power: POWER_BY_OP[delta.op],
        },
        // Without this, `checkAuthority` matches scopes only exactly, so a
        // grant over Rome covered nothing *in* Rome: a consul with authority
        // over his own republic was recorded as insubordinate for putting a
        // motion to its own Senate.
        (granted, wanted) => granted.kind === "polity" && polityOfScope(wanted, current) === granted.id,
      );
      current = applyOne(current, delta, context, assignedIds, resolve, emitFact, emitAccount);
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
    battleAccounts.push(...emittedAccounts);
    if (answerable && !authority.authorized) breaches.push({ delta, reason: authority.reason });
  }

  // One structural check at the end rather than per delta: the per-delta guard
  // above already catches the realistic failure, and re-parsing a whole world
  // once per delta is not worth the marginal safety.
  const parsed = WorldStateSchema.safeParse(current);
  if (!parsed.success) {
    return {
      world,
      applied: [],
      battleAccounts: [],
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

  return { world: parsed.data, applied, rejected, breaches, factProposals, battleAccounts, assignedIds };
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
  /** For consequences the model is not permitted to author -- battle casualties. */
  emitFact: (fact: FactProposalDraft) => void,
  emitAccount: (account: BattleAccount) => void,
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
          forceId: outcome.forceRef === null ? null : required(outcome.forceRef, "The force this project is to move"),
          beneficiaryAccountId: outcome.beneficiaryAccountRef === null ? null : required(outcome.beneficiaryAccountRef, "The account this project is to pay into"),
          cadenceDays: outcome.cadenceDays,
          agreementKind: outcome.agreementKind,
          withPolityId: outcome.withPolityId,
        };
      // An embassy whose whole point is an understanding must name the power it
      // is with, or it completes and the world is exactly as it was.
      if (outcome !== null && outcome.kind === "agreement" && (outcome.agreementKind === null || outcome.withPolityId === null)) {
        reject("A project that is to end in an agreement must say what the agreement is and which power it is with.");
      }
      if (outcome !== null && outcome.withPolityId !== null && !world.map.polities.some((polity) => polity.id === outcome.withPolityId)) {
        reject(`No power "${outcome.withPolityId}" exists to come to terms with.`, "reference");
      }
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
      // An army has to cross the ground between here and there. The map has
      // always said what that ground is; nothing ever asked it, so a legion
      // could be in Latium in one delta and Carthage in the next.
      let escort: typeof force | null = null;
      if (delta.locationId !== undefined && delta.locationId !== force.locationId) {
        const verdict = canMoveTo(world, force.locationId, delta.locationId, context.terrains ?? []);
        if (verdict.allowed && isWaterCrossing(verdict.edge.crossing) && !isNavalForce(force, context.warfare)) {
          // An army crossing water needs hulls to cross it in. This is the rule
          // that makes Sicily an island rather than another province of Italy.
          escort = transportFor(force, world.material.forces, context.warfare);
          if (escort === null) {
            reject(
              `${force.name} cannot make the ${verdict.edge.crossing} crossing without ships: no fleet of its own power stands with it that could carry ${fitStrengthOf(force)} men.`,
            );
          }
        }
        if (!verdict.allowed) {
          const provinceName = (id: string): string => world.map.provinces.find((province) => province.id === id)?.name ?? id;
          if (verdict.refusal.kind === "crossing_not_admitted") {
            reject(`${force.name} cannot make the ${verdict.refusal.crossing} crossing from ${provinceName(force.locationId)} to ${provinceName(delta.locationId)}.`);
          }
          const hops = verdict.refusal.kind === "not_adjacent" ? verdict.refusal.hops : null;
          const distance = hops === null ? "no road at all leads there" : `it is ${hops} province(s) away`;
          reject(
            `${force.name} stands in ${provinceName(force.locationId)} and cannot reach ${provinceName(delta.locationId)} in one move: ${distance}. March it to a neighbouring province, or make the journey a project whose outcome is "force_move".`,
          );
        }
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
      // The ships go where the army they carried went. A fleet that ferries an
      // army and stays behind has not sailed anywhere.
      const escortId = escort?.id ?? null;
      return {
        ...world,
        material: {
          ...world.material,
          forces: world.material.forces.map((candidate) => {
            if (candidate.id === forceId) return updated;
            if (escortId !== null && candidate.id === escortId && delta.locationId !== undefined) return { ...candidate, locationId: delta.locationId };
            return candidate;
          }),
        },
      };
    }

    case "force_engage": {
      const attackerId = required(delta.forceRef, "The attacking force");
      const defenderId = required(delta.targetForceRef, "The force being attacked");
      const attacker = world.material.forces.find((force) => force.id === attackerId);
      if (attacker === undefined) reject(`No force "${attackerId}" exists to give battle.`, "reference");
      const defender = world.material.forces.find((force) => force.id === defenderId);
      if (defender === undefined) reject(`No force "${defenderId}" exists to be given battle.`, "reference");

      if (attacker.id === defender.id) reject("A force cannot give battle to itself.");
      if (attacker.polityId === defender.polityId) reject(`${attacker.name} and ${defender.name} answer to the same power and will not fight each other.`);
      // Getting an army to where its enemy stands is movement, and movement is
      // somebody's decision. A battle is what happens once they are both there.
      if (attacker.locationId !== defender.locationId) {
        reject(`${attacker.name} stands in ${attacker.locationId} and ${defender.name} in ${defender.locationId}; they cannot fight until one of them marches.`);
      }
      const living = (force: typeof attacker): number => force.personnel.reduce((sum, category) => sum + category.fit, 0);
      if (living(attacker) === 0 || living(defender) === 0) reject("An army with no men left in it cannot fight.");
      // Ships and armies do not fight each other. A fleet standing off a coast
      // blockades it; a legion on the shore cannot board it, and it cannot
      // storm the legion.
      if (isNavalForce(attacker, context.warfare) !== isNavalForce(defender, context.warfare)) {
        reject(`${attacker.name} and ${defender.name} do not fight on the same element; ships blockade a coast, they do not give battle to an army on it.`);
      }
      // Attacking a power you are at peace with is a thing armies do -- it is
      // how most wars start -- but it is not an ordinary battle, and the world
      // must not slide into war without anybody having decided to. The attack
      // is refused until the peace is broken or a war declared, which are both
      // single deltas and both leave a record of who chose it.
      const standing = agreementsBetween(world.polityAgreements, attacker.polityId, defender.polityId);
      const peaceBetween = standing.find((agreement) => agreement.kind === "peace" || agreement.kind === "truce" || agreement.kind === "alliance" || agreement.kind === "non_aggression");
      if (peaceBetween !== undefined && !standing.some((agreement) => agreement.kind === "war")) {
        reject(`${attacker.polityId} and ${defender.polityId} stand in ${peaceBetween.kind}; break it or declare war before giving battle.`);
      }

      // The engine decides what happens. Everything the model chose -- who, and
      // how -- is already spent by this point.
      const battleId = context.ids.next("battle");
      const engagement = resolveEngagement(
        {
          world,
          attacker,
          defender,
          posture: delta.posture,
          tactic: delta.tactic,
          warfare: context.warfare,
          battleId,
          seed: `${context.gameId}:${battleId}`,
        },
        world.material.forces.findIndex((force) => force.id === attackerId),
      );
      for (const fact of engagement.facts) emitFact(fact);
      if (engagement.account !== undefined) emitAccount(engagement.account);
      // The map has read `conflicts` from the beginning and nothing ever wrote
      // it, so a battle was fought, a province changed hands, and the map where
      // it happened showed nothing at all.
      return {
        ...engagement.world,
        conflicts: {
          ...engagement.world.conflicts,
          battles: [
            ...engagement.world.conflicts.battles.filter((battle) => battle.battleId !== battleId),
            { battleId, participantForceIds: [attacker.id, defender.id], attackerForceIds: [attacker.id] },
          ].slice(-MAX_SHOWN_BATTLES),
        },
      };
    }

    case "character_create": {
      const provinceId = delta.provinceId ?? world.map.provinces[0]?.id;
      if (provinceId === undefined) reject("The world has no province to place a new character in.");
      const id = mint("character", delta.localId);
      const created = createCanonicalNpc(world, {
        ...(delta.wealth > 0 ? { startingMoney: delta.wealth } : {}),
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
      // The world says what it made this person: "Military Quaestor", "chief of
      // the Boii". That was parsed and thrown on the floor -- every generated
      // official came out holding no office, which is how the world's own
      // invented magistrates could never do anything a magistrate does.
      const withOffice: WorldState = { ...created.world, characters: withTraits };
      if (delta.officeLabel === null) return withOffice;

      const known = allOffices(withOffice, context.offices);
      // Is there such an office at all -- not is there room in it. A
      // consulship whose seats are both filled is still a consulship, and
      // asked for another consul the world should enlarge the college rather
      // than invent a second consulship beside it.
      const existing = findOfficeForRole(known, delta.polityId, delta.officeLabel);
      if (existing !== undefined) {
        const seat = findOfficeSeatForRole(withOffice, { offices: [existing] }, delta.polityId, delta.officeLabel);
        return seatCharacterInOffice(withOffice, id, seat ?? { office: existing, vacantSeatId: null }, atStep);
      }

      // No such office yet -- so the government makes one. A scenario's list is
      // where a government starts, not the whole of what it may ever contain:
      // "name a quaestor to handle the war chest" used to match nothing and
      // leave the man holding no office at all, because there was no
      // quaestorship and no way to make one.
      const officeId = context.ids.next("office");
      const opened: WorldState = {
        ...withOffice,
        offices: [...withOffice.offices, {
          id: officeId,
          label: delta.officeLabel,
          polityId: delta.polityId,
          // An office that authorises nothing is a title, which is a real thing
          // to be. Powers arrive in the same vocabulary everything else does.
          authorisedActionIds: delta.officeAuthorises.filter((action): action is WorldDeltaOp => (WORLD_DELTA_OPS as readonly string[]).includes(action)),
          sponsorableCategories: [],
          treasuryAccountId: null,
          treasuryPermissions: [],
          incomeSourceId: null,
          expectedBlocId: null,
          successionRuleId: "appointed-by-the-government",
          eligibilityRequirementIds: [],
        }],
      };
      return seatCharacterInOffice(opened, id, { office: { id: officeId, eligibilityRequirementIds: [] }, vacantSeatId: null }, atStep);
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
      // A voting bloc inside the body hearing the question is as real a
      // supporter as a faction outside it, and usually the one that decides.
      const supporterExists = delta.supporterKind === "character"
        ? world.characters.some((character) => character.id === supporterId)
        : world.material.politicalGroups.some((group) => group.id === supporterId)
          || world.material.institutions.some((institution) => institution.votingBlocs.some((bloc) => bloc.id === supporterId));
      if (!supporterExists) reject(`No faction or voting bloc "${supporterId}" exists to hold a position.`, "reference");

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
      const resolved: WorldState = {
        ...world,
        material: {
          ...world.material,
          politicalProcedures: world.material.politicalProcedures.map((candidate) => (candidate.id === procedureId ? settled : candidate)),
        },
      };
      // A question about who holds an office has to move the office. This
      // settled the procedure's own row and touched no seat, so an appointment
      // that passed a vote changed nothing whatever: the man was appointed in
      // the record and held nothing in the world.
      if (delta.outcome !== "passed" || procedure.subjectId === null) return resolved;
      if (procedure.type === "removal") {
        const holder = procedure.subjectKind === "character"
          ? procedure.subjectId
          : resolved.material.officeSeats.find((seat) => seat.id === procedure.subjectId)?.holderCharacterId ?? null;
        return holder === null ? resolved : vacateOfficesOf(resolved, holder, "removal", atStep);
      }
      if (procedure.type === "appointment" || procedure.type === "command_assignment") {
        if (procedure.subjectKind !== "character") return resolved;
        const appointed = resolved.characters.find((character) => character.id === procedure.subjectId);
        if (appointed === undefined || !appointed.alive) return resolved;
        // The office is named by the question itself -- "Elect a consul for the
        // year" -- which is the same match declaration already uses.
        const matched = findOfficeSeatForRole(resolved, { offices: context.offices }, appointed.polityId, procedure.label);
        return matched === undefined ? resolved : seatCharacterInOffice(resolved, appointed.id, matched, atStep);
      }
      return resolved;
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
        // Named, not identified: this reaches the player as friction, and
        // "character-0a73c811 holds 0" tells a ruler nothing about anybody.
        const lenderName = world.characters.find((character) => character.id === lenderId)?.name ?? lenderId ?? "The lender";
        if (lenderAccount === undefined) reject(`${lenderName} keeps no account to lend from.`, "reference");
        if (lenderAccount.balance < delta.principal) {
          reject(`${lenderName} holds ${lenderAccount.balance}, which will not cover a loan of ${delta.principal}.`);
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

    case "storyline_open": {
      // A country, a faction or a province named as a participant is the model
      // saying what the matter is about, not naming a person. Dropped rather
      // than refused: refusing threw away a whole plague because "rome" was
      // listed among the sick, and a cult because its movement was. A name
      // that is nothing in the world at all is still a malformed payload.
      const isThing = (id: string): boolean =>
        world.map.polities.some((polity) => polity.id === id)
        || world.map.provinces.some((province) => province.id === id)
        || world.genericEntities.some((entity) => entity.id === id)
        || world.material.forces.some((force) => force.id === id)
        || world.material.institutions.some((institution) => institution.id === id);
      const participantIds = delta.participantRefs
        .map((ref) => required(ref, "A storyline participant"))
        .filter((participantId) => !isThing(participantId));
      for (const participantId of participantIds) {
        if (!world.characters.some((character) => character.id === participantId)) reject(`No character "${participantId}" exists to take part in this.`, "reference");
      }
      if (delta.provinceId !== null && !world.map.provinces.some((province) => province.id === delta.provinceId)) {
        reject(`No province "${delta.provinceId}" exists for this to happen in.`, "reference");
      }
      // Bounded, or a world that opens a thread for every incident drowns the
      // slice in them. The cap is generous; the narrator stops seeding well
      // before it and the prompt asks for threads to be closed.
      if (openStorylines(world.storylines).length >= MAX_OPEN_STORYLINES) {
        reject(`The world is already following ${MAX_OPEN_STORYLINES} threads; close one before opening another.`);
      }
      const id = mint("storyline", delta.localId);
      return {
        ...world,
        storylines: [
          ...world.storylines,
          {
            id,
            title: delta.title,
            participantIds: [...new Set(participantIds)],
            provinceId: delta.provinceId,
            phase: delta.phase,
            stakes: delta.stakes,
            history: [],
            nextDevelopment: delta.nextDevelopment,
            visibility: delta.visibility,
            origin: context.actsForTheWorld === true ? ("world" as const) : ("character" as const),
            openedByRef: context.actorRef,
            openedAtStep: atStep,
            updatedAtStep: atStep,
            closedAtStep: null,
            causalFactIds: [],
            seedKey: delta.seedKey,
          },
        ],
      };
    }

    case "storyline_advance": {
      const storylineId = required(delta.storylineRef, "The storyline");
      const storyline = world.storylines.find((candidate) => candidate.id === storylineId);
      if (storyline === undefined) reject(`No storyline "${storylineId}" exists to advance.`, "reference");
      if (storyline.phase === "closed") reject(`"${storyline.title}" is over; a closed thread is not advanced.`);
      const added = delta.addParticipantRefs.map((ref) => required(ref, "A new participant"));
      for (const participantId of added) {
        if (!world.characters.some((character) => character.id === participantId)) reject(`No character "${participantId}" exists to join this.`, "reference");
      }
      const phase = delta.phase ?? storyline.phase;
      return {
        ...world,
        storylines: world.storylines.map((candidate) =>
          candidate.id !== storylineId
            ? candidate
            : {
              ...candidate,
              phase,
              history: [...candidate.history, delta.development].slice(-24),
              nextDevelopment: delta.nextDevelopment ?? candidate.nextDevelopment,
              stakes: delta.stakes ?? candidate.stakes,
              participantIds: [...new Set([...candidate.participantIds, ...added])].slice(0, 16),
              updatedAtStep: atStep,
              closedAtStep: phase === "closed" ? atStep : candidate.closedAtStep,
            },
        ),
      };
    }

    case "character_pressure_set": {
      const characterId = required(delta.characterRef, "The person under pressure");
      if (!world.characters.some((character) => character.id === characterId)) reject(`No character "${characterId}" exists to be under pressure.`, "reference");
      const strongest = world.characterPressures
        .filter((pressure) => pressure.characterId === characterId && pressure.kind === delta.kind && pressure.status === "active")
        .sort((a, b) => b.intensity - a.intensity || a.id.localeCompare(b.id))[0];
      if (delta.action === "resolve") {
        if (strongest === undefined) reject(`${characterId} is under no ${delta.kind} pressure to lift.`);
        return withPressures(world, resolvePressure(world, strongest.id));
      }
      if (delta.action === "refresh" && strongest !== undefined) {
        return withPressures(world, refreshPressure(world, strongest.id, atStep, delta.intensity, delta.reviewInDays));
      }
      return withPressures(world, createPressure(world, {
          id: context.ids.next("pressure"),
          characterId,
          kind: delta.kind,
          intensity: delta.intensity,
          label: delta.label,
          sourceEventId: null,
          atStep,
          reviewInSteps: delta.reviewInDays,
          expiresInSteps: delta.expiresInDays,
          visibility: delta.visibility,
        }));
    }

    case "diplomatic_message_send": {
      const senderId = required(delta.fromCharacterRef, "Whoever is writing");
      if (!world.characters.some((character) => character.id === senderId)) {
        reject(`No character "${senderId}" exists to send this.`, "reference");
      }
      const known = new Set(world.map.polities.map((polity) => polity.id));
      if (!known.has(delta.fromPolityId) || !known.has(delta.toPolityId)) {
        reject("A letter must be between two powers that exist.", "reference");
      }
      if (delta.fromPolityId === delta.toPolityId) reject("A power does not write to itself.");
      const recipientId = delta.toCharacterRef === null ? null : required(delta.toCharacterRef, "The named recipient");
      if (recipientId !== null && !world.characters.some((character) => character.id === recipientId)) {
        reject(`No character "${recipientId}" exists to receive this.`, "reference");
      }
      const inReplyToId = delta.inReplyToRef === null ? null : required(delta.inReplyToRef, "The letter this answers");
      if (inReplyToId !== null && !world.diplomacy.some((message) => message.id === inReplyToId)) {
        reject(`No letter "${inReplyToId}" exists to be answering.`, "reference");
      }
      return {
        ...world,
        diplomacy: [
          ...world.diplomacy,
          {
            id: mint("message", delta.localId),
            kind: delta.kind,
            fromPolityId: delta.fromPolityId,
            fromCharacterId: senderId,
            toPolityId: delta.toPolityId,
            toCharacterId: recipientId,
            subject: delta.subject,
            terms: delta.terms,
            sentAtStep: atStep,
            replyDueByStep: delta.replyWithinDays === null ? null : atStep + delta.replyWithinDays,
            status: "awaiting_reply" as const,
            answer: null,
            answerText: null,
            answeredAtStep: null,
            inReplyToMessageId: inReplyToId,
            visibility: delta.visibility,
          },
        ],
      };
    }

    case "diplomatic_message_answer": {
      const messageId = required(delta.messageRef, "The letter being answered");
      const message = world.diplomacy.find((candidate) => candidate.id === messageId);
      if (message === undefined) reject(`No letter "${messageId}" exists to answer.`, "reference");
      // Answering twice is not a second answer; it is the engine being asked to
      // rewrite a reply already sent and read.
      if (message !== undefined && message.status === "answered") {
        reject(`"${message.subject}" has already been answered.`);
      }
      const answered = { ...message, status: "answered" as const, answer: delta.answer, answerText: delta.answerText, answeredAtStep: atStep };
      return {
        ...world,
        diplomacy: world.diplomacy.map((candidate) => (candidate.id === messageId ? answered : candidate)),
        // How an approach was received is what moves the sender's opinion of
        // the power that received it -- silence hardest of all.
        polityStances: [...applyDiplomaticAnswerToStance(world.polityStances, answered, atStep)],
      };
    }

    case "agreement_open": {
      const known = new Set(world.map.polities.map((polity) => polity.id));
      if (!known.has(delta.polityId) || !known.has(delta.otherPolityId)) {
        reject("An agreement must be between two powers that exist.", "reference");
      }
      if (delta.polityId === delta.otherPolityId) reject("A power holds no agreement with itself.");
      const sourceMessageId = delta.sourceMessageRef === null ? null : required(delta.sourceMessageRef, "The letter this came from");
      if (sourceMessageId !== null && !world.diplomacy.some((message) => message.id === sourceMessageId)) {
        reject(`No letter "${sourceMessageId}" exists for this to come from.`, "reference");
      }
      // The same thing twice is not two agreements. Peace declared while peace
      // already stands is a restatement, and a second war is still one war.
      if (agreementsBetween(world.polityAgreements, delta.polityId, delta.otherPolityId).some((agreement) => agreement.kind === delta.kind)) {
        reject(`${delta.polityId} and ${delta.otherPolityId} already stand in ${delta.kind}.`);
      }
      // War and peace cannot both be true. Opening one closes the others, which
      // is what makes "accept the peace" a single act rather than a checklist.
      const opposed: Record<string, readonly string[]> = {
        war: ["peace", "truce", "alliance", "non_aggression"],
        peace: ["war"],
        truce: ["war"],
        alliance: ["war"],
        non_aggression: ["war"],
      };
      const closes = new Set(opposed[delta.kind] ?? []);
      return {
        ...world,
        polityAgreements: [
          ...world.polityAgreements.map((agreement) =>
            agreement.status === "active" &&
            closes.has(agreement.kind) &&
            ((agreement.polityId === delta.polityId && agreement.otherPolityId === delta.otherPolityId) ||
              (agreement.polityId === delta.otherPolityId && agreement.otherPolityId === delta.polityId))
              ? { ...agreement, status: "ended" as const, endedAtStep: atStep, endedReason: delta.reason }
              : agreement,
          ),
          {
            id: mint("agreement", delta.localId),
            kind: delta.kind,
            polityId: delta.polityId,
            otherPolityId: delta.otherPolityId,
            terms: delta.terms,
            sinceStep: atStep,
            untilStep: delta.forDays === null ? null : atStep + delta.forDays,
            sourceMessageId,
            status: "active" as const,
            endedAtStep: null,
            endedReason: null,
            visibility: delta.visibility,
          },
        ],
      };
    }

    case "agreement_close": {
      const agreementId = required(delta.agreementRef, "The agreement being ended");
      const agreement = world.polityAgreements.find((candidate) => candidate.id === agreementId);
      if (agreement === undefined) reject(`No agreement "${agreementId}" exists to end.`, "reference");
      if (agreement.status === "ended") reject("That agreement has already ended.");
      return {
        ...world,
        polityAgreements: world.polityAgreements.map((candidate) =>
          candidate.id === agreementId ? { ...candidate, status: "ended" as const, endedAtStep: atStep, endedReason: delta.reason } : candidate,
        ),
      };
    }

    case "office_seat_set": {
      const office = allOffices(world, context.offices).find((candidate) => candidate.id === delta.officeId);
      if (office === undefined) reject(`No office "${delta.officeId}" exists.`, "reference");
      const holderId = delta.holderCharacterRef === null ? null : required(delta.holderCharacterRef, "The person taking the office");
      if (holderId !== null && !world.characters.some((character) => character.id === holderId && character.alive)) {
        reject(`No living character "${holderId}" exists to hold an office.`, "reference");
      }

      // Emptying it.
      if (holderId === null) {
        const seat = delta.seatId === null
          ? world.material.officeSeats.find((candidate) => candidate.officeId === office.id && candidate.status === "held")
          : world.material.officeSeats.find((candidate) => candidate.id === delta.seatId);
        if (seat?.holderCharacterId == null) reject(`No held seat of "${office.id}" to empty.`);
        return vacateOfficesOf(world, seat.holderCharacterId, delta.cause === "none" ? "removal" : delta.cause, atStep);
      }

      const seated = seatCharacterInOffice(
        world,
        holderId,
        delta.seatId === null
          ? { office, vacantSeatId: world.material.officeSeats.find((candidate) => candidate.officeId === office.id && candidate.status !== "held")?.id ?? null }
          : { office, vacantSeatId: delta.seatId },
        atStep,
      );
      if (delta.termDays === null) return seated;
      return {
        ...seated,
        material: {
          ...seated.material,
          officeSeats: seated.material.officeSeats.map((seat) =>
            seat.officeId === office.id && seat.holderCharacterId === holderId
              ? { ...seat, termExpiresAtStep: atStep + delta.termDays! }
              : seat),
        },
      };
    }

    case "province_control_set": {
      const province = world.map.provinces.find((candidate) => candidate.id === delta.provinceId);
      if (province === undefined) reject(`No province "${delta.provinceId}" exists to change hands.`, "reference");
      const takerId = required(delta.toPolityRef, "The power taking the province");
      if (!world.map.polities.some((polity) => polity.id === takerId)) reject(`No power "${takerId}" exists to hold a province.`, "reference");
      if (province.controllerPolityId === takerId) reject(`${province.name} is already held by ${takerId}.`);

      // Reach, not land contiguity. An army standing in the province has taken
      // it; otherwise the taker must already hold ground next to it across a
      // crossing the map admits -- which is how Sicily is taken from Italy and
      // why Gaul is not taken from Latium.
      const standing = world.material.forces.some((force) => force.polityId === takerId && force.locationId === province.id);
      const held = new Set(world.map.provinces.filter((candidate) => candidate.controllerPolityId === takerId).map((candidate) => candidate.id));
      const nextToHeldGround = world.map.edges.some((edge) => {
        const touches = edge.from === province.id ? edge.to : edge.to === province.id ? edge.from : null;
        return touches !== null && held.has(touches) && crossingAdmitted(world, edge, context.terrains ?? []);
      });
      if (!standing && !nextToHeldGround) {
        reject(`${takerId} has no army in ${province.name} and holds no ground next to it, so it cannot take the province.`);
      }

      // Ground taken from a people who never answered to a centre is not held
      // by taking their centre. A conqueror who beats the Boii has beaten the
      // Boii he met; the rest of them have not been beaten and do not know they
      // are conquered. So the looser the power that lost it, the looser the
      // grip on it -- which is Pax Historia's "tribes fiercely resist being
      // conquered" expressed as the number the rest of the engine already reads.
      const loser = world.map.polities.find((polity) => polity.id === province.controllerPolityId);
      const ceiling = loser === undefined ? 10_000 : Math.max(1_000, loser.cohesionBps);
      const firmness = Math.min(delta.firmnessBps, ceiling);

      return {
        ...world,
        map: {
          ...world.map,
          provinces: world.map.provinces.map((candidate) =>
            candidate.id === province.id
              ? { ...candidate, controllerPolityId: takerId, controlFirmnessBps: firmness }
              : candidate),
        },
      };
    }

    case "polity_create": {
      const id = mint("polity", delta.localId);
      if (world.map.polities.some((polity) => polity.name.toLowerCase() === delta.name.toLowerCase())) {
        reject(`A power called "${delta.name}" already exists.`);
      }
      const parentId = delta.breaksFromPolityId;
      const parent = parentId === null ? undefined : world.map.polities.find((polity) => polity.id === parentId);
      if (parentId !== null && parent === undefined) {
        reject(`No power "${parentId}" exists to break away from.`, "reference");
      }

      const taken = delta.provinceIds.map((provinceId) => {
        const province = world.map.provinces.find((candidate) => candidate.id === provinceId);
        if (province === undefined) reject(`No province "${provinceId}" exists for the new power to hold.`, "reference");
        if (parentId !== null && province.controllerPolityId !== parentId) {
          reject(`${province.name} is not held by ${parentId}, so it cannot break away with them.`);
        }
        return province;
      });

      // A rebellion is a piece of a country coming away, not a scatter of
      // unconnected towns. Every province past the first has to touch one of
      // the others across a crossing the map admits.
      const wanted = new Set(taken.map((province) => province.id));
      const reached = new Set([taken[0]!.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const edge of world.map.edges) {
          if (!wanted.has(edge.from) || !wanted.has(edge.to)) continue;
          if (reached.has(edge.from) === reached.has(edge.to)) continue;
          if (!crossingAdmitted(world, edge, context.terrains ?? [])) continue;
          reached.add(edge.from);
          reached.add(edge.to);
          grew = true;
        }
      }
      if (reached.size !== wanted.size) reject(`The ground ${delta.name} claims does not hang together.`);

      const capitalSettlementId = delta.capitalSettlementId !== null
        && taken.some((province) => province.settlements.some((settlement) => settlement.id === delta.capitalSettlementId))
        ? delta.capitalSettlementId
        : taken.flatMap((province) => province.settlements)[0]?.id ?? null;

      // At war with what it left. A secession nobody contests is an
      // administrative reform, and the Chronicle has no use for one.
      const war = parentId === null ? [] : [{
        id: context.ids.next("agreement"),
        kind: "war" as const,
        polityId: parentId,
        otherPolityId: id,
        terms: delta.reason,
        sinceStep: atStep,
        untilStep: null,
        sourceMessageId: null,
        status: "active" as const,
        endedAtStep: null,
        endedReason: null,
        visibility: "public" as const,
      }];

      return {
        ...world,
        map: {
          ...world.map,
          polities: [
            ...world.map.polities,
            // A rising holds together by the thing that made it rise, and not
            // much else. It is never tighter than what it broke from, and
            // usually looser: nobody has yet built it a centre.
            { id, name: delta.name, capitalSettlementId, cohesionBps: Math.min(4_000, parent?.cohesionBps ?? 4_000) },
          ],
          provinces: world.map.provinces.map((province) =>
            wanted.has(province.id)
              // Ground held by a rising is held loosely, whoever ends up with it.
              ? { ...province, controllerPolityId: id, controlFirmnessBps: 2_000 }
              : province),
        },
        polityAgreements: [...world.polityAgreements, ...war],
      };
    }

    case "belief_set": {
      const holderId = required(delta.holderCharacterRef, "The person who is to believe it");
      if (!world.characters.some((character) => character.id === holderId)) {
        reject(`No character "${holderId}" exists to believe anything.`, "reference");
      }
      const sourceId = delta.sourceCharacterRef === null ? null : required(delta.sourceCharacterRef, "Who they heard it from");
      if (sourceId !== null && !world.characters.some((character) => character.id === sourceId)) {
        reject(`No character "${sourceId}" exists to have told them.`, "reference");
      }
      const subjectId = delta.subjectRef === null ? null : required(delta.subjectRef, "What it is about");

      // A belief is never checked against reality. That is the whole point of
      // VISION §14: what a person acts on is what they hold to be true, and a
      // planted falsehood has to be as storable as an eyewitness account.
      const belief = {
        id: context.ids.next("belief"),
        holderCharacterId: holderId,
        subjectEntityId: subjectId,
        claim: delta.claim,
        kind: delta.kind,
        sourceCharacterId: sourceId,
        sourceEventId: null,
        confidence: delta.confidence,
        visibility: delta.visibility,
        learnedAtStep: atStep,
        expiresAtStep: null,
        supersedesBeliefIds: [],
        status: "active" as const,
      };
      return { ...world, characterBeliefs: [...world.characterBeliefs, belief] };
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

      // A refusal is an event. The person who gave the order will hear of it,
      // and the Chronicle now treats somebody's decision as history even where
      // nothing moved. The model is asked to write its own account of this in
      // the recipient's voice; this guarantees the event exists even when it
      // does not, which is how it was possible for an order to be refused and
      // for nobody, anywhere, to learn that it had been.
      if (decided.status === "refused" || decided.status === "ignored" || decided.status === "subverted") {
        const who = (ref: typeof decided.issuerRef): string => world.characters.find((character) => character.id === ref.id)?.name ?? ref.id;
        const verb = decided.status === "refused" ? "would not do as" : decided.status === "ignored" ? "gave no answer to" : "seemed to agree with, and did otherwise than";
        const subverted = decided.status === "subverted";
        emitFact({
          localId: `order_${attemptId}`,
          kind: `order_${decided.status}`,
          summary: `${who(decided.recipientRef)} ${verb} ${who(decided.issuerRef)} asked: ${delta.reason}`.slice(0, 600),
          affectedRefs: [decided.issuerRef, decided.recipientRef],
          visibility: subverted ? "private" : "polity",
          discoveryState: subverted ? "private" : "polity",
          knowableInDays: 0,
          knownToRefs: subverted ? [decided.recipientRef] : [decided.issuerRef, decided.recipientRef],
          // A legate defying a consul is a headline. A declined request joins
          // its thread without becoming one.
          significance: subverted ? 60 : attempt.standing === "binding" ? 55 : 40,
        });
      }
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
