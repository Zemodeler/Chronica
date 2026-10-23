import { beforeAll, describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, type Character, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import type { SimModelPort } from "./ports";
import { decideDispatches, spinOf } from "./dispatches";

const BASE = WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const PLAYER = "gaius-genucius";

/** The player's power, with an army of his short of bread and pay, under somebody else. */
function troubled(day = 100): { world: WorldState; commander: Character; forceId: string } {
  const player = BASE.characters.find((c) => c.id === PLAYER)!;
  const force = BASE.material.forces.find((f) => f.polityId === player.polityId && f.outlaw !== true && f.personnel.some((p) => p.fit > 0))!;
  const commander = BASE.characters.find((c) => c.id !== PLAYER && c.alive && c.polityId === player.polityId)!;
  const world: WorldState = {
    ...BASE, instant: { day, minute: 0 },
    material: { ...BASE.material, forces: BASE.material.forces.map((f) => (f.id === force.id ? { ...f, commanderCharacterId: commander.id, provisionStatus: "critical" as const, payArrearsPeriods: 2, moraleBps: 2_500 } : f)) },
  };
  return { world, commander, forceId: force.id };
}

const withMind = (world: WorldState, id: string, temperament: Partial<Character["mind"]["temperament"]>, drives: Partial<Character["mind"]["drives"]> = {}): WorldState =>
  ({ ...world, characters: world.characters.map((c) => (c.id === id ? { ...c, mind: { ...c.mind, temperament: { ...c.mind.temperament, ...temperament }, drives: { ...c.mind.drives, ...drives } } } : c)) });

describe("the people who work for the player write to him", () => {
  it("has a general tell him his army is hungry, unpaid and wavering, in a letter only the two of them know", () => {
    const { world, commander } = troubled();
    const decisions = decideDispatches(world, PLAYER);
    expect(decisions.length).toBe(1);
    const [decision] = decisions;
    expect(decision!.actorCharacterId).toBe(commander.id);
    expect(decision!.act).toBe("dispatch");
    const fact = decision!.facts[0]!;
    expect(fact.kind).toBe("dispatch");
    expect(fact.visibility).toBe("private");
    expect(fact.knownToRefs?.map((ref) => ref.id)).toEqual(expect.arrayContaining([PLAYER, commander.id]));
    expect(fact.summary).toContain(commander.name);
    expect(fact.summary.length).toBeLessThanOrEqual(400);
  });

  it("never writes about an army the player commands himself, or one in good order", () => {
    const { world, forceId } = troubled();
    const own = { ...world, material: { ...world.material, forces: world.material.forces.map((f) => (f.id === forceId ? { ...f, commanderCharacterId: PLAYER } : f)) } };
    expect(decideDispatches(own, PLAYER)).toEqual([]);
    const fine = { ...world, material: { ...world.material, forces: world.material.forces.map((f) => (f.id === forceId ? { ...f, provisionStatus: "provisioned" as const, payArrearsPeriods: 0, moraleBps: 8_000, cohesionBps: 8_000 } : f)) } };
    expect(decideDispatches(fine, PLAYER).filter((d) => d.facts[0]!.summary.includes("bread") || d.facts[0]!.summary.includes("pay"))).toEqual([]);
  });

  it("does not say the same thing again within two months, and not more than three a month", () => {
    const { world } = troubled();
    const [first] = decideDispatches(world, PLAYER);
    const logged = { ...world, instant: { day: 130, minute: 0 }, statecraft: { ...world.statecraft, log: [{ day: 100, polityId: first!.polityId, actorCharacterId: first!.actorCharacterId, act: "dispatch" as const, targetPolityId: null, why: first!.why }] } };
    expect(decideDispatches(logged, PLAYER).some((d) => d.why.split(" ")[0] === first!.why.split(" ")[0])).toBe(false);
    const later = { ...logged, instant: { day: 170, minute: 0 } };
    expect(decideDispatches(later, PLAYER).length).toBeGreaterThan(0);
    const crowded = { ...world, statecraft: { ...world.statecraft, log: Array.from({ length: 3 }, (_, i) => ({ day: 95 + i, polityId: first!.polityId, actorCharacterId: `x${i}`, act: "dispatch" as const, targetPolityId: null, why: `other:${i} supply` })) } };
    expect(decideDispatches(crowded, PLAYER)).toEqual([]);
  });

});

describe("a dispatch is a man's account, not the truth", () => {
  const key = "supply:force-1";
  const sample = (temperament: Partial<Character["mind"]["temperament"]>, drives: Partial<Character["mind"]["drives"]>) => {
    const counts = { plain: 0, play_down: 0, exaggerate: 0 };
    for (let i = 0; i < 300; i += 1) {
      const base = BASE.characters[0]!;
      const sender: Character = { ...base, id: `sender-${i}`, mind: { ...base.mind, temperament: { ...base.mind.temperament, ...temperament }, drives: { ...base.mind.drives, ...drives } } };
      counts[spinOf(sender, 100, key)] += 1;
    }
    return counts;
  };

  it("is always plain from an honest man, and sometimes shaded by one who is not", () => {
    expect(sample({ honesty: 90 }, {}).plain).toBe(300);
    const liar = sample({ honesty: 5 }, { wealth: 80, status: 80 });
    expect(liar.plain).toBeGreaterThan(20);
    expect(liar.plain).toBeLessThan(250);
    expect(liar.exaggerate + liar.play_down).toBeGreaterThan(50);
  });

  it("is made worse than it is by one who wants something, and better by one who fears the blame", () => {
    const wanting = sample({ honesty: 5, caution: 20 }, { wealth: 90, status: 90, security: 15 });
    const fearing = sample({ honesty: 5, caution: 95 }, { wealth: 15, status: 15, security: 95 });
    expect(wanting.exaggerate).toBeGreaterThan(wanting.play_down);
    expect(fearing.play_down).toBeGreaterThan(fearing.exaggerate);
  });

  it("is a different letter from different men about the same trouble", () => {
    const { world, commander } = troubled();
    const brute = decideDispatches(withMind(world, commander.id, { honesty: 5, boldness: 95, sociability: 5, cruelty: 90, caution: 5 }, { status: 95, wealth: 95 }), PLAYER)[0]!.facts[0]!.summary;
    const courtier = decideDispatches(withMind(world, commander.id, { honesty: 95, sociability: 95, boldness: 30, caution: 70 }, { duty: 95 }), PLAYER)[0]!.facts[0]!.summary;
    expect(brute).not.toBe(courtier);
  });

  it("never records in the ledger whether he shaded it", () => {
    const { world, commander } = troubled();
    const liar = withMind(world, commander.id, { honesty: 2 }, { wealth: 95, status: 95 });
    for (const decision of decideDispatches(liar, PLAYER)) expect(decision.why).not.toMatch(/exaggerat|play|lie|lied|shad|false/i);
  });
});

describe("the man who keeps the accounts", () => {
  const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
  const silent: SimModelPort = { complete: (operation) => Promise.resolve(operation === "simulate_cognition" ? JSON.stringify({ actors: [] }) : JSON.stringify({ intent: { summary: "Wait.", domains: ["administration"] }, narrativeSummary: "w", deltas: [], facts: [], outcome: "continue" })) };
  let seeded: WorldState;
  beforeAll(async () => {
    seeded = (await runSimulationBurst({
      world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0),
      clock: definition.clock, offices: definition.government.offices, successionRules: definition.government.successionRules, warfare: definition.warfare,
      terrains: definition.map.terrains, life: definition.life, wealth: definition.wealth, historicalPressures: definition.historicalPressures,
      burstId: "seed", gameId: "dispatches", actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome",
      orderText: null, spanDays: 30, knownFacts: [], queue: [], port: silent, narratorSeeds: [], budget: DEFAULT_BUDGET,
    })).world;
  }, 300_000);

  it("reports when the chest is below nothing, and says nothing while it is not", () => {
    const player = seeded.characters.find((c) => c.id === PLAYER)!;
    const quiet: WorldState = { ...seeded, material: { ...seeded.material, forces: seeded.material.forces.map((f) => (f.polityId === player.polityId ? { ...f, provisionStatus: "provisioned" as const, payArrearsPeriods: 0, moraleBps: 9_000, cohesionBps: 9_000 } : f)) } };
    expect(decideDispatches(quiet, PLAYER).some((d) => d.why.startsWith("treasury:"))).toBe(false);
    const bare: WorldState = { ...quiet, material: { ...quiet.material, accounts: quiet.material.accounts.map((a) => (a.owner.kind === "polity" && a.owner.id === player.polityId && a.status === "active" ? { ...a, balance: -500 } : a)) } };
    const treasury = decideDispatches(bare, PLAYER).find((d) => d.why.startsWith("treasury:"));
    expect(treasury).toBeDefined();
    expect(treasury!.actorCharacterId).not.toBe(PLAYER);
  });
});
