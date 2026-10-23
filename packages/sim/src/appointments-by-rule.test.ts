import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, ensureProvinceMaterial, readDepartments, type WorldState } from "@chronica/shared";
import { APPOINT_COOLDOWN_DAYS, appointByRule } from "./appointed-by-rule";
import { fillAppointments } from "./appointments";
import { renderCharacterPortrait } from "./cognition";
import { ensureConstitutions } from "./constitutions";
import { createIdFactory } from "./ports";
import { reviewSociety } from "./society";
import { runDeterministicTick } from "./tick";

/**
 * Appointments by rule: a ruler of a power nobody plays, overloaded or with his chest in debt, makes the charge his state lacks and
 * names the ablest man to it; the republics' chambers elect and assign their magistrates, so a republic's ruler lays nothing here;
 * the player is never seated; and what the model plays is not told of it.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const government = { offices: definition.government.offices, successionRules: definition.government.successionRules };
const opening = (): WorldState => ensureConstitutions({ world: ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0), government, toDay: 0 });
const at = (world: WorldState, day: number): WorldState => ({ ...world, elapsedStep: day, instant: { ...world.instant, day } });
const byRule = (world: WorldState, day: number, player: string | null = "gaius-genucius") => appointByRule({ world: at(world, day), government, toDay: day, ids: createIdFactory(`rule-${day}`), playerCharacterId: player, max: 99 });
const made = (world: WorldState, polityId: string) => world.departments.filter((department) => department.scope.id === polityId && department.origin === "pressure");
const withChest = (world: WorldState, polityId: string, balance: number): WorldState => ({
  ...world,
  material: { ...world.material, accounts: world.material.accounts.map((account) => (account.owner.kind === "polity" && account.owner.id === polityId ? { ...account, balance } : account)) },
});

describe("appointments by rule", () => {
  it("has an overloaded king make a charge, and the ablest man of his people is named to it the same day", () => {
    const world = opening();
    expect(readDepartments(world).workload("hieron-ii")).toBeLessThanOrEqual(-9);
    const result = byRule(world, 60);
    const syracuse = made(result.world, "syracuse");
    expect(syracuse).toHaveLength(1);
    expect(syracuse[0]!.name).toBe("The Revenues");
    expect(syracuse[0]!.levers).toEqual(["tax_roll", "credit"]);
    // Forming takes its month.
    expect(syracuse[0]!.formsAtStep).toBe(90);
    expect(result.facts.filter((fact) => fact.affectedRefs?.some((ref) => ref.id === "syracuse"))).toHaveLength(1);

    const filled = fillAppointments({ world: result.world, government, toDay: 60, playerCharacterId: "gaius-genucius" });
    const office = syracuse[0]!.headOfficeId!;
    const seat = filled.world.material.officeSeats.find((candidate) => candidate.officeId === office)!;
    expect(seat.status).toBe("held");
    expect(seat.holderCharacterId).not.toBe("hieron-ii");
    expect(seat.holderCharacterId).not.toBe("gaius-genucius");
    // Said in the Greek court's words for a Greek court, in a plain one's for the rest.
    expect(result.world.material.officeSeats.some((candidate) => candidate.officeId === "syracuse-dioiketes")).toBe(true);
    expect(made(result.world, "pontus")[0]!.name).toBe("The Treasury");
  });

  it("makes the treasury first where the chest is in debt, and the ruler's ambition for it is done", () => {
    const poor = withChest(opening(), "syracuse", -5_000);
    const wanted = reviewSociety({ world: at({ ...poor, society: { ...poor.society, lastReviewStep: 0 } }, 60), government, warfare: definition.warfare, toDay: 60, ids: createIdFactory("society") }).world;
    expect(wanted.characters.find((character) => character.id === "hieron-ii")!.ambitions.some((ambition) => ambition.id === "treasurer-syracuse" && ambition.status === "active")).toBe(true);
    const result = byRule(wanted, 60);
    expect(made(result.world, "syracuse")[0]!.levers).toContain("tax_roll");
    expect(result.world.characters.find((character) => character.id === "hieron-ii")!.ambitions.find((ambition) => ambition.id === "treasurer-syracuse")!.status).toBe("fulfilled");
  });

  it("lets a power make one charge a season, and no more than the cap", () => {
    const first = byRule(opening(), 60);
    expect(made(first.world, "syracuse")).toHaveLength(1);
    expect(made(byRule(first.world, 60 + APPOINT_COOLDOWN_DAYS - 1).world, "syracuse")).toHaveLength(1);
    expect(made(byRule(first.world, 60 + APPOINT_COOLDOWN_DAYS).world, "syracuse")).toHaveLength(2);
  });

  it("lays nothing for a republic whose chamber holds the appointments, nor for the power the player rules", () => {
    const result = byRule(opening(), 60);
    expect(made(result.world, "rome")).toHaveLength(0);
    expect(made(result.world, "carthage")).toHaveLength(0);
    // The player is a king: his power is his own, and he is never named to a charge of another's.
    const king = byRule(opening(), 60, "hieron-ii");
    expect(made(king.world, "syracuse")).toHaveLength(0);
    const held = fillAppointments({ world: king.world, government, toDay: 60, playerCharacterId: "hieron-ii" }).world.material.officeSeats.filter((seat) => seat.holderCharacterId === "hieron-ii");
    expect(held.every((seat) => !seat.officeId.startsWith("syracuse-dioiketes"))).toBe(true);
  });

  it("goes through the month's review of a running world, with the post filled and the news told once", () => {
    const first = runDeterministicTick({ world: at(opening(), 40), toDay: 40, ids: createIdFactory("tick-40"), warfare: definition.warfare, government, playerCharacterId: "gaius-genucius" });
    const second = runDeterministicTick({ world: at(first.world, 80), toDay: 80, ids: createIdFactory("tick-80"), warfare: definition.warfare, government, playerCharacterId: "gaius-genucius" });
    const all = [...made(first.world, "syracuse"), ...made(second.world, "syracuse")];
    expect(all.length).toBeGreaterThan(0);
    const told = [...first.factProposals, ...second.factProposals].filter((fact) => fact.localId.startsWith("charge_by_rule_syracuse"));
    expect(told.length).toBeGreaterThan(0);
    expect(told.length).toBeLessThanOrEqual(2);
  });

  it("is not told to the model: the ambitions and the worries of the books stay out of a played man's section, and stay in the player's", () => {
    const poor = withChest(opening(), "syracuse", -5_000);
    const wanted = reviewSociety({ world: at({ ...poor, society: { ...poor.society, lastReviewStep: 0 } }, 60), government, warfare: definition.warfare, toDay: 60, ids: createIdFactory("society") }).world;
    const withWorry: WorldState = {
      ...wanted,
      polityOutlooks: wanted.polityOutlooks.map((outlook) => (outlook.polityId === "syracuse"
        ? { ...outlook, concerns: [{ label: "the treasury, which is empty", level: "high" as const }, { label: "the plots of the Mamertines", level: "medium" as const }], intentions: ["raise the tax on the grain-lands", "hold Messana"] }
        : outlook)),
    };
    const played = renderCharacterPortrait("hieron-ii", "Hieron II", withWorry, definition.clock, { routineIsKept: true });
    expect(played).not.toContain("treasurer-syracuse");
    expect(played).not.toContain("worried about the treasury");
    expect(played).not.toContain("raise the tax");
    expect(played).toContain("worried about the plots of the Mamertines");
    expect(played).toContain("hold Messana");
    const own = renderCharacterPortrait("hieron-ii", "Hieron II", withWorry, definition.clock, {});
    expect(own).toContain("treasurer-syracuse");
    expect(own).toContain("worried about the treasury");
  });
});
