import { describe, expect, it } from "vitest";
import { economyOf, fitStrengthOf, type Force, type WorldState } from "@chronica/shared";
import { DEFAULT_BUDGET, runSimulationBurst } from "./burst";
import { definition, government, withWar } from "./fiscal-test-kit";
import { stockedWorld } from "./grain-test-kit";
import { decideMagistrates } from "./magistrates";
import { forcesUnder, matchOrderTemplates, supplyDelegateOf } from "./order-templates";
import type { SimModelPort, SimOperation } from "./ports";
import { CONTRACT_FROM_MEN, chestOfPower, planSupply } from "./supply-plan";

/**
 * Find supply for my army (the user's rule, 2026-10-08): "Orders from a player should still be automatic: an order like 'find supply for my army' should automatically
 * delegate to other NPCs which in turn use deterministic ways of doing it."
 *
 * The order is read by rule, handed to the man who feeds the army (its quaestor, the head of the supply, or its commander), and he finds the bread the way an officer
 * does, in an order that is the same every time: buy it, a convoy from home, an ally's, a firm's, and, last, take it from the country at a cost to the state's name.
 */

const PLAYER = "gaius-genucius";
const ARMY = "roman-field-army";
const peace = (): WorldState => stockedWorld(150, 2.2, [], 3_000_000);
const atWar = (): WorldState => withWar(peace(), "rome", "carthage");
const armyOf = (world: WorldState): Force => world.material.forces.find((force) => force.id === ARMY)!;
const warfare = definition.warfare;
const noHouses = (world: WorldState): WorldState => ({ ...world, economy: { ...economyOf(world), houses: economyOf(world).houses.map((house) => ({ ...house, status: "wound_up" as never })) } });
const withMen = (world: WorldState, men: number): WorldState => ({ ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id !== ARMY ? force : { ...force, personnel: force.personnel.map((group, index) => ({ ...group, fit: index === 0 ? men : 0 })) })) } });
/** Whether the chest paid for bread for the army, in the books. */
const paidForBread = (world: WorldState): boolean => world.material.transactions.some((transaction) => transaction.kind === "purchase" && /Bread for Roman field army/.test(transaction.cause.explanation));
const bare = (world: WorldState): WorldState => ({ ...world, material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => ({ ...row, population: 0 })) } });

