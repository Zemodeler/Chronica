import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { resolveEngagement } from "./battle";
import { circleName, gensAdjective } from "./group-names";
import { createIdFactory } from "./ports";
import { reviewSociety } from "./society";
import { runDeterministicTick } from "./tick";

/**
 * What the Clepsina save showed by December 270, each fixed here:
 *
 * - Legio I stood in Bruttium for three months: four orders to cross, and
 *   none could, because the strait took one fleet carrying every man at once.
 * - The Anio waterworks "completed" eight times and never stood: no province.
 * - Carthage won at Agrigentum, on its own ground, and lost grip of it.
 * - Hulls were counted as men, and "wounded".
 * - Rome went to war with Carthage in a delta nobody wrote a fact for.
 * - Messana ended the year under two protectors.
 * - Four factions added their own seats to the Senate, 119 votes became 256.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context = (overrides: Partial<ApplyContext> = {}): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("december"),
  gameId: "game-december",
  ...overrides,
});
const BRUTTIUM = PUNIC_IDS.rhegium;
const MESSANA = PUNIC_IDS.messana;
/** A province up the coast from Rhegium, a day's sail from it: near enough for hulls to be sent for. */
const UP_THE_COAST = (() => {
  const edge = punicWarsScenario.initialWorld.map.edges.find((candidate) => candidate.crossing === "land" && (candidate.from === BRUTTIUM || candidate.to === BRUTTIUM))!;
  return edge.from === BRUTTIUM ? edge.to : edge.from;
})();
const AGRIGENTUM = PUNIC_IDS.agrigentum;
const forceOf = (state: WorldState, id: string) => state.material.forces.find((force) => force.id === id)!;

/** Legio I on the Italian shore, the Greek hulls with it, and forty hired transports a province or two up the coast. */
function beforeTheCrossing(): WorldState {
  const state = world();
  const hulls = forceOf(state, "allied-greek-hulls");
  const transports = {
    ...hulls,
    id: "campanian-transports",
    name: "Campanian transports",
    locationId: UP_THE_COAST,
    positionId: null,
    personnel: [{ categoryId: "warship", label: "Transports", fit: 40, unavailable: [] }],
    memberCharacterIds: [],
    history: [],
    payObligationId: null,
  };
  return {
    ...state,
    material: {
      ...state.material,
      forces: [
        ...state.material.forces.map((force) =>
          force.id === "roman-field-army" || force.id === "allied-greek-hulls" ? { ...force, locationId: BRUTTIUM, positionId: null } : force),
        transports,
      ],
    },
  };
}

describe("an army ferried over in loads", () => {
  it("crosses the strait in several loads in the ships it has, sending for the ones nearby, and the ships go with it", () => {
    const start = beforeTheCrossing();
    const cross = WorldDeltaSchema.parse({ op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, reason: "Cross with the ships we have." });
    const result = applyDeltas(start, [cross], context());
    expect(result.rejected).toEqual([]);
    // Still on the Italian shore today: a crossing in loads takes days.
    expect(forceOf(result.world, "roman-field-army").locationId).toBe(BRUTTIUM);
    const begun = result.factProposals.find((fact) => fact.kind === "crossing_begun");
    expect(begun?.summary).toMatch(/loads/);
    expect(begun?.summary).toMatch(/Campanian transports/);
    const crossing = result.world.projects.find((project) => project.completionOutcome?.kind === "force_move");
    const due = crossing!.milestones.at(-1)!.requiredAtElapsedOffset;
    expect(due).toBeGreaterThan(2);

    let state = result.world;
    for (let day = 5; day <= due + 5; day += 5) {
      state = runDeterministicTick({ world: { ...state, elapsedStep: day }, toDay: day, ids: createIdFactory(`cross-${day}`), warfare: definition.warfare }).world;
    }
    expect(forceOf(state, "roman-field-army").locationId).toBe(MESSANA);
    expect(forceOf(state, "allied-greek-hulls").locationId).toBe(MESSANA);
    expect(forceOf(state, "campanian-transports").locationId).toBe(MESSANA);
  });

  it("still refuses when the ships within reach would take more loads than a crossing can", () => {
    const state = world();
    const alone: WorldState = {
      ...state,
      material: { ...state.material, forces: state.material.forces.map((force) => (force.id === "roman-field-army" || force.id === "allied-greek-hulls" ? { ...force, locationId: BRUTTIUM } : force)) },
    };
    const result = applyDeltas(alone, [WorldDeltaSchema.parse({ op: "force_modify", forceRef: "roman-field-army", locationId: MESSANA, reason: "Cross." })], context());
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/loads, more than/);
  });
});

