import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, openWar, type WorldState } from "@chronica/shared";
import { ensureConstitutions } from "./constitutions";
import { reviewPushback } from "./pushback";

/**
 * The world pushes back (docs/plans/a-living-world.md §5): a power that grows
 * fast and roughly frightens the powers around it, and frightened powers
 * league together, pay its enemies, and remember who broke faith.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: definition.government, toDay: 0 });
const at = (world: WorldState, day: number): WorldState => ({ ...world, instant: { ...world.instant, day }, elapsedStep: day });
const none = new Set<string>();

describe("the world pushes back", () => {
  it("fears a power that has doubled its land in a year, and says so", () => {
    const world = at(opening(), 400);
    const owned = world.map.provinces.filter((province) => province.controllerPolityId === "macedon").length;
    // A year ago Macedon held half of what it holds now.
    const grown = { ...world, holdings: [{ polityId: "macedon", atStep: 30, provinces: Math.floor(owned / 2) }] };
    const result = reviewPushback(grown, null, none);
    const epirus = result.world.alarm.find((entry) => entry.polityId === "epirus" && entry.towardPolityId === "macedon");
    expect(epirus?.level).toBeGreaterThanOrEqual(50);
    expect(epirus?.why).toMatch(/has taken \d+ provinces in a year/);
    expect(result.facts.some((fact) => fact.kind === "rumour" && /Epirus they speak of Kingdom of Macedon's growing power with dread/.test(fact.summary))).toBe(true);
    // And with no growth, no fear.
    expect(reviewPushback(world, null, none).world.alarm.find((entry) => entry.polityId === "epirus" && entry.towardPolityId === "macedon")).toBeUndefined();
  });

  it("costs a power that breaks a peace the trust of everyone around it", () => {
    const world = at(opening(), 300);
    const broken = { ...world, polityAgreements: openWar(world.polityAgreements, { id: "war-seleucid-egypt", polityId: "seleucid-empire", otherPolityId: "ptolemaic-egypt", terms: "War.", atStep: 290, sourceMessageId: null, reason: "Antiochus breaks the peace of 271." }) };
    const result = reviewPushback(broken, null, none);
    const armenia = result.world.polityStances.find((stance) => stance.polityId === "armenia" && stance.towardPolityId === "seleucid-empire");
    const before = world.polityStances.find((stance) => stance.polityId === "armenia" && stance.towardPolityId === "seleucid-empire")?.trustScore ?? 0;
    expect(armenia!.trustScore).toBeLessThan(before);
    expect(result.facts.some((fact) => fact.kind === "reputation")).toBe(true);
  });

  it("leagues the frightened together, and a war on one brings in the rest", () => {
    const world = at(opening(), 400);
    // Macedon and the Acarnanians both dread Epirus.
    const frightened = { ...world, alarm: [
      { polityId: "macedon", towardPolityId: "epirus", level: 100, why: "Epirus has taken ground", updatedAtStep: 370 },
      { polityId: "acarnania", towardPolityId: "epirus", level: 100, why: "Epirus has taken ground", updatedAtStep: 370 },
    ] };
    const leagued = reviewPushback(frightened, null, none);
    const league = leagued.decisions.find((decision) => decision.act === "alliance" && decision.targetPolityId === "epirus");
    expect(league).toBeDefined();
    expect(league!.deltas[0]).toMatchObject({ op: "agreement_open", kind: "alliance" });

    // With the league standing, Epirus goes to war with Macedon: the Acarnanians are called to arms.
    const allied = { ...frightened, polityAgreements: [
      ...frightened.polityAgreements,
      { id: "league", kind: "alliance" as const, polityId: "macedon", otherPolityId: "acarnania", terms: "League.", sinceStep: 380, untilStep: null, sourceMessageId: null, status: "active" as const, endedAtStep: null, endedReason: null, visibility: "public" as const, against: "epirus" },
    ] };
    const war = { ...allied, polityAgreements: openWar(allied.polityAgreements, { id: "war-epirus-macedon", polityId: "epirus", otherPolityId: "macedon", terms: "War.", atStep: 395, sourceMessageId: null, reason: "Test." }) };
    const called = reviewPushback(war, null, none).decisions.find((decision) => decision.polityId === "acarnania" && decision.act === "declare_war");
    expect(called?.targetPolityId).toBe("epirus");
    expect(called?.why).toMatch(/called to arms/);
  });

  it("scales against the player's power with the difficulty, and nobody else's", () => {
    const world = at(opening(), 400);
    const owned = world.map.provinces.filter((province) => province.controllerPolityId === "macedon").length;
    const grown = { ...world, holdings: [{ polityId: "macedon", atStep: 30, provinces: Math.floor(owned * 0.8) }] };
    const fear = (state: WorldState, player: string | null) => reviewPushback(state, player, none).world.alarm.find((entry) => entry.polityId === "epirus" && entry.towardPolityId === "macedon")?.level ?? 0;
    expect(fear({ ...grown, difficulty: "merciless" }, "macedon")).toBeGreaterThan(fear({ ...grown, difficulty: "normal" }, "macedon"));
    expect(fear({ ...grown, difficulty: "merciless" }, "rome")).toBe(fear({ ...grown, difficulty: "normal" }, "rome"));
  });
});
