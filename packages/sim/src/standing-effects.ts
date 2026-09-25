import {
  DEFAULT_STRUCTURE_EFFECTS,
  EFFECT_PERIOD_DAYS,
  adjustPolityLegitimacy,
  convertIn,
  effectWorth,
  faithNamed,
  treasuryOf,
  type FactProposalDraft,
  type ProvinceTargets,
  type StandingEffect,
  type StandingUpkeep,
  type WorldState,
} from "@chronica/shared";
import type { IdFactory } from "./ports";

/**
 * Made things doing what they were made to do (see `world/standing-effects.ts`).
 *
 * Two halves, because the quantities are two kinds of thing. Levels -- how
 * calm, how fed, how productive a province settles to, how many can be called
 * up -- are handed to the province recovery pass as targets, so a temple makes
 * a calmer place rather than a place that grows calmer every month without
 * end. Flows -- upkeep, income, converts -- are settled once a month here.
 *
 * A thing that cannot be paid for stops. That is the whole of what keeps an
 * answer that founds forty temples from founding forty temples' worth of
 * order: each has a keeper who must be paid, and the money runs out.
 */

interface Carrier {
  readonly where: "structure" | "entity";
  readonly id: string;
  readonly label: string;
  readonly provinceId: string | null;
  readonly ownerPolityId: string | null;
  /** Where its income goes. */
  readonly ownerAccountId: string | null;
  readonly effects: readonly StandingEffect[];
  readonly upkeep: StandingUpkeep | null;
  readonly settledThrough: number | null;
  readonly startedAt: number;
}

function ownerAccountOf(world: WorldState, ref: { readonly kind: string; readonly id: string } | null): string | null {
  if (ref === null) return null;
  if (ref.kind === "polity") return treasuryOf(world, ref.id);
  return world.material.accounts.find((account) => account.owner.kind === ref.kind && account.owner.id === ref.id && account.status === "active")?.id ?? null;
}

function ownerPolityOf(world: WorldState, ref: { readonly kind: string; readonly id: string } | null): string | null {
  if (ref === null) return null;
  if (ref.kind === "polity") return ref.id;
  if (ref.kind === "character") return world.characters.find((character) => character.id === ref.id)?.polityId ?? null;
  return null;
}

/** Everything standing that still does something: not lapsed, not repealed, carrying effects or a cost. */
export function standingCarriers(world: WorldState): Carrier[] {
  // A building nobody gave effects to does what its kind does -- the academy
  // a scenario authored trains people whether or not anyone said so.
  const effectsOf = (structure: WorldState["structures"][number]) => structure.effects ?? DEFAULT_STRUCTURE_EFFECTS[structure.kind] ?? [];
  const structures = world.structures
    .filter((structure) => structure.lapsedAtStep == null && (effectsOf(structure).length > 0 || structure.upkeep != null))
    .map((structure): Carrier => ({
      where: "structure",
      id: structure.id,
      label: structure.name,
      provinceId: structure.provinceId,
      ownerPolityId: structure.ownerPolityId,
      ownerAccountId: structure.ownerPolityId === null ? null : treasuryOf(world, structure.ownerPolityId),
      effects: effectsOf(structure),
      upkeep: structure.upkeep ?? null,
      settledThrough: structure.effectsSettledThroughStep ?? null,
      startedAt: structure.builtAtStep,
    }));
  const entities = world.genericEntities
    .filter((entity) => entity.lapsedAtStep == null && !("retiredAtStep" in entity.attributes)
      && ((entity.effects?.length ?? 0) > 0 || entity.upkeep != null))
    .map((entity): Carrier => ({
      where: "entity",
      id: entity.id,
      label: entity.label,
      provinceId: entity.provinceId ?? null,
      ownerPolityId: ownerPolityOf(world, entity.ownerRef),
      ownerAccountId: ownerAccountOf(world, entity.ownerRef),
      effects: entity.effects ?? [],
      upkeep: entity.upkeep ?? null,
      settledThrough: entity.effectsSettledThroughStep ?? null,
      startedAt: entity.createdAtStep,
    }));
  return [...structures, ...entities];
}

/** The provinces an effect acts on: where the thing stands, or every province its owner holds. */
function provincesOf(world: WorldState, carrier: Carrier, effect: StandingEffect): string[] {
  if (effect.scope === "here" && carrier.provinceId !== null) return [carrier.provinceId];
  if (carrier.ownerPolityId === null) return carrier.provinceId === null ? [] : [carrier.provinceId];
  return world.map.provinces.filter((province) => province.controllerPolityId === carrier.ownerPolityId).map((province) => province.id);
}

/** No pile of buildings moves a province further than this from its ordinary level. */
const MAX_SHIFT_BPS = 4_000;
const MAX_MANPOWER_SHIFT = 1;

