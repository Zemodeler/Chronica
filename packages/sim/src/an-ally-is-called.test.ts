import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  AGREEMENT_KIND_EXPLAINED,
  ScenarioDefinitionSchema,
  WorldStateSchema,
  alliesLedBy,
  atWar,
  economyOf,
  ensureProvinceMaterial,
  openWar,
  type PolityAgreement,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * An ally is called, and comes -- or does not, and pays for it.
 *
 * Rome's Italian allies were "at war whenever Rome was" and never sent a man:
 * the foedus was a line in the atlas. An alliance was a promise nobody could
 * hold anybody to: a power could watch its ally invaded and lose nothing by
 * it. Now a leader's war calls up its allies' contingents the day it opens,
 * and a power attacked calls on its allies, who answer.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const tick = (world: WorldState, toDay: number, playerCharacterId: string | null = null) =>
  runDeterministicTick({ world, toDay, ids: createIdFactory(`ally-${toDay}`), warfare: definition.warfare, playerCharacterId });
const war = (world: WorldState, id: string, polityId: string, otherPolityId: string, atStep: number): WorldState => ({
  ...world,
  polityAgreements: openWar(world.polityAgreements, { id, polityId, otherPolityId, terms: "War.", atStep, sourceMessageId: null, reason: "War." }),
});
const alliance = (polityId: string, otherPolityId: string): PolityAgreement => ({
  id: `alliance-${polityId}-${otherPolityId}`, kind: "alliance", polityId, otherPolityId, terms: "To stand by each other.", sinceStep: 0, untilStep: null,
  sourceMessageId: null, status: "active", endedAtStep: null, endedReason: null, visibility: "public",
});
const withTrust = (world: WorldState, polityId: string, towardPolityId: string, trustScore: number): WorldState => ({
  ...world,
  polityStances: [...world.polityStances.filter((stance) => !(stance.polityId === polityId && stance.towardPolityId === towardPolityId)), { polityId, towardPolityId, trustScore, lastShiftReason: "Set.", lastShiftAtStep: 0 }],
});
const menOf = (world: WorldState, polityId: string): number =>
  world.material.forces.filter((force) => force.polityId === polityId).reduce((sum, force) => sum + force.personnel.reduce((total, group) => total + group.fit, 0), 0);

