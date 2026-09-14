import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { deriveWorldInstant, type WorldState } from "@chronica/shared";
import { advanceWorldMatters } from "../advance";

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function at(step: number) {
  return deriveWorldInstant(step);
}

describe("institutional matter detectors (docs/plans/ai-world-matters-runtime.md, Phase 5)", () => {
  it("detects an approaching office_term matter as a single matter, naming the incumbent as a stakeholder", () => {
    const w = world();
    // roman-command:seat:0 is seeded with termStartedAtStep 0, termExpiresAtStep 4.
    const result = advanceWorldMatters(w, at(3), 3);
    const matter = result.world.worldMatters!.find((m) => m.kind === "office_term")!;
    expect(matter).toBeDefined();
    expect(matter.sourceRef).toEqual({ kind: "seat", id: "roman-command:seat:0" });
    expect(matter.stakeholderRefs).toEqual([{ kind: "character", id: "marcus-atilius" }]);
  });

  it("marks the office_term matter overdue once the term actually expires, without the scheduler picking any successor", () => {
    const w = world();
    const result = advanceWorldMatters(w, at(4), 4);
    const matter = result.world.worldMatters!.find((m) => m.kind === "office_term")!;
    expect(matter.status).toBe("overdue");
    // The engine never touches officeSeats/characters itself -- only a
    // workflow (appoint_to_office, expire_office_term) may.
    expect(result.world.material.officeSeats).toEqual(w.material.officeSeats);
    expect(result.world.characters).toEqual(w.characters);
  });

  function withVacantSeat(w: WorldState): WorldState {
    return {
      ...w,
      material: {
        ...w.material,
        officeSeats: [
          ...w.material.officeSeats,
          { id: "roman-praetor:seat:0", officeId: "roman-praetor", seatIndex: 0, holderCharacterId: null, status: "vacant" as const, vacancyCause: "never_filled" as const, termStartedAtStep: null, termExpiresAtStep: null, appointmentProcedureId: null, removalProcedureId: null, eligibilityRequirementIds: [] },
        ],
      },
    };
  }

  it("detects a seat_vacancy matter for a vacant seat", () => {
    const w = withVacantSeat(world());
    const result = advanceWorldMatters(w, at(1), 1);
    const vacancy = result.world.worldMatters!.find((m) => m.id === "seat-vacancy:roman-praetor:seat:0");
    expect(vacancy).toBeDefined();
    expect(vacancy!.kind).toBe("seat_vacancy");
  });

  it("resolves the seat_vacancy matter once the seat is actually filled", () => {
    const w = withVacantSeat(world());
    const first = advanceWorldMatters(w, at(1), 1);
    expect(first.world.worldMatters!.some((m) => m.id === "seat-vacancy:roman-praetor:seat:0" && m.status !== "cancelled")).toBe(true);

    const filled = {
      ...first.world,
      material: {
        ...first.world.material,
        officeSeats: first.world.material.officeSeats.map((s) =>
          s.id === "roman-praetor:seat:0" ? { ...s, status: "held" as const, vacancyCause: "none" as const, holderCharacterId: "quintus-fabius" } : s,
        ),
      },
    };
    const second = advanceWorldMatters(filled, at(2), 2);
    expect(second.world.worldMatters!.find((m) => m.id === "seat-vacancy:roman-praetor:seat:0")!.status).toBe("cancelled");
  });

  it("detects a procedure_deadline matter once an open procedure passes its deadline unresolved", () => {
    const w = world();
    w.material.politicalProcedures = w.material.politicalProcedures.map((p) =>
      p.id === "senate-censure-marcus" ? { ...p, deadlineStep: 5 } : p,
    );
    const result = advanceWorldMatters(w, at(6), 6);
    const matter = result.world.worldMatters!.find((m) => m.id === "procedure-deadline:senate-censure-marcus");
    expect(matter).toBeDefined();
    expect(matter!.status).toBe("overdue");
  });

  it("never mutates world.material -- detection is pure and produces matters only", () => {
    const w = world();
    const before = structuredClone(w.material);
    advanceWorldMatters(w, at(4), 4);
    expect(w.material).toEqual(before);
  });
});