/** Where each province now settles back to, from everything standing in or over it. */
export function provinceTargetsFrom(world: WorldState): Map<string, ProvinceTargets> {
  const sums = new Map<string, { stability: number; food: number; productive: number; manpower: number }>();
  for (const carrier of standingCarriers(world)) {
    for (const effect of carrier.effects) {
      if (!["stability", "food_security", "productive_capacity", "manpower"].includes(effect.quantity)) continue;
      for (const provinceId of provincesOf(world, carrier, effect)) {
        const sum = sums.get(provinceId) ?? { stability: 0, food: 0, productive: 0, manpower: 0 };
        if (effect.quantity === "stability") sum.stability += effectWorth.baselineShiftBps(effect);
        if (effect.quantity === "food_security") sum.food += effectWorth.baselineShiftBps(effect);
        if (effect.quantity === "productive_capacity") sum.productive += effectWorth.baselineShiftBps(effect);
        if (effect.quantity === "manpower") sum.manpower += effectWorth.manpowerShift(effect);
        sums.set(provinceId, sum);
      }
    }
  }
  const clamp = (value: number, max: number) => Math.max(-max, Math.min(max, value));
  return new Map([...sums].map(([provinceId, sum]) => [provinceId, {
    stabilityShiftBps: clamp(sum.stability, MAX_SHIFT_BPS),
    foodSecurityShiftBps: clamp(sum.food, MAX_SHIFT_BPS),
    productiveCapacityShiftBps: clamp(sum.productive, MAX_SHIFT_BPS),
    manpowerShift: clamp(sum.manpower, MAX_MANPOWER_SHIFT),
  }]));
}

/** How good the people raised in a province are, from what stands there to train them. */
export function recruitSkillBiasIn(world: WorldState, provinceId: string): number {
  let bias = 0;
  for (const carrier of standingCarriers(world)) {
    for (const effect of carrier.effects) {
      if (effect.quantity === "recruit_skill" && provincesOf(world, carrier, effect).includes(provinceId)) bias += effectWorth.recruitSkill(effect);
    }
  }
  return Math.max(-20, Math.min(20, bias));
}

/**
 * What one month is worth in this place, so the same word means the same sum
 * in every scenario: a province's own tax capacity, or the average of the
 * owner's where the thing stands nowhere in particular.
 */
function scaleOf(world: WorldState, carrier: Carrier): number {
  return arrangementScale(world, carrier.provinceId, carrier.ownerPolityId);
}

/** The monthly figure a made thing's effects are shares of: its province's tax capacity, or its owner's average. */
export function arrangementScale(world: WorldState, provinceId: string | null, ownerPolityId: string | null): number {
  const capacity = (id: string) => world.material.provinceMaterial.find((row) => row.provinceId === id)?.taxCapacity ?? 0;
  if (provinceId !== null) return Math.max(1, capacity(provinceId));
  const held = world.map.provinces.filter((province) => province.controllerPolityId === ownerPolityId);
  if (held.length === 0) return 1;
  return Math.max(1, Math.round(held.reduce((sum, province) => sum + capacity(province.id), 0) / held.length));
}

/**
 * What an arrangement clears each month: what its income effects pay its
 * owner, less what its keep costs. The figure a founding price is set from,
 * so that a stall set up as an arrangement pays for itself over the same
 * months a venture does, and the one is never a cheaper way to the other.
 */
export function arrangementNetIncome(
  world: WorldState,
  thing: {
    readonly provinceId: string | null;
    readonly ownerRef: { readonly kind: string; readonly id: string } | null;
    readonly effects: readonly StandingEffect[];
    readonly upkeepBand: StandingUpkeep["band"] | null;
  },
): number {
  const scale = arrangementScale(world, thing.provinceId, ownerPolityOf(world, thing.ownerRef));
  const income = thing.effects
    .filter((effect) => effect.quantity === "income")
    .reduce((sum, effect) => sum + scale * effectWorth.incomeShare(effect), 0);
  const keep = thing.upkeepBand === null ? 0 : Math.max(1, scale * effectWorth.upkeepShare(thing.upkeepBand));
  return Math.round(income - keep);
}

/** Half the province believing is when a Chronicle should hear of it. */
const MAJORITY_BPS = 5_000;

