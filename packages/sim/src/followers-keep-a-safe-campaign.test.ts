import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { WorldDeltaSchema, WorldStateSchema, campaignOf, ensureProvinceMaterial, type CampaignPlan, type WarPlan, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { ensureConstitutions } from "./constitutions";
import { decideStatecraft } from "./statecraft";
import { aMonth as runMonth, context, definition, forceOf, inputFor, placed, withMen } from "./war-plan-kit";

/**
 * The allies' contingents keep a safe campaign.
 *
 * The Lucanians (349 men) and the Apulians (715) were handed a copy of the consul's order, the siege of Rhegium, marched to it,
 * reckoned the garrison of four thousand against themselves alone with the consul's twenty thousand standing beside them, fell
 * back home, and were sent again the next month, and the next. Now a contingent serves with the leader's army, where it is or
 * where it is sent, and goes only where its side has the odds to stand; one that cannot keeps its own ground and says so once.
 */
const { rhegium: RHEGIUM, grumentum: GRUMENTUM, rome: LATIUM } = PUNIC_IDS;
const ROMAN_ARMY = "roman-field-army";
const CONSUL = "gaius-genucius";
const LUCANIAN = "lucanians-ruler-3zx2w3";
const CONTINGENT = "force-contingent-lucanians";
const WAR = "war-rome-rhegium";
/** The south-western coast of the Bruttii, the consul's next object in the sanity run. */
const BRUTTII_COAST = "it-cx6ne";

/** The opening with Rome's war on the Campanians of Rhegium alone, the day given, and the Lucanian contingent mustered at Grumentum. */
function opening(day: number): WorldState {
  let world = ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government: { offices: definition.government.offices, successionRules: definition.government.successionRules }, toDay: day });
  world = { ...world, instant: { ...world.instant, day }, elapsedStep: day };
  const muster = WorldDeltaSchema.parse({
    op: "force_create", localId: "contingent-lucanians", name: "Contingent of Lucanians", polityId: "lucanians",
    commanderCharacterRef: LUCANIAN, controllerCharacterRef: LUCANIAN, locationId: GRUMENTUM, authorizedStrength: 349, payObligationRef: null, reason: "The foedus.",
  });
  const applied = applyDeltas(world, [muster], context(world, LUCANIAN));
  const made = applied.world.material.forces.find((force) => force.name === "Contingent of Lucanians")!;
  return WorldStateSchema.parse({ ...applied.world, material: {
    ...applied.world.material,
    forces: applied.world.material.forces.map((force) => (force.id === made.id ? { ...force, id: CONTINGENT } : force)),
    accounts: applied.world.material.accounts.map((account) => (account.owner.kind === "force" && account.owner.id === made.id
      ? { ...account, owner: { ...account.owner, id: CONTINGENT } } : account)),
  } });
}

/** Only a valid starting world and a valid applied result can establish follower behavior. */
function aMonth(world: WorldState): ReturnType<typeof runMonth> {
  expect(WorldStateSchema.safeParse(world).success).toBe(true);
  const result = runMonth(world);
  expect(WorldStateSchema.safeParse(result.world).success).toBe(true);
  return result;
}

/** Rome's plan and the consul's orders, written in by hand so the test does not depend on what Rome's own rules choose. */
function romeSends(world: WorldState, mode: CampaignPlan["mode"], objective: string): WorldState {
  const day = world.instant.day;
  const plan: WarPlan = {
    warId: WAR, polityId: "rome", enemyPolityId: "rhegium-campanians", aims: [{ kind: "take_province", provinceId: objective }],
    theatres: [{ id: `th-${objective}`, provinceIds: [objective], mainEffort: true, forceIds: [ROMAN_ARMY], commanderId: CONSUL }],
    posture: "attrition", reviewedAtStep: day - 30, aimsSetAtStep: day - 30, aimsChangedAtStep: day - 30, issuedByCharacterId: CONSUL,
  };
  const orders: CampaignPlan = {
    forceId: ROMAN_ARMY, polityId: "rome", warId: WAR, theatreId: plan.theatres[0]!.id, objective: { kind: "province", provinceId: objective },
    baseProvinceId: null, fallbackProvinceId: null, mode, issuedByCharacterId: CONSUL, issuedStep: day - 30, expiresStep: day + 170, byRule: true, forCommanderId: CONSUL,
  };
  return { ...world, warPlans: [...(world.warPlans ?? []).filter((entry) => entry.polityId !== "rome"), plan], campaigns: [...(world.campaigns ?? []).filter((entry) => entry.forceId !== ROMAN_ARMY), orders] };
}

const lucanian = (decisions: ReturnType<typeof decideStatecraft>) => decisions.filter((decision) => decision.polityId === "lucanians");
const aMonthLater = (world: WorldState): WorldState => ({ ...world, instant: { ...world.instant, day: world.instant.day + 30 }, elapsedStep: world.elapsedStep + 30 });

