import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { DiplomaticMessageSchema, WorldStateSchema, ensureProvinceMaterial, type WorldState } from "@chronica/shared";
import { createIdFactory } from "./ports";
import { unionScore, UNION_ACCEPTS_AT } from "./submission";
import { runDeterministicTick } from "./tick";

/**
 * An ally taken into the state keeps no treaty with it (docs/reports/consul-run-issues.md, M7). Six allies of Rome joined it
 * in the consul run, and their foedus stood "active" for the rest of the run: the tick settled the union on a copy of the
 * agreements, and wrote back the list it had kept from the start of the day.
 */
describe("an ally's years of following", () => {
  it("count from its foedus's own date, not the first day of the world (M6)", () => {
    const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    // The Marsi, allies since 304, have followed Rome for thirty-four years in 270.
    expect(opening.polityAgreements.find((agreement) => agreement.id === "foedus-marsi-paeligni")?.heldYearsAtStart).toBe(34);
    expect(unionScore(opening, "marsi-paeligni", "rome", "none", "years").reasons).toContain("it has followed for 34 years");
  });
});

describe("an ally united with Rome in the tick", () => {
  it("ends its foedus with it", () => {
    const opening = ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
    const ally = "marsi-paeligni";
    expect(opening.polityAgreements.find((agreement) => agreement.id === `foedus-${ally}`)?.status).toBe("active");
    // An ally with no men under arms cannot stand alone, and is offered the citizenship: it will join.
    const world: WorldState = {
      ...opening,
      material: { ...opening.material, forces: opening.material.forces.filter((force) => force.polityId !== ally) },
      diplomacy: [...opening.diplomacy, DiplomaticMessageSchema.parse({
        id: "message-union-test", kind: "letter", fromPolityId: "rome", fromCharacterId: "gaius-genucius", toPolityId: ally, toCharacterId: null,
        subject: "Union and the citizenship", terms: "Union into the Roman state and the full citizenship.", sentAtStep: 0, replyDueByStep: 1,
        clauses: [{ kind: "submission", polityId: ally, toPolityId: "rome" }],
      })],
    };
    expect(unionScore(world, ally, "rome", "citizenship", "message-union-test").score).toBeGreaterThanOrEqual(UNION_ACCEPTS_AT);
    const ticked = runDeterministicTick({ world: { ...world, elapsedStep: 1, instant: { ...world.instant, day: 1 } }, toDay: 1, ids: createIdFactory("union-test") }).world;
    expect(ticked.map.polities.find((polity) => polity.id === ally)?.endedHow).toBe("absorbed");
    expect(ticked.polityAgreements.find((agreement) => agreement.id === `foedus-${ally}`)?.status).toBe("ended");
  });
});
