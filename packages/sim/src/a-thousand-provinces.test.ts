import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { EMPTY_ECONOMY_MEMORY, ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, isNavalForce, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { ensureConstitutions } from "./constitutions";
import { directTheWar } from "./war-direction";
import { reviewTheLand } from "./economy";
import { createIdFactory } from "./ports";
import { buildWorldSlice, renderWorldSlice } from "./slice";
import { reviewSociety } from "./society";
import { runDeterministicTick } from "./tick";

/**
 * The Seleucid Empire holds over a thousand provinces. Nothing that loops over a
 * power's ground may put them all in a prompt, a fact or a note, or spend a
 * month's time on them: a king of this size is written about as a king of a
 * dozen provinces is, with the biggest named and the rest counted.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const held = (world: WorldState, polityId: string) => world.map.provinces.filter((province) => province.controllerPolityId === polityId).length;

describe("a power of a thousand provinces", () => {
  const world = opening();
  const king = world.characters.find((character) => character.polityId === "seleucid-empire" && character.officeId?.startsWith("seleucid-empire:"))!;

  it("is that big", () => {
    expect(held(world, "seleucid-empire")).toBeGreaterThan(1_000);
  });

  it("is sent to its king as a page no longer than Rome's is to a consul", () => {
    const slice = (actorId: string, polityId: string) => renderWorldSlice(buildWorldSlice({
      world, clock: definition.clock, offices: definition.government.offices, actorRef: { kind: "character", id: actorId }, actorPolityId: polityId,
      orderText: "Look to the realm", facts: [], dueEvents: [], pendingEvents: [],
    }));
    const kings = slice(king.id, "seleucid-empire");
    const consul = slice("gaius-genucius", "rome");
    expect(kings.length).toBeLessThan(consul.length * 1.5);
    expect(kings.length).toBeLessThan(40_000);
  });

  it("seats its chambers with a dozen regional blocs at most, and names its distress in one line", () => {
    const society = reviewSociety({ world, government: { offices: definition.government.offices, successionRules: definition.government.successionRules }, warfare: definition.warfare, toDay: 0, ids: createIdFactory("big-society") }).world;
    for (const chamber of society.material.institutions.filter((institution) => institution.polityId === "seleucid-empire")) {
      expect(chamber.votingBlocs.filter((bloc) => bloc.interests?.includes("regional")).length).toBeLessThanOrEqual(12);
    }
    const starving: WorldState = {
      ...world,
      material: { ...world.material, provinceMaterial: world.material.provinceMaterial.map((row) => (world.map.provinces.find((province) => province.id === row.provinceId)?.controllerPolityId === "seleucid-empire" ? { ...row, foodSecurityBps: 3_900, stabilityBps: 3_900 } : row)) },
    };
    const before = { ...starving, material: { ...starving.material, provinceMaterial: starving.material.provinceMaterial.map((row) => ({ ...row, foodSecurityBps: 4_100, stabilityBps: 4_100 })) } };
    const ticked = runDeterministicTick({ world: { ...before, elapsedStep: 30, instant: { day: 30, minute: 0 } }, toDay: 30, ids: createIdFactory("big-tick"), warfare: definition.warfare, clock: definition.clock });
    for (const fact of ticked.factProposals) expect(fact.summary.length).toBeLessThan(700);
    for (const note of ticked.notes) expect(note.length).toBeLessThan(700);
  });

  it("reckons a month of the land -- every province's people, development and tax -- in a second or so", () => {
    // The month's pass only runs once the land has been reckoned before: one
    // that has never been is only marked (`reviewTheLand`).
    const reckoned: WorldState = { ...world, economy: { ...EMPTY_ECONOMY_MEMORY, ...world.economy, lastReviewStep: 0 } };
    const started = performance.now();
    const land = reviewTheLand({ world: reckoned, toDay: 30 });
    const spent = performance.now() - started;
    expect(land.months).toBe(1);
    expect(land.world.material.provinceMaterial.length).toBe(world.map.provinces.length);
    // The same pass opened the markets (some seventy hubs, six goods each) and ran a month of them over every province.
    const markets = land.world.economy!.markets;
    expect(markets.length).toBeGreaterThanOrEqual(40);
    expect(markets.length).toBeLessThanOrEqual(80);
    expect(markets.every((hub) => hub.goods.length === 6)).toBe(true);
    // Well inside the month's budget: a reckoning that loops a province at a time must not search the map at each.
    expect(spent).toBeLessThan(3_000);
    // A full year of it, once, in the pass's own cap of twelve months.
    const yearStarted = performance.now();
    expect(reviewTheLand({ world: reckoned, toDay: 365 }).months).toBe(12);
    expect(performance.now() - yearStarted).toBeLessThan(10_000);
  });

  it("plans a war for ten armies on that ground within a time bound", () => {
    const seleucids = world.material.forces.find((force) => force.polityId === "seleucid-empire" && !isNavalForce(force, definition.warfare))!;
    const east = world.map.provinces.filter((province) => province.controllerPolityId === "seleucid-empire").slice(0, 10);
    const armies = east.map((province, index) => ({ ...seleucids, id: `host-${index}`, name: `Host ${index}`, locationId: province.id, commanderCharacterId: seleucids.commanderCharacterId, controllerCharacterId: seleucids.controllerCharacterId }));
    const crowded: WorldState = { ...world, material: { ...world.material, forces: [...world.material.forces.filter((force) => force.id !== seleucids.id), seleucids, ...armies] } };
    const at = ensureConstitutions({ world: crowded, government: { offices: definition.government.offices, successionRules: definition.government.successionRules }, toDay: 120 });
    const warring = applyDeltas({ ...at, instant: { ...at.instant, day: 120 }, elapsedStep: 120 }, [WorldDeltaSchema.parse({ op: "agreement_open", localId: "big-war", kind: "war", polityId: "seleucid-empire", otherPolityId: "ptolemaic-egypt", terms: "The war for Coele-Syria.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "War." })], { now: at.instant, actorRef: { kind: "character", id: king.id }, actsForTheWorld: true, offices: definition.government.offices, warfare: definition.warfare, terrains: definition.map.terrains, ids: createIdFactory("big-war"), gameId: "big" } as never).world;
    const ruler = warring.characters.find((character) => character.id === king.id)!;
    const sets = { marching: new Set<string>(), fighting: new Set<string>(), besieging: new Set<string>() };
    const started = performance.now();
    const decisions = directTheWar({ world: warring, gameId: "big", polityId: "seleucid-empire", ruler, enemies: new Set(["ptolemaic-egypt"]), warfare: definition.warfare, clock: definition.clock, playedByModel: new Set(), playerCharacterId: null, sets, legacy: () => null });
    const spent = performance.now() - started;
    expect(decisions.filter((decision) => decision.act === "war_plan").length).toBeGreaterThan(0);
    // Ten armies and a thousand provinces: the plan clusters the border and the aims only, and a month of it is well inside the pass.
    expect(spent).toBeLessThan(3_000);
    // And it is not paid again for what has not changed: the second month, with the plan on record, is cheaper still or no dearer.
    const again = performance.now();
    directTheWar({ world: warring, gameId: "big", polityId: "seleucid-empire", ruler, enemies: new Set(["ptolemaic-egypt"]), warfare: definition.warfare, clock: definition.clock, playedByModel: new Set(), playerCharacterId: null, sets, legacy: () => null });
    expect(performance.now() - again).toBeLessThan(3_000);
  });

  it("takes a month of the clock in well under ten seconds", () => {
    const started = performance.now();
    runDeterministicTick({ world: { ...world, elapsedStep: 30, instant: { day: 30, minute: 0 } }, toDay: 30, ids: createIdFactory("big-month"), warfare: definition.warfare, clock: definition.clock });
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});
