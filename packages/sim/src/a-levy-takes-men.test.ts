import { describe, expect, it } from "vitest";
import { punicWarsScenario, PUNIC_IDS } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, kmFrom, type Force, type WorldDelta, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { levyCost, MEN_MUSTERED_PER_DAY, MUSTER_AT_ONCE } from "./levies";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";

/**
 * "Raise two new legions in Latium."
 *
 * They stood ready the day they were ordered, out of nothing: no province
 * gave up a man, no treasury paid a bounty. A levy now comes out of the
 * country -- Rome's own, not its allies', who owe men by their treaty and are
 * called up when a war opens; it is paid for; and it takes days to come in.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const LATIUM = PUNIC_IDS.rome;
const CAMPANIA = PUNIC_IDS.capua;
const ETRURIA = PUNIC_IDS.volsinii;

const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("levy"),
  gameId: "game-levy",
  actsForTheWorld: true,
};

function opening(treasury?: number): WorldState {
  const world = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
  if (treasury === undefined) return world;
  return { ...world, material: { ...world.material, accounts: world.material.accounts.map((account) => (account.id === "rome-treasury" ? { ...account, balance: treasury } : account)) } };
}

const raise = (men: number): WorldDelta => ({
  op: "force_create", localId: "new_legions", name: "Two new legions", polityId: "rome",
  commanderCharacterRef: "gaius-genucius", controllerCharacterRef: "gaius-genucius", locationId: LATIUM,
  authorizedStrength: men, payObligationRef: null, reason: "The Senate voted them.",
});

const manpower = (world: WorldState, provinceId: string): number => world.material.provinceMaterial.find((row) => row.provinceId === provinceId)!.availableManpower;
/** Every province of Rome's own, and the men of age they hold between them. */
const romanGround = (world: WorldState): string[] => world.map.provinces.filter((province) => province.controllerPolityId === "rome").map((province) => province.id);
const romanManpower = (world: WorldState): number => romanGround(world).reduce((sum, id) => sum + manpower(world, id), 0);
const treasury = (world: WorldState): number => world.material.accounts.find((account) => account.id === "rome-treasury")!.balance;
const raised = (world: WorldState): Force => world.material.forces.find((force) => force.name === "Two new legions")!;
const fit = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.fit, 0);
const coming = (force: Force): number => force.personnel.reduce((sum, group) => sum + group.unavailable.filter((band) => band.causeKind === "mustering").reduce((n, band) => n + band.count, 0), 0);

