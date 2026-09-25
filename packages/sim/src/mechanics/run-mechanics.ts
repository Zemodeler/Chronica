import {
  EFFECT_PERIOD_DAYS,
  MECHANIC_MAX_EMPTY_FIRINGS,
  MECHANIC_MAX_FIRINGS_PER_RUN,
  MECHANIC_MAX_PERIODS_PER_RUN,
  type Fact,
  type FactProposalDraft,
  type GenericEntity,
  type Mechanic,
  type Office,
  type OrderPartyRef,
  type ScenarioWarfareRules,
  type ScenarioWealthRules,
  type TerrainDefinition,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "../apply/apply-deltas";
import type { IdFactory } from "../ports";
import { firedBetween, holdsIn, watchReading } from "../watch";
import { instantiate, tagOf, type DebitLedger } from "./instantiate";
import { mechanicScale } from "./price-mechanic";
import { firingInWords, mechanicInWords } from "./mechanic-words";
import { readableRefsFor } from "./refs";
import { warrantStands } from "./validate-mechanic";

/**
 * Runs every live rule against the world as the clock arrives at `toDay`.
 *
 * Called from the burst's `tickTo`, right after the deterministic tick, where
 * the full apply context exists: a rule's effects are ordinary deltas through
 * `applyDeltas`, audited, capped and refused by the same code as anything
 * else. Rules run in entity-id order, so a replay mints the same ids.
 *
 * Idempotent across repeated calls on the same day: a monthly rule keeps its
 * next due day, a `when` rule its last reading, and an `on_fact` rule sees
 * each fact once, through the window of facts the caller hands it.
 */

export interface RunMechanicsInput {
  readonly world: WorldState;
  readonly toDay: number;
  readonly ids: IdFactory;
  /** Facts materialised since the rules last looked. */
  readonly recentFacts: readonly Fact[];
  readonly ledger: DebitLedger;
  readonly apply: {
    readonly offices: readonly Office[];
    readonly warfare: ScenarioWarfareRules;
    readonly terrains?: readonly TerrainDefinition[] | undefined;
    readonly wealth?: ScenarioWealthRules | undefined;
    readonly gameId: string;
    readonly playerCharacterId: string | null;
  };
}

export interface MechanicAuditRow {
  readonly actorRef: OrderPartyRef;
  readonly op: string;
  readonly kind: "mechanic_effect" | "mechanic_warrant_lapsed";
  readonly reason: string;
  readonly delta: WorldDelta;
}

export interface RunMechanicsResult {
  readonly world: WorldState;
  readonly facts: FactProposalDraft[];
  readonly audit: MechanicAuditRow[];
  /** How many rules fired at least once. */
  readonly fired: number;
}

const live = (entity: GenericEntity): entity is GenericEntity & { mechanic: Mechanic } =>
  entity.mechanic !== undefined && entity.mechanic.endedAtStep === null && !("retiredAtStep" in entity.attributes) && (entity.lapsedAtStep === null || entity.lapsedAtStep === undefined);

export function runMechanics(input: RunMechanicsInput): RunMechanicsResult {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  const audit: MechanicAuditRow[] = [];
  let count = 0;
  let fired = 0;

  const rules = world.genericEntities.filter(live).sort((a, b) => a.id.localeCompare(b.id));
  for (const stale of rules) {
    // The entity as it stands now: an earlier rule in this run may have moved
    // its purse.
    const entity = world.genericEntities.find((candidate) => candidate.id === stale.id);
    if (entity === undefined || !live(entity)) continue;
    const rule = entity.mechanic;
    const owner = entity.ownerRef;
    if (owner === null) continue;
    const setRule = (changes: Partial<Mechanic>): void => {
      world = { ...world, genericEntities: world.genericEntities.map((candidate) => (candidate.id === entity.id ? { ...candidate, mechanic: { ...candidate.mechanic!, ...changes } } : candidate)) };
    };
    const ownerCharacter = owner.kind === "character" ? world.characters.find((character) => character.id === owner.id) : undefined;
    const record = (kind: string, summary: string, significance: number, others: readonly OrderPartyRef[] = []): void => {
      facts.push({
        localId: `${kind}_${entity.id}_${(count += 1)}`.slice(0, 60),
        kind,
        summary,
        affectedRefs: [owner, ...others, ...(entity.provinceId === null || entity.provinceId === undefined ? [] : [{ kind: "province" as const, id: entity.provinceId }])].slice(0, 8),
        visibility: "private",
        discoveryState: "private",
        knowableInDays: 0,
        significance,
        knownToRefs: [owner, ...others.filter((ref) => ref.kind === "character")],
      });
    };
    const end = (reason: string): void => {
      setRule({ endedAtStep: input.toDay, endedReason: reason });
      record("mechanic_ended", `${entity.label} no longer runs: ${reason}.`, 30);
    };

    // 1. The end. A term is judged after the months inside it have fired: a
    // year's wait arrives in one hop, and a rule with ten months left in it
    // would otherwise end before firing once.
    if (rule.end.kind === "owner_death" && ownerCharacter !== undefined && !ownerCharacter.alive) { end("its owner died"); continue; }
    const termEnds = rule.end.kind === "term" && rule.endsAtStep !== null && input.toDay >= rule.endsAtStep;
    const lastDay = termEnds && rule.endsAtStep !== null ? rule.endsAtStep : input.toDay;
    if (rule.end.kind === "when") {
      const reading = watchReading(rule.end.predicate, world);
      const done = rule.endArmedReading !== null && firedBetween(rule.end.predicate, rule.endArmedReading, reading);
      setRule({ endArmedReading: reading });
      if (done) { end(`it ended as it was set to: ${mechanicInWords(rule, world).split("; ends when ")[1] ?? "its condition came true"}`); continue; }
    }

    // 2. How many times it is due.
    let due = 0;
    let nextDueStep = rule.nextDueStep;
    if (rule.trigger.kind === "monthly") {
      // Only as many months as this run will fire are consumed; the rest stay
      // due, so a cap on firings never loses a month.
      const first = nextDueStep ?? rule.attachedAtStep + EFFECT_PERIOD_DAYS;
      let next = first;
      while (next <= lastDay && due < Math.min(MECHANIC_MAX_PERIODS_PER_RUN, MECHANIC_MAX_FIRINGS_PER_RUN)) { due += 1; next += EFFECT_PERIOD_DAYS; }
      nextDueStep = next;
    } else if (rule.trigger.kind === "on_fact") {
      const trigger = rule.trigger;
      due = input.recentFacts.filter((fact) =>
        fact.kind === trigger.factKind
        && (trigger.subjectRef === null || fact.affectedEntities.some((entity) => entity.kind === trigger.subjectRef!.kind && entity.id === trigger.subjectRef!.id))).length;
    } else {
      const reading = watchReading(rule.trigger.predicate, world);
      if (rule.armedReading !== null && firedBetween(rule.trigger.predicate, rule.armedReading, reading)) due = 1;
      setRule({ armedReading: reading });
    }
    if (rule.trigger.kind === "monthly") setRule({ nextDueStep });
    due = Math.min(due, MECHANIC_MAX_FIRINGS_PER_RUN);
    if (due === 0) { if (termEnds) end("its term ran out"); continue; }

    // 3. Each firing: conditions, then effects through the applier.
    let firings = 0;
    let changed = 0;
    let empty = rule.emptyFirings;
    for (let round = 0; round < due; round += 1) {
      const current = world.genericEntities.find((candidate) => candidate.id === entity.id);
      if (current === undefined || !live(current)) break;
      if (!rule.conditions.every((condition) => holdsIn(condition, world))) continue;
      const refs = readableRefsFor(world, owner, current);
      const warranted = new Set<string>();
      for (const warrant of rule.debitWarrants) {
        if (warrantStands(warrant, world, refs, input.apply.offices)) warranted.add(warrant.accountId);
        else audit.push({ actorRef: owner, op: "money_transfer", kind: "mechanic_warrant_lapsed", reason: `${entity.id}: the warrant to take from ${warrant.accountId} (${warrant.basis}) no longer stands.`, delta: { op: "money_transfer", fromAccountRef: warrant.accountId, toAccountRef: null, amount: 1, reason: entity.label.slice(0, 300) } });
      }
      const scale = mechanicScale(world, current, refs.ownerPolityId);
      const owned = new Set(refs.accounts.filter((account) => account.owned).map((account) => account.id));
      const effects = rule.effects.filter((effect) => effect.op !== "money_transfer" || owned.has(effect.fromAccountId) || warranted.has(effect.fromAccountId));
      const instantiated = instantiate({ effects }, current, world, scale, input.ledger);
      firings += 1;
      if (instantiated.length === 0) { empty += 1; continue; }
      const result = applyDeltas(world, instantiated.map((item) => item.delta), {
        now: world.instant,
        actorRef: owner,
        offices: input.apply.offices,
        warfare: input.apply.warfare,
        ...(input.apply.terrains === undefined ? {} : { terrains: input.apply.terrains }),
        ...(input.apply.wealth === undefined ? {} : { wealth: input.apply.wealth }),
        ids: input.ids,
        gameId: input.apply.gameId,
        actsForTheWorld: true,
        playerCharacterId: input.apply.playerCharacterId,
        // What the rule may take from: the accounts its owner controls, and
        // those it holds a standing warrant for.
        firingMechanic: { entityId: entity.id, warrantedAccountIds: new Set([...owned, ...warranted]) },
      });
      for (const rejection of result.rejected) {
        audit.push({ actorRef: owner, op: rejection.delta.op, kind: "mechanic_effect", reason: `${entity.id}: ${rejection.reason}`, delta: rejection.delta });
      }
      const before = world;
      world = result.world;
      facts.push(...result.factProposals);
      const appliedTags = new Set(result.applied.map((applied) => tagOf(applied.delta)));
      const done = instantiated.filter((item) => appliedTags.has(tagOf(item.delta)));
      if (done.length === 0) { empty += 1; continue; }
      empty = 0;
      changed += 1;
      // The money, as a row the player's panel shows, with the rule named.
      for (const item of done) {
        const effect = item.effect;
        if (effect.op !== "money_transfer" || item.amount === null) continue;
        const from = before.material.accounts.find((account) => account.id === effect.fromAccountId);
        const to = effect.toAccountId === null ? undefined : world.material.accounts.find((account) => account.id === effect.toAccountId);
        world = {
          ...world,
          material: {
            ...world.material,
            transactions: [...world.material.transactions, {
              id: input.ids.next("txn"),
              atStep: input.toDay,
              kind: "transfer" as const,
              amount: item.amount,
              ...(from === undefined ? {} : { sourceAccountId: from.id }),
              ...(to === undefined ? {} : { destinationAccountId: to.id }),
              cause: { kind: "mechanic" as const, id: entity.id, explanation: entity.label.slice(0, 200) },
              visibility: "polity" as const,
            }].slice(-500),
          },
        };
      }
      const parties = done.flatMap((item) => { const effect = item.effect; return effect.op === "money_transfer" ? [effect.fromAccountId, effect.toAccountId] : []; })
        .filter((id): id is string => id !== null)
        .map((id) => before.material.accounts.find((account) => account.id === id)?.owner)
        .filter((party): party is { kind: "character"; id: string } => party !== undefined && party.kind === "character" && party.id !== owner.id)
        .map((party) => ({ kind: "character" as const, id: party.id }));
      record("mechanic_fired", firingInWords(entity.label, done, world), rule.firedCount + firings === 1 ? 30 : 10, parties);
    }
    if (firings > 0) {
      fired += 1;
      setRule({ firedCount: rule.firedCount + firings, changedCount: rule.changedCount + changed, lastFiredStep: input.toDay, emptyFirings: empty });
      if (empty >= MECHANIC_MAX_EMPTY_FIRINGS) { end(`it fired ${empty} times and did nothing`); continue; }
    }
    if (termEnds) end("its term ran out");
  }
  return { world, facts, audit, fired };
}
