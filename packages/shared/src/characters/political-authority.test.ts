import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { canParticipate, canSponsorProcedure, institutionControls, officeGrantsDirectAccess, resolveEligibility } from "./political-authority";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

const ROMAN_OFFICE_REQUIREMENTS = ["req-alive", "req-roman-polity", "req-min-prestige-3000", "req-not-disqualified"];

describe("resolveEligibility", () => {
  it("passes a living, sufficiently prestigious Roman senator", () => {
    const result = resolveEligibility(world(), "marcus-atilius", ROMAN_OFFICE_REQUIREMENTS);
    expect(result.eligible).toBe(true);
    expect(result.failedReasons).toEqual([]);
  });

  it("fails a Carthaginian on the polity_membership requirement", () => {
    const result = resolveEligibility(world(), "hanno", ROMAN_OFFICE_REQUIREMENTS);
    expect(result.eligible).toBe(false);
    expect(result.failedReasons.some((reason) => reason.includes("polity"))).toBe(true);
  });

  it("fails a character carrying a disqualifying status", () => {
    const w = world();
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius" ? { ...c, disqualifyingStatuses: ["captured"] } : c));
    const result = resolveEligibility(w, "marcus-atilius", ROMAN_OFFICE_REQUIREMENTS);
    expect(result.eligible).toBe(false);
    expect(result.failedReasons.some((reason) => reason.includes("disqualifying"))).toBe(true);
  });

  it("fails a dead character on the alive requirement", () => {
    const w = world();
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius" ? { ...c, alive: false, diedAtStep: 0 } : c));
    const result = resolveEligibility(w, "marcus-atilius", ROMAN_OFFICE_REQUIREMENTS);
    expect(result.eligible).toBe(false);
  });

  it("fails closed when a requirement id is not defined", () => {
    const result = resolveEligibility(world(), "marcus-atilius", ["not-a-real-requirement"]);
    expect(result.eligible).toBe(false);
  });
});

describe("canSponsorProcedure", () => {
  it("allows a living, undisqualified character to sponsor", () => {
    expect(canSponsorProcedure(world(), "quintus-fabius", "removal", "roman-senate").eligible).toBe(true);
  });

  it("refuses an unknown character", () => {
    expect(canSponsorProcedure(world(), "nobody", "removal", "roman-senate").eligible).toBe(false);
  });

  it("refuses sponsorship through an institution that does not exist", () => {
    expect(canSponsorProcedure(world(), "quintus-fabius", "removal", "not-an-institution").eligible).toBe(false);
  });
});

describe("canParticipate", () => {
  it("grants a voting-bloc member the vote action on an eligible vote procedure", () => {
    const procedure = world().material.politicalProcedures.find((p) => p.id === "senate-censure-marcus")!;
    const actions = canParticipate(world(), "marcus-atilius", procedure);
    expect(actions).toContain("vote");
  });

  it("grants no actions to a character outside the eligible participant list", () => {
    const procedure = world().material.politicalProcedures.find((p) => p.id === "senate-censure-marcus")!;
    const actions = canParticipate(world(), "hanno", procedure);
    expect(actions).toEqual([]);
  });

  it("grants command to the sponsor of a command_assignment procedure", () => {
    const procedure = world().material.politicalProcedures.find((p) => p.id === "carthage-command-handover")!;
    const actions = canParticipate(world(), "hanno", procedure);
    expect(actions).toContain("command");
  });
});

describe("institutionControls / officeGrantsDirectAccess", () => {
  it("reports no reserved-power control when none is authored", () => {
    expect(institutionControls(world(), "roman-senate", "treaty", "anything")).toBe(false);
  });

  it("distinguishes direct access from proposal-only via authorisedActionIds", () => {
    const office = { id: "test-office", label: "Test office", polityId: "rome", authorisedActionIds: ["decree"], sponsorableCategories: [], treasuryAccountId: null, treasuryPermissions: [], incomeSourceId: null, expectedBlocId: null, successionRuleId: "roman-election", eligibilityRequirementIds: [] };
    expect(officeGrantsDirectAccess(office, "decree")).toBe(true);
    expect(officeGrantsDirectAccess(office, "declare_war")).toBe(false);
  });
});