describe("a levy", () => {
  it("draws the men out of the province, then the rest of Rome's ground", () => {
    const before = opening();
    // More than Latium holds: the rest comes from Rome's ground round about it, and from nowhere that is not Rome's.
    const asked = manpower(before, LATIUM) + 5_000;
    const result = applyDeltas(before, [raise(asked)], context);
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([]);
    expect(manpower(result.world, LATIUM)).toBe(0);
    expect(romanManpower(result.world)).toBe(romanManpower(before) - asked);
    const taken = before.map.provinces.filter((province) => manpower(result.world, province.id) < manpower(before, province.id)).map((province) => province.id);
    expect(taken.length).toBeGreaterThan(1);
    expect(taken.every((id) => romanGround(before).includes(id))).toBe(true);
  });

  it("is paid for out of the treasury", () => {
    const before = opening();
    const result = applyDeltas(before, [raise(5_000)], context);
    expect(treasury(result.world)).toBe(treasury(before) - levyCost(5_000));
    expect(result.world.material.transactions.some((transaction) => transaction.kind === "purchase" && transaction.sourceAccountId === "rome-treasury" && transaction.amount === levyCost(5_000))).toBe(true);
  });

  it("musters over days, and the men join the standard on theirs", () => {
    const result = applyDeltas(opening(), [raise(5_000)], context);
    const legions = raised(result.world);
    expect(fit(legions)).toBe(MUSTER_AT_ONCE);
    expect(coming(legions)).toBe(5_000 - MUSTER_AT_ONCE);
    const days = Math.ceil((5_000 - MUSTER_AT_ONCE) / MEN_MUSTERED_PER_DAY);
    const halfway = runDeterministicTick({ world: { ...result.world, elapsedStep: 5, instant: { day: 5, minute: 0 } }, toDay: 5, ids: createIdFactory("muster-5"), warfare: definition.warfare }).world;
    expect(fit(raised(halfway))).toBeGreaterThan(MUSTER_AT_ONCE);
    expect(fit(raised(halfway))).toBeLessThan(5_000);
    const mustered = runDeterministicTick({ world: { ...halfway, elapsedStep: days, instant: { day: days, minute: 0 } }, toDay: days, ids: createIdFactory("muster-all"), warfare: definition.warfare }).world;
    expect(fit(raised(mustered))).toBe(5_000);
    // Told as men joining, not as men coming back from the surgeons.
    expect(raised(mustered).history.some((event) => event.kind === "reinforcement")).toBe(true);
    expect(raised(mustered).history.some((event) => event.kind === "recovery")).toBe(false);
  });

  it("enrols Rome's own people only, leaves the allies' men to their treaty, and says when there are no more", () => {
    // A relief force of ten thousand once emptied Etruria and Picenum before
    // the allies' own call-up had found anybody.
    const before = opening();
    const result = applyDeltas(before, [raise(200_000)], context);
    expect(result.rejected).toEqual([]);
    expect(manpower(result.world, ETRURIA)).toBe(manpower(before, ETRURIA));
    expect(raised(result.world).authorizedStrength).toBe(romanManpower(before));
    expect(result.factProposals.some((fact) => fact.kind === "levy_short" && /no more men of age/.test(fact.summary))).toBe(true);
  });

  it("called in an ally's country, raises Romans from Rome's nearest ground", () => {
    const before = opening();
    const result = applyDeltas(before, [{ ...raise(1_000), locationId: ETRURIA } as WorldDelta], context);
    expect(result.rejected).toEqual([]);
    expect(manpower(result.world, ETRURIA)).toBe(manpower(before, ETRURIA));
    // From the Roman ground nearest the allies' country, not from a Rome that lies a province further.
    const reach = kmFrom(before, ETRURIA);
    const nearest = romanGround(before).filter((id) => manpower(before, id) > 0).sort((a, b) => (reach.get(a) ?? Infinity) - (reach.get(b) ?? Infinity) || a.localeCompare(b))[0]!;
    expect(manpower(result.world, nearest)).toBe(Math.max(0, manpower(before, nearest) - 1_000));
    expect(romanManpower(result.world)).toBe(romanManpower(before) - 1_000);
  });

  it("raises only the men there is money to arm", () => {
    const result = applyDeltas(opening(60), [raise(5_000)], context);
    expect(raised(result.world).authorizedStrength).toBe(2_000);
    expect(treasury(result.world)).toBe(0);
    expect(result.factProposals.some((fact) => fact.kind === "levy_short" && /money/.test(fact.summary))).toBe(true);
  });

  it("is refused only when not one man can be raised", () => {
    const result = applyDeltas(opening(0), [raise(5_000)], context);
    expect(result.rejected[0]?.reason).toMatch(/money for no more/);
  });
});

describe("new men drafted into an army", () => {
  it("come out of the country too", () => {
    const before = opening();
    const result = applyDeltas(before, [{
      op: "force_reinforce", forceRef: "roman-field-army", categoryId: "infantry", label: "New levies", men: 800, fromForceRef: null, reason: "Fill the ranks.",
    }], context);
    expect(result.rejected).toEqual([]);
    expect(manpower(result.world, LATIUM)).toBe(manpower(before, LATIUM) - 800);
    expect(treasury(result.world)).toBe(treasury(before) - levyCost(800));
  });
});

describe("a recruitment finishing", () => {
  it("takes its men out of the province it raises them in", () => {
    const before = opening();
    const project = applyDeltas(before, [{
      op: "project_create", localId: "recruit", kind: "recruitment", label: "Raise a legion in Campania",
      sponsorRef: { kind: "polity", id: "rome" }, fundingAccountRef: "rome-treasury",
      milestones: [{ label: "Enrolled", dueInDays: 10, costAmount: 0 }],
      completionOutcome: { kind: "force", label: "Legio Campana", amount: 3_000, provinceId: CAMPANIA, polityId: "rome", commanderCharacterRef: "gaius-genucius", forceRef: null, beneficiaryAccountRef: null, cadenceDays: null, agreementKind: null, withPolityId: null },
      reason: "A legion for the south.",
    }], context);
    expect(project.rejected).toEqual([]);
    const done = runDeterministicTick({ world: { ...project.world, elapsedStep: 10, instant: { day: 10, minute: 0 } }, toDay: 10, ids: createIdFactory("recruited"), warfare: definition.warfare }).world;
    const legion = done.material.forces.find((force) => force.name === "Legio Campana")!;
    expect(fit(legion)).toBe(3_000);
    // Drawn, then a little of it back as the month's young men come of age.
    expect(manpower(done, CAMPANIA)).toBeLessThan(manpower(before, CAMPANIA) - 3_000 + 400);
  });
});