describe("an ally is called", () => {
  it("does not raise the allies again for a war the world began with", () => {
    const first = tick(opening(), 1);
    expect(first.factProposals.some((fact) => fact.kind === "allies_levied")).toBe(false);
  });

  it("sends Rome its allies' contingents the day Rome goes to war", () => {
    const seen = tick(opening(), 1).world;
    const allies = alliesLedBy(seen.polityAgreements, "rome");
    const before = new Map(allies.map((ally) => [ally, menOf(seen, ally)]));
    const manpower = (world: WorldState, ally: string) => world.material.provinceMaterial
      .filter((row) => world.map.provinces.some((province) => province.id === row.provinceId && province.controllerPolityId === ally))
      .reduce((sum, row) => sum + row.availableManpower, 0);
    const ticked = tick(war(seen, "war-carthage", "rome", "carthage", 1), 2);
    const levied = ticked.factProposals.find((fact) => fact.kind === "allies_levied");
    expect(levied?.summary).toContain("foedus");
    // Each ally with men to spare sends a force of its own, under its own man, from its own men of military age.
    const sent = allies.filter((ally) => menOf(ticked.world, ally) > before.get(ally)!);
    expect(sent.length).toBeGreaterThan(3);
    const one = sent[0]!;
    const contingent = ticked.world.material.forces.find((force) => force.polityId === one && force.name.includes("contingent"));
    expect(contingent).toBeDefined();
    expect(ticked.world.characters.find((character) => character.id === contingent!.commanderCharacterId)?.polityId).toBe(one);
    expect(manpower(ticked.world, one)).toBeLessThan(manpower(seen, one));
    // Once.
    expect(tick(ticked.world, 3).factProposals.some((fact) => fact.kind === "allies_levied")).toBe(false);
  });

  it("calls an ally once a campaigning season, however many wars its leader opens", () => {
    // Rome's Apulians and Umbrians marched for the war with Syracuse and were
    // levied again a month later for the war with Carthage.
    const seen = tick(opening(), 1).world;
    const first = tick(war(seen, "war-syracuse", "rome", "syracuse", 1), 2);
    const sent = first.factProposals.find((fact) => fact.kind === "allies_levied");
    expect(sent).toBeDefined();
    const again = tick(war(first.world, "war-carthage", "rome", "carthage", 30), 31);
    expect(again.factProposals.some((fact) => fact.kind === "allies_levied")).toBe(false);
    // A season on, a new war calls them again.
    const nextYear = tick(war(again.world, "war-mamertines", "rome", "mamertines", 400), 401);
    expect(nextYear.factProposals.some((fact) => fact.kind === "allies_levied")).toBe(true);
  });

  it("brings a trusting ally into the war when its partner is attacked", () => {
    const seen = tick({ ...opening(), polityAgreements: [...opening().polityAgreements, alliance("carthage", "syracuse")] }, 1).world;
    const attacked = war(withTrust(seen, "carthage", "syracuse", 60), "war-syracuse", "rome", "syracuse", 1);
    const ticked = tick(attacked, 2);
    expect(atWar(ticked.world.polityAgreements, "carthage", "rome")).toBe(true);
    expect(ticked.factProposals.some((fact) => fact.kind === "war_declared" && fact.summary.includes("alliance"))).toBe(true);
    // Keeping faith is not breaking it: no penalty for the war it joined.
    expect(ticked.factProposals.some((fact) => fact.kind === "peace_broken" && fact.affectedRefs?.[0]?.id === "carthage")).toBe(false);
  });

  it("lets a distrustful ally refuse, and costs it its partner's trust", () => {
    const seen = tick({ ...opening(), polityAgreements: [...opening().polityAgreements, alliance("carthage", "syracuse")] }, 1).world;
    const attacked = war(withTrust(seen, "carthage", "syracuse", -60), "war-syracuse", "rome", "syracuse", 1);
    const ticked = tick(attacked, 2);
    expect(atWar(ticked.world.polityAgreements, "carthage", "rome")).toBe(false);
    expect(ticked.factProposals.some((fact) => fact.kind === "alliance_refused")).toBe(true);
    const trust = ticked.world.polityStances.find((stance) => stance.polityId === "syracuse" && stance.towardPolityId === "carthage")!.trustScore;
    expect(trust).toBeLessThanOrEqual(-25);
    expect(economyOf(ticked.world).grievances.some((grievance) => grievance.polityId === "syracuse" && grievance.againstPolityId === "carthage")).toBe(true);
  });

  it("waits a month for the player's own answer, and counts silence as refusal", () => {
    const player = "gaius-genucius";
    const seen = tick({ ...opening(), polityAgreements: [...opening().polityAgreements, alliance("rome", "syracuse")] }, 1, player).world;
    const called = tick(war(seen, "war-syracuse", "carthage", "syracuse", 1), 2, player);
    expect(called.factProposals.some((fact) => fact.kind === "call_to_arms")).toBe(true);
    expect(atWar(called.world.polityAgreements, "rome", "carthage")).toBe(false);
    // Rome does nothing for thirty days.
    const silent = tick(called.world, 40, player);
    expect(silent.factProposals.some((fact) => fact.kind === "alliance_refused")).toBe(true);
    // Or Rome goes to war, and owes nothing.
    const honoured = tick(war(called.world, "rome-joins", "rome", "carthage", 10), 40, player);
    expect(honoured.factProposals.some((fact) => fact.kind === "alliance_refused")).toBe(false);
    expect(economyOf(honoured.world).pendingCalls).toHaveLength(0);
  });

  it("says what is now enforced, for a player who asks", () => {
    expect(AGREEMENT_KIND_EXPLAINED.alliance).toContain("calls on the other");
    expect(AGREEMENT_KIND_EXPLAINED.foedus).toContain("contingent");
    expect(AGREEMENT_KIND_EXPLAINED.tributary).toContain("tenth");
  });
});