describe("the plan for an army's bread", () => {
  it("buys it where the army stands, when the country will sell it", () => {
    const world = atWar();
    const plan = planSupply(world, armyOf(world), 30, { warfare });
    expect(plan.ok).toBe(true);
    expect(plan.how).toBe("buy");
    expect(plan.days).toBe(30);
    expect(plan.shortfall).toBe(0);
    expect(plan.cost).toBeGreaterThan(0);
    expect(plan.legitimacyCost).toBe(0);
    expect(plan.deltas[0]).toMatchObject({ op: "force_provision", how: "buy", forceRef: ARMY, days: 30 });
    expect(plan.words).toMatch(/30 days' bread was bought for Roman field army/);
  });

  it("sends a convoy up from home when the market cannot give it all, and says what it costs", () => {
    const world = atWar();
    const plan = planSupply(world, armyOf(world), 90, { warfare });
    expect(plan.how).toBe("convoy");
    expect(plan.days).toBe(90);
    expect(plan.deltas[0]).toMatchObject({ op: "force_provision", how: "convoy", days: 90 });
    expect((plan.deltas[0] as { fromProvinceId: string | null }).fromProvinceId).not.toBeNull();
    expect(plan.words).toMatch(/was sent up to Roman field army from/);
    // And when the towns where it stands are held against it, a convoy is the way for thirty days too.
    const held = { ...world, map: { ...world.map, provinces: world.map.provinces.map((province) => (province.id !== armyOf(world).locationId ? province : { ...province, settlements: province.settlements.map((settlement) => ({ ...settlement, controllerPolityId: "carthage" })) })) } };
    const shut = planSupply(held, armyOf(held), 30, { warfare });
    expect(shut.how).toBe("convoy");
    expect(shut.considered.join(" ")).toMatch(/no market/);
  });

  it("lets the feeding to a firm of its own power for a great army and a long term", () => {
    const world = atWar();
    expect(fitStrengthOf(armyOf(world))).toBeGreaterThanOrEqual(CONTRACT_FROM_MEN);
    const plan = planSupply(world, armyOf(world), 200, { warfare });
    expect(plan.how).toBe("contract");
    expect(plan.deltas[0]).toMatchObject({ op: "force_provision", how: "contract" });
    expect(plan.words).toMatch(/was let to .* for 7 months/);
    expect(plan.cost).toBeGreaterThan(100_000);
    // A small army is too little to be let to a firm.
    const small = withMen(world, 800);
    expect(planSupply(small, armyOf(small), 200, { warfare }).how).not.toBe("contract");
  });

  it("takes it from the country as the last resort, and the state's name pays for it as well as the province", () => {
    const world = noHouses(atWar());
    const plan = planSupply(world, armyOf(world), 200, { warfare });
    expect(plan.ok).toBe(true);
    expect(plan.how).toBe("requisition");
    expect(plan.cost).toBe(0);
    expect(plan.legitimacyCost).toBeGreaterThan(0);
    expect(plan.legitimacyCost).toBeLessThanOrEqual(400);
    expect(plan.shortfall).toBeGreaterThan(0);
    expect(plan.deltas[0]).toMatchObject({ op: "force_provision", how: "requisition" });
    expect(plan.words).toMatch(/by requisition/);
    expect(plan.words).toMatch(/days short of the 200 asked/);
    expect(plan.words).toMatch(/The state's name is the lower for it/);
  });

  it("says it plainly when nothing can be found: no grain within reach", () => {
    const world = bare(noHouses(atWar()));
    const plan = planSupply(world, armyOf(world), 30, { warfare });
    expect(plan.ok).toBe(false);
    expect(plan.deltas).toEqual([]);
    expect(plan.refusal).toMatch(/no grain within reach of/);
    expect(plan.words).toBe(plan.refusal);
  });

  it("adds a depot where the army is to stay, and not where one stands already", () => {
    const world = atWar();
    const plan = planSupply(world, armyOf(world), 30, { warfare, stays: true });
    expect(plan.deltas.map((delta) => delta.op)).toEqual(["force_provision", "project_create"]);
    expect(plan.deltas[1]).toMatchObject({ kind: "depot", completionOutcome: { kind: "structure", structureKind: "depot", effects: [{ quantity: "supply", band: "marked" }] } });
    expect(plan.words).toMatch(/a depot is begun at/);
    expect(plan.cost).toBeGreaterThan(planSupply(world, armyOf(world), 30, { warfare }).cost);
    const standing = { ...world, structures: [...world.structures, { id: "depot-1", kind: "depot" as const, name: "Depot", provinceId: armyOf(world).locationId, settlementId: null, ownerPolityId: "rome", garrisonCapacity: 0, defensiveEffectsBps: 0, supplyRadius: 1, builtAtStep: 0, provenanceProjectId: null, effects: [], upkeep: null }] };
    expect(planSupply(standing, armyOf(standing), 30, { warfare, stays: true }).deltas.map((delta) => delta.op)).toEqual(["force_provision"]);
  });

  it("lets a poor hand waste the bread and a thief keep back his share: fewer days for the same chest", () => {
    const world = atWar();
    const honest = planSupply(world, armyOf(world), 30, { warfare });
    const poor = planSupply(world, armyOf(world), 30, { warfare, hand: { characterId: "x", name: "A clerk", competence: 20, fidelity: 20, wasteBps: 2_500, delayBps: 0, skimBps: 1_000, words: "" } });
    expect(poor.days).toBe(30);
    expect(poor.days).toBeLessThanOrEqual(honest.days);
    // He bought for more days than the army was told of, so that thirty reach the men.
    expect((poor.deltas[0] as { days: number }).days).toBeGreaterThan(30);
    expect(poor.cost).toBeGreaterThan(honest.cost);
  });

  it("is the same every time", () => {
    const world = atWar();
    expect(JSON.stringify(planSupply(world, armyOf(world), 120, { warfare, stays: true }))).toBe(JSON.stringify(planSupply(world, armyOf(world), 120, { warfare, stays: true })));
  });
});

/** A world in which the army is the player's, commanded by another man of Rome who is nobody's plot: the quaestor's work is his. */
function commanded(world: WorldState): { readonly world: WorldState; readonly delegate: string } {
  const man = world.characters.find((character) => character.alive && character.polityId === "rome" && character.id !== PLAYER && character.officeId === null
    && !world.material.forces.some((force) => force.commanderCharacterId === character.id))!;
  return { world: { ...world, material: { ...world.material, forces: world.material.forces.map((force) => (force.id !== ARMY ? force : { ...force, commanderCharacterId: man.id, controllerCharacterId: PLAYER })) } }, delegate: man.id };
}

function port(calls: SimOperation[], asked: Set<string>): SimModelPort {
  return { complete(operation, _system, user) {
    calls.push(operation);
    if (operation === "simulate_cognition") { for (const match of user.matchAll(/^## .+ \[([^\]]+)\]$/gm)) asked.add(match[1]!); return Promise.resolve('{"actors":[]}'); }
    throw new Error(`The order is read by rule and nobody is asked: ${operation}`);
  } };
}

const burst = (world: WorldState, orderText: string, calls: SimOperation[] = [], asked = new Set<string>()) => runSimulationBurst({
  world, clock: definition.clock, offices: government.offices, warfare, terrains: definition.map.terrains, successionRules: government.successionRules,
  burstId: "supply", gameId: "supply", actorRef: { kind: "character", id: PLAYER }, actorPolityId: "rome", orderText, spanDays: 3, knownFacts: [], queue: [], port: port(calls, asked), narratorSeeds: [], budget: DEFAULT_BUDGET,
});

describe("the order, handed on and answered by rule", () => {
  it("goes to the man who feeds the army, who is not asked: the bread is found, the chest pays, and the player is told", async () => {
    const { world, delegate } = commanded(peace());
    expect(supplyDelegateOf(world, armyOf(world), PLAYER)?.id).toBe(delegate);
    const calls: SimOperation[] = [];
    const asked = new Set<string>();
    const result = await burst(world, "Find supply for my army for 45 days.", calls, asked);
    expect(calls).not.toContain("simulate_orchestrate");
    expect(asked.has("the-order-was-put-to-the-model")).toBe(false);
    const attempt = result.world.orderAttempts.find((candidate) => candidate.recipientRef.id === delegate && candidate.ask?.kind === "supply")!;
    expect(attempt).toBeDefined();
    expect(attempt.issuerRef.id).toBe(PLAYER);
    expect(attempt.ask).toMatchObject({ kind: "supply", ref: ARMY, amount: 45 });
    expect(["accepted", "carried_out"]).toContain(attempt.status);
    // The bread is there: bought (days on the army's account) or on the road, and the chest is the lighter for it.
    const after = armyOf(result.world);
    expect(after.provisionedThroughStep > armyOf(world).provisionedThroughStep || result.world.convoys.some((convoy) => convoy.forceId === ARMY)).toBe(true);
    expect(paidForBread(result.world)).toBe(true);
    // And a line the player reads, in the officer's words.
    const told = result.newFacts.find((fact) => fact.kind === "request_accepted" && /found the bread for Roman field army/.test(fact.summary));
    expect(told).toBeDefined();
    expect(result.world.orders.some((order) => order.parts.some((part) => part.workRefs.some((ref) => ref.kind === "order_attempt" && ref.id === attempt.id)))).toBe(true);
  }, 120_000);

  it("is told plainly, as a refusal, when the quaestor finds no grain within reach", async () => {
    const { world, delegate } = commanded(bare(noHouses(peace())));
    const result = await burst(world, "Find supply for my army.");
    const attempt = result.world.orderAttempts.find((candidate) => candidate.recipientRef.id === delegate && candidate.ask?.kind === "supply")!;
    expect(attempt.status).toBe("refused");
    const told = result.newFacts.find((fact) => fact.kind === "request_refused" && /found no bread/.test(fact.summary));
    expect(told?.summary).toMatch(/no grain within reach/);
    expect(paidForBread(result.world)).toBe(false);
  }, 120_000);

  it("takes the last resort and the state's name pays: the standing falls, the chest does not", async () => {
    const { world } = commanded(noHouses(peace()));
    const before = world.material.polityLegitimacy.find((entry) => entry.polityId === "rome")?.legitimacyBps ?? 5_000;
    const result = await burst(world, "Find supply for my army for 300 days.");
    const after = result.world.material.polityLegitimacy.find((entry) => entry.polityId === "rome")?.legitimacyBps ?? 5_000;
    expect(after).toBeLessThan(before);
    expect(paidForBread(result.world)).toBe(false);
    expect(result.newFacts.some((fact) => /by requisition/.test(fact.summary))).toBe(true);
  }, 120_000);

  it("is done by the player himself where he commands the army and nobody feeds it for him", async () => {
    const world = peace();
    expect(forcesUnder(world, PLAYER, warfare).some((force) => supplyDelegateOf(world, force, PLAYER) === null)).toBe(true);
    const calls: SimOperation[] = [];
    const result = await burst(world, "Find supply for my army.", calls);
    expect(calls).not.toContain("simulate_orchestrate");
    expect(result.world.orderAttempts.some((attempt) => attempt.ask?.kind === "supply")).toBe(false);
    expect(armyOf(result.world).provisionedThroughStep > armyOf(world).provisionedThroughStep || result.world.convoys.some((convoy) => convoy.forceId === ARMY)).toBe(true);
  }, 120_000);

  it("is the same every time", async () => {
    const { world } = commanded(peace());
    const a = await burst(world, "Find supply for my army for 45 days.");
    const b = await burst(world, "Find supply for my army for 45 days.");
    expect(JSON.stringify(a.world)).toBe(JSON.stringify(b.world));
  }, 180_000);
});

describe("the officers go on feeding the army that was handed to one", () => {
  it("feeds, month by month, an army of the player's own power that he handed to an officer, and no other", () => {
    const base = withWar(peace(), "rome", "carthage");
    const hungry: WorldState = { ...base, material: { ...base.material, forces: base.material.forces.map((force) => (force.id !== ARMY ? force : { ...force, provisionStatus: "unprovisioned" as never, provisionedThroughStep: 0 })) } };
    const input = (world: WorldState) => ({ world, gameId: "supply", excludedPolityIds: new Set(["rome"]), playedByModel: new Set<string>(), playerCharacterId: PLAYER, offices: government.offices, warfare });
    // The power is the player's: the rules leave it alone, whoever is hungry.
    expect(decideMagistrates(input(hungry)).filter((decision) => decision.polityId === "rome")).toEqual([]);
    const handed: WorldState = { ...hungry, orderAttempts: [...hungry.orderAttempts, {
      id: "order-supply-1", actionId: "action-supply-1", issuerRef: { kind: "character", id: PLAYER }, recipientRef: { kind: "character", id: "gnaeus-cornelius" },
      claimedAuthorityGrantId: null, authorityCheck: { authorized: true, grant: null, standing: null, reason: "" }, instruction: "Find bread for Roman field army.", standing: "binding",
      status: "carried_out", recipientDecisionReason: null, issuedAtStep: 140, decidedAtStep: 141, consequenceFactRefs: [], servesRef: null, ask: { kind: "supply", ref: ARMY, amount: 30 },
    }] };
    const fed = decideMagistrates(input(handed)).filter((decision) => decision.polityId === "rome");
    expect(fed).toHaveLength(1);
    expect(fed[0]!.deltas[0]).toMatchObject({ op: "force_provision", forceRef: ARMY });
    // A year on, the charge has lapsed.
    expect(decideMagistrates(input({ ...handed, elapsedStep: handed.elapsedStep + 400, instant: { day: handed.instant.day + 400, minute: 0 } })).filter((decision) => decision.polityId === "rome")).toEqual([]);
  });
});

describe("a quaestor, or any man of the supply, may say it of the consul's army", () => {
  const quaestor = (world: WorldState): string => world.material.officeSeats.find((seat) => seat.status === "held" && /quaestor/.test(seat.officeId))!.holderCharacterId!;
  const privateMan = (world: WorldState): string => world.characters.find((c) => c.alive && c.polityId === "rome" && !world.material.officeSeats.some((s) => s.holderCharacterId === c.id && s.status === "held") && !world.material.forces.some((f) => f.commanderCharacterId === c.id))!.id;

  it("finds the army of his own power, named or the main field army, though he commands none", () => {
    const world = atWar();
    const q = quaestor(world);
    expect(forcesUnder(world, q, warfare)).toEqual([]);
    expect(forcesUnder(world, q, warfare, { forSupply: true }).map((force) => force.id)).toContain(ARMY);
    for (const said of ["Find supply for the army of the consul for two months.", "Find supply for the Roman field army."]) {
      const match = matchOrderTemplates(world, q, said, warfare);
      expect(match, said).not.toBeNull();
      expect(match!.templates).toEqual(["supply"]);
      expect(match!.output.deltas.some((delta) => delta.op === "force_provision")).toBe(true);
    }
  });

  it("is no help to a private man, who holds no charge of the bread", () => {
    const world = atWar();
    expect(forcesUnder(world, privateMan(world), warfare, { forSupply: true })).toEqual([]);
    expect(matchOrderTemplates(world, privateMan(world), "Find supply for the army of the consul.", warfare)).toBeNull();
  });
});