export function settleStandingEffects(input: { readonly world: WorldState; readonly toDay: number; readonly ids: IdFactory }): { world: WorldState; facts: FactProposalDraft[] } {
  let world = input.world;
  const facts: FactProposalDraft[] = [];
  let count = 0;
  const account = (id: string) => world.material.accounts.find((candidate) => candidate.id === id);
  const move = (from: string | null, to: string | null, amount: number, kind: "upkeep" | "income", carrier: Carrier): void => {
    if (amount <= 0 || from === to) return;
    world = {
      ...world,
      material: {
        ...world.material,
        accounts: world.material.accounts.map((candidate) => {
          if (candidate.id === from) return { ...candidate, balance: Math.max(0, candidate.balance - amount) };
          if (candidate.id === to) return { ...candidate, balance: candidate.balance + amount };
          return candidate;
        }),
        transactions: [...world.material.transactions, {
          id: input.ids.next("txn"),
          atStep: input.toDay,
          kind,
          amount,
          ...(from === null ? {} : { sourceAccountId: from }),
          ...(to === null ? {} : { destinationAccountId: to }),
          cause: { kind: kind === "upkeep" ? "obligation" as const : "scheduled_income" as const, id: carrier.id, explanation: carrier.label },
          visibility: "polity" as const,
        }].slice(-500),
      },
    };
  };
  const mark = (carrier: Carrier, change: { effectsSettledThroughStep?: number; lapsedAtStep?: number }): void => {
    world = carrier.where === "structure"
      ? { ...world, structures: world.structures.map((structure) => (structure.id === carrier.id ? { ...structure, ...change } : structure)) }
      : { ...world, genericEntities: world.genericEntities.map((entity) => (entity.id === carrier.id ? { ...entity, ...change } : entity)) };
  };
  const legitimacy = (carrier: Carrier, sign: 1 | -1, why: string): void => {
    if (carrier.ownerPolityId === null) return;
    for (const effect of carrier.effects) {
      if (effect.quantity !== "legitimacy") continue;
      world = {
        ...world,
        material: {
          ...world.material,
          polityLegitimacy: adjustPolityLegitimacy(world.material.polityLegitimacy, carrier.ownerPolityId, sign * effectWorth.legitimacyBps(effect), why, `${carrier.id}-${sign > 0 ? "stands" : "falls"}`),
        },
      };
    }
  };

  for (const carrier of standingCarriers(world)) {
    // Coming into force: what it does once, while it stands.
    let settled = carrier.settledThrough;
    if (settled === null) {
      legitimacy(carrier, 1, `${carrier.label} stands`);
      settled = carrier.startedAt;
      mark(carrier, { effectsSettledThroughStep: settled });
    }

    const periods = Math.floor((input.toDay - settled) / EFFECT_PERIOD_DAYS);
    let lapsed = false;
    for (let period = 0; period < periods && !lapsed; period += 1) {
      const scale = scaleOf(world, carrier);
      if (carrier.upkeep !== null) {
        const due = Math.max(1, Math.round(scale * effectWorth.upkeepShare(carrier.upkeep.band)));
        const payer = account(carrier.upkeep.fromAccountId);
        if (payer === undefined || payer.balance < due) {
          lapsed = true;
          legitimacy(carrier, -1, `${carrier.label} falls into disuse`);
          mark(carrier, { lapsedAtStep: input.toDay });
          facts.push({
            localId: `lapsed_${(count += 1)}`,
            kind: "arrangement_lapsed",
            summary: `${carrier.label} fell into disuse: nobody could pay for its keep.`,
            affectedRefs: [
              ...(carrier.provinceId === null ? [] : [{ kind: "province" as const, id: carrier.provinceId }]),
              ...(carrier.ownerPolityId === null ? [] : [{ kind: "polity" as const, id: carrier.ownerPolityId }]),
            ],
            visibility: "polity",
            discoveryState: "polity",
            knowableInDays: 0,
            significance: 40,
          });
          break;
        }
        move(payer.id, null, due, "upkeep", carrier);
      }
      for (const effect of carrier.effects) {
        if (effect.quantity === "income" && carrier.ownerAccountId !== null) {
          const amount = Math.round(scale * effectWorth.incomeShare(effect));
          if (amount > 0) move(null, carrier.ownerAccountId, amount, "income", carrier);
          if (amount < 0) move(carrier.ownerAccountId, null, -amount, "upkeep", carrier);
        }
        if (effect.quantity === "conversion" && effect.faith !== undefined) {
          const founded = faithNamed(world, effect.faith, input.toDay);
          world = founded.world;
          for (const provinceId of provincesOf(world, carrier, effect)) {
            const before = world.faithAdherence.find((row) => row.provinceId === provinceId && row.faithId === founded.faithId)?.shareBps ?? 0;
            const converted = convertIn(world, provinceId, founded.faithId, effectWorth.conversionBps(effect));
            world = converted.world;
            if (before < MAJORITY_BPS && converted.shareBps >= MAJORITY_BPS) {
              const faith = world.faiths.find((candidate) => candidate.id === founded.faithId)!.name;
              const place = world.map.provinces.find((province) => province.id === provinceId)?.name ?? provinceId;
              facts.push({
                localId: `faith_${(count += 1)}`,
                kind: "faith_majority",
                summary: `Most of the people of ${place} now follow ${faith}.`,
                affectedRefs: [{ kind: "province", id: provinceId }],
                visibility: "public",
                discoveryState: "public",
                knowableInDays: 0,
                significance: 60,
              });
            }
          }
        }
      }
    }
    if (!lapsed && periods > 0) mark(carrier, { effectsSettledThroughStep: settled + periods * EFFECT_PERIOD_DAYS });
  }
  return { world, facts };
}