describe("a building nobody placed", () => {
  it("stands in its builder's capital when the project named no province", () => {
    const build = WorldDeltaSchema.parse({
      op: "project_create", localId: "anio", kind: "waterworks", label: "Bring the Anio water to Rome",
      sponsorRef: { kind: "character", id: "gaius-genucius" }, fundingAccountRef: null,
      milestones: [{ label: "Build it", dueInDays: 5, costAmount: 0 }],
      completionOutcome: {
        kind: "structure", label: "Anio waterworks", amount: 0, provinceId: null, polityId: null, commanderCharacterRef: null,
        forceRef: null, beneficiaryAccountRef: null, cadenceDays: null, agreementKind: null, withPolityId: null,
        structureKind: "other", effects: [{ quantity: "food_security", direction: "raise", band: "slight", scope: "here" }],
      },
      reason: "Water for Rome.",
    });
    const result = applyDeltas(world(), [build], context());
    expect(result.rejected).toEqual([]);
    const after = runDeterministicTick({ world: { ...result.world, elapsedStep: 10 }, toDay: 10, ids: createIdFactory("anio"), warfare: definition.warfare }).world;
    const built = after.structures.find((structure) => structure.name === "Anio waterworks");
    expect(built).toBeDefined();
    expect(built!.ownerPolityId).toBe("rome");
  });
});

describe("a fleet fight", () => {
  const atAgrigentum = (): WorldState => {
    const state = world();
    return {
      ...state,
      material: {
        ...state.material,
        forces: state.material.forces.map((force) => (force.id === "carthaginian-fleet" || force.id === "allied-greek-hulls" ? { ...force, locationId: AGRIGENTUM, positionId: null } : force)),
      },
    };
  };

  it("counts ships, and a winner fighting on its own ground keeps its grip", () => {
    const state = atAgrigentum();
    const result = resolveEngagement({
      world: state, attacker: forceOf(state, "carthaginian-fleet"), defender: forceOf(state, "allied-greek-hulls"),
      posture: "offer_battle", tactic: null, warfare: definition.warfare, battleId: "battle-agrigentum", seed: "agrigentum",
    }, 0);
    const battle = result.facts.find((fact) => fact.kind === "battle");
    expect(battle?.summary).toMatch(/ships/);
    expect(battle?.summary).not.toMatch(/Allied Greek hulls suffers/);
    expect(result.account!.sides.every((side) => side.unit === "ships")).toBe(true);
    expect(result.facts.some((fact) => fact.kind === "province_control_weakened")).toBe(false);
  });
});