describe("the allies' contingents keep a safe campaign", () => {
  it("is sent to serve with the consul's army at his siege, and stands with him before a garrison it could not face alone", () => {
    const start = romeSends(placed(opening(120), ROMAN_ARMY, RHEGIUM), "siege", RHEGIUM);
    const first = aMonth(start);
    const sent = lucanian(first.decisions);
    expect(sent.map((decision) => decision.act)).toEqual(expect.arrayContaining(["war_plan", "march"]));
    expect(sent.find((decision) => decision.act === "war_plan")?.why).toMatch(/bidden to serve with Roman field army at Rhegium/);
    expect(campaignOf(first.world, CONTINGENT)).toMatchObject({ mode: "siege", objective: { kind: "province", provinceId: RHEGIUM }, warId: WAR });

    // Arrived: three hundred and forty-nine beside the consul's seventeen thousand, before the garrison's thirty-six hundred.
    const arrived = aMonthLater(placed(first.world, CONTINGENT, RHEGIUM));
    const second = aMonth(arrived);
    const there = lucanian(second.decisions);
    expect(there.map((decision) => decision.act)).not.toContain("fall_back");
    expect(there.map((decision) => decision.act)).not.toContain("march");
    // The orders stand: nothing is written again.
    expect(there.filter((decision) => decision.act === "war_plan")).toEqual([]);
    expect(campaignOf(second.world, CONTINGENT)?.objective).toEqual({ kind: "province", provinceId: RHEGIUM });
    expect(forceOf(second.world, CONTINGENT).locationId).toBe(RHEGIUM);
  });

  it("keeps its own ground, and says so, where its side has not the odds at the meeting place", () => {
    // The consul's army is a thousand men at Latium with orders for Rhegium: a thousand and 349 against 3,600 is not a siege.
    const start = romeSends(withMen(placed(opening(120), ROMAN_ARMY, LATIUM), ROMAN_ARMY, 1_000), "siege", RHEGIUM);
    const month = aMonth(start);
    const theirs = lucanian(month.decisions);
    expect(theirs.map((decision) => decision.act)).not.toContain("march");
    expect(theirs.filter((decision) => decision.act === "war_plan")).toEqual([]);
    expect(theirs.find((decision) => decision.act === "hold")?.why).toMatch(/keeps to .*: about 4 000 of the enemy are at Rhegium coast/);
    expect(campaignOf(month.world, CONTINGENT)).toBeUndefined();
    expect(forceOf(month.world, CONTINGENT).locationId).toBe(GRUMENTUM);
  });

  it("goes with the consul when he moves on, rather than keeping a siege he has left", () => {
    // Standing at Rhegium with siege orders, the consul gone to the Bruttian coast; the garrison is still in Rhegium.
    const stale: CampaignPlan = {
      forceId: CONTINGENT, polityId: "lucanians", warId: WAR, theatreId: null, objective: { kind: "province", provinceId: RHEGIUM }, baseProvinceId: null, fallbackProvinceId: GRUMENTUM,
      mode: "siege", issuedByCharacterId: CONSUL, issuedStep: 90, expiresStep: 210, byRule: true, forCommanderId: LUCANIAN,
    };
    const base = romeSends(placed(placed(opening(150), ROMAN_ARMY, BRUTTII_COAST), CONTINGENT, RHEGIUM), "seek_battle", BRUTTII_COAST);
    const start = { ...base, campaigns: [...(base.campaigns ?? []), stale] };
    const month = aMonth(start);
    const theirs = lucanian(month.decisions);
    expect(theirs.find((decision) => decision.act === "war_plan")?.why).toMatch(/bidden to serve with Roman field army at South-western coast of the Bruttii/);
    expect(campaignOf(month.world, CONTINGENT)).toMatchObject({ mode: "seek_battle", objective: { kind: "province", provinceId: BRUTTII_COAST } });
    // It leaves the garrison it cannot face alone: on toward the consul, or back before the stronger army; it does not sit.
    expect(theirs.some((decision) => decision.act === "march" || decision.act === "fall_back")).toBe(true);
    expect(forceOf(month.world, CONTINGENT).locationId).not.toBe(RHEGIUM);
  });

  it("decides the same month twice from the same world", () => {
    const start = romeSends(placed(opening(120), ROMAN_ARMY, RHEGIUM), "siege", RHEGIUM);
    expect(WorldStateSchema.safeParse(start).success).toBe(true);
    const once = decideStatecraft(inputFor(start));
    const again = decideStatecraft(inputFor(start));
    expect(JSON.stringify(lucanian(again))).toBe(JSON.stringify(lucanian(once)));
  });
});
