import { punicWarsScenario } from "@chronica/db";
import {
  PolityAgreementSchema,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  ensureProvinceMaterial,
  economyOf,
  type WorldState,
} from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { ensureConstitutions } from "./constitutions";
import { createIdFactory } from "./ports";
import { ledgerEntry, type StatecraftDecision } from "./statecraft";

/**
 * A kit for the tests of the people who keep a power's books and the houses that lend to it: the Punic
 * opening with its constitutions seated, set to a day, with a war to open, a chest to empty and
 * a decision to apply as the burst would (the rules' own business, `actsForTheWorld`).
 */
export const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
export const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };

export function opening(day = 120): WorldState {
  const world = ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government, toDay: 0 });
  return { ...world, instant: { day, minute: 0 }, elapsedStep: day };
}

export const atDay = (world: WorldState, day: number): WorldState => ({ ...world, instant: { ...world.instant, day }, elapsedStep: day });

/** Powers nobody plays: everyone but the one the player is, and the model plays nobody. */
export const input = (world: WorldState, playerPolity = "rome", gameId = "game-fiscal") => ({
  world, gameId, excludedPolityIds: new Set([playerPolity]), playedByModel: new Set<string>(), playerCharacterId: null as string | null,
});

export function withWar(world: WorldState, a: string, b: string): WorldState {
  return {
    ...world,
    polityAgreements: [...world.polityAgreements, PolityAgreementSchema.parse({ id: `war-${a}-${b}`, kind: "war", polityId: a, otherPolityId: b, terms: "A war over the strait.", sinceStep: 0, status: "active" })],
  };
}

/** A power's chest set to a sum, and every payment it owes put behind by some of it. */
export function withChest(world: WorldState, polityId: string, balance: number, arrears = 0): WorldState {
  const chest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId)!.id;
  let marked = false;
  return {
    ...world,
    material: {
      ...world.material,
      accounts: world.material.accounts.map((account) => (account.id === chest ? { ...account, balance } : account)),
      obligations: world.material.obligations.map((obligation) => {
        if (arrears === 0 || marked || !obligation.active || obligation.payerAccountId !== chest) return obligation;
        marked = true;
        return { ...obligation, arrears, missedPeriods: 1 };
      }),
    },
  };
}

/** What a power's sources bring in, set to a share of what they brought (zero: nothing comes in). */
export function withIncome(world: WorldState, polityId: string, share: number): WorldState {
  const chest = world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId)!.id;
  return {
    ...world,
    material: {
      ...world.material,
      incomeSources: world.material.incomeSources.map((source) => (source.beneficiaryAccountId === chest ? { ...source, amount: Math.round(source.amount * share) } : source)),
    },
  };
}

/** The decision applied as the burst would apply it: by its officer, for the world. Returns the world after, and what was refused. */
export function applyDecision(world: WorldState, decision: StatecraftDecision, day = world.instant.day) {
  const result = applyDeltas(world, [...decision.deltas], {
    now: { day, minute: 540 }, actorRef: { kind: "character", id: decision.actorCharacterId }, offices: government.offices, successionRules: government.successionRules,
    warfare: definition.warfare, terrains: definition.map.terrains, clock: definition.clock, ids: createIdFactory(`fiscal-${decision.polityId}-${day}`), gameId: "game-fiscal", actsForTheWorld: true,
    // As the burst applies a fiscal decision: the power's own standing business.
    sanctionedDeltas: new Set(decision.deltas),
  });
  return { world: result.world, rejected: result.rejected, applied: result.applied };
}

/** The decision written in the log, as the burst writes it. */
export const logged = (world: WorldState, decision: StatecraftDecision): WorldState => ({
  ...world, statecraft: { ...world.statecraft, log: [...world.statecraft.log, ledgerEntry(decision, world.instant.day)] },
});

export const rateOf = (world: WorldState, polityId: string): number | undefined => economyOf(world).taxPolicies.find((policy) => policy.polityId === polityId)?.rateBps;
export const treasuryBalance = (world: WorldState, polityId: string): number =>
  world.material.accounts.find((account) => account.owner.kind === "polity" && account.owner.id === polityId)!.balance;
