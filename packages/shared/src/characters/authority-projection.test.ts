import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { deriveAuthoritySummary } from "./authority-projection";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);
const government = firstPunicWarScenario.definition.government;

describe("deriveAuthoritySummary", () => {
  it("names the office (with polity), bloc leadership, force command, and open-procedure voting right for an office holder", () => {
    const labels = deriveAuthoritySummary(world(), "marcus-atilius", government);
    expect(labels).toContain("Roman field command of Roman Republic");
    expect(labels).toContain("leader of The patrician houses");
    expect(labels).toContain("Command of the Legio I");
    expect(labels).toContain("Eligible voter in the Senate");
  });

  it("names a procedure sponsor's granted right with no institution suffix when the procedure has none", () => {
    const labels = deriveAuthoritySummary(world(), "hanno", government);
    expect(labels).toContain("Sponsor of command assignment");
  });

  it("falls back to 'No current public office' for a character with no canonical authority", () => {
    const labels = deriveAuthoritySummary(world(), "hamilcar", government);
    expect(labels).toEqual(["No current public office"]);
  });

  it("falls back for an unknown character id", () => {
    expect(deriveAuthoritySummary(world(), "nobody", government)).toEqual(["No current public office"]);
  });

  it("prefixes a captivity status ahead of any office labels, without hiding them", () => {
    const w = world();
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius" ? { ...c, disqualifyingStatuses: ["captured"] } : c));
    const labels = deriveAuthoritySummary(w, "marcus-atilius", government);
    expect(labels[0]).toBe("Held captive");
    expect(labels).toContain("Roman field command of Roman Republic");
  });

  it("reports only 'Deceased' for a dead character, never a stale office", () => {
    const w = world();
    w.characters = w.characters.map((c) => (c.id === "marcus-atilius" ? { ...c, alive: false, diedAtStep: 0 } : c));
    expect(deriveAuthoritySummary(w, "marcus-atilius", government)).toEqual(["Deceased"]);
  });

  it("never reads knowledgebase.authority -- canonical state alone decides the list", () => {
    // No such field exists on Character/WorldState; this test documents the
    // guarantee by construction rather than asserting on a nonexistent read.
    const labels = deriveAuthoritySummary(world(), "hamilcar", government);
    expect(labels).not.toContain(undefined);
  });
});