describe("wars and protectors", () => {
  const open = (delta: Record<string, unknown>): WorldDelta => WorldDeltaSchema.parse({
    op: "agreement_open", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Because.", ...delta,
  });

  it("tells every war that opens", () => {
    const result = applyDeltas(world(), [open({ localId: "punic_war", kind: "war", polityId: "rome", otherPolityId: "carthage", terms: "Over Messana and the strait." })], context());
    expect(result.rejected).toEqual([]);
    const declared = result.factProposals.find((fact) => fact.kind === "war_declared");
    expect(declared?.summary).toMatch(/went to war/);
    expect(declared?.significance).toBeGreaterThanOrEqual(70);
  });

  it("refuses a second protector, and turns a protectorate written backwards the right way round", () => {
    const first = applyDeltas(world(), [open({ localId: "rome_protects", kind: "protectorate", polityId: "rome", otherPolityId: "mamertines", terms: "Rome protects Messana." })], context());
    expect(first.rejected).toEqual([]);
    const made = first.world.polityAgreements.find((agreement) => agreement.kind === "protectorate" && agreement.status === "active");
    expect(made).toMatchObject({ polityId: "mamertines", otherPolityId: "rome" });

    const second = applyDeltas(first.world, [open({ localId: "carthage_protects", kind: "protectorate", polityId: "carthage", otherPolityId: "mamertines", terms: "Carthage protects Messana." })], context({ ids: createIdFactory("second") }));
    expect(second.rejected).toHaveLength(1);
    expect(second.rejected[0]!.reason).toMatch(/already under the protection of/);
  });
});

describe("the Senate's factions", () => {
  it("carve their seats out of the house instead of adding to it, and take Roman names", () => {
    const base = world();
    const senate = base.material.institutions.find((institution) => institution.id === "roman-senate")!;
    const before = senate.votingBlocs.reduce((sum, bloc) => sum + bloc.weight, 0);
    const circles = ["manius-curius", "lucius-papirius", "quintus-fabius", "spurius-carvilius"]
      .filter((id) => base.characters.some((character) => character.id === id))
      .map((id, index) => ({
        id: `group:test:${id}`, name: `Circle ${index}`, polityId: "rome", type: "faction" as const, leaderCharacterId: id,
        platform: ["Whatever he wants"], resourceAccountId: null, publicReputationBps: 5_000, active: true, emergentKey: null,
        strengthBps: 10_000, interest: "faction" as const, foundedAtStep: 0, endedAtStep: null,
      }));
    expect(circles.length).toBeGreaterThanOrEqual(2);
    const withCircles: WorldState = { ...base, material: { ...base.material, politicalGroups: [...base.material.politicalGroups, ...circles] } };
    const reviewed = reviewSociety({ world: withCircles, government, warfare: definition.warfare, toDay: 0, ids: createIdFactory("seats") }).world;
    const seated = reviewed.material.institutions.find((institution) => institution.id === "roman-senate")!;
    const after = seated.votingBlocs.reduce((sum, bloc) => sum + bloc.weight, 0);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(seated.votingBlocs.length);
    const groupSeats = seated.votingBlocs.filter((bloc) => bloc.groupId != null).reduce((sum, bloc) => sum + bloc.weight, 0);
    expect(groupSeats).toBeLessThanOrEqual(Math.ceil(before * 0.4) + circles.length);
    // Seated again, the standing orders do not shrink a second time.
    const again = reviewSociety({ world: { ...reviewed, society: { ...reviewed.society, lastReviewStep: -60 } }, government, warfare: definition.warfare, toDay: 0, ids: createIdFactory("seats-2") }).world;
    expect(again.material.institutions.find((institution) => institution.id === "roman-senate")!.votingBlocs.reduce((sum, bloc) => sum + bloc.weight, 0)).toBe(after);
    expect(seated.votingBlocs.map((bloc) => bloc.name)).toContain("The patrician houses");
  });

  it("names a circle after its leader's gens, and tells two of one gens apart", () => {
    const fabius = { name: "Quintus Fabius Maximus Gurges", cultureId: "roman" };
    expect(gensAdjective(fabius)).toBe("Fabian");
    expect(circleName(fabius, new Set())).toBe("The Fabian circle");
    expect(circleName({ name: "Quintus Fabius Pictor", cultureId: "roman" }, new Set(["The Fabian circle"]))).toBe("The circle of Fabius Pictor");
    expect(circleName({ name: "Manius Curius Dentatus", cultureId: "roman" }, new Set())).toBe("The Curian circle");
    expect(circleName({ name: "Hanno of Carthage", cultureId: "carthaginian" }, new Set())).toBe("Hanno's following");
  });
});
