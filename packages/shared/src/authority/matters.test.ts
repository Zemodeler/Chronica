import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema } from "../index";
import type { WorldState } from "../world/world-state";
import { mattersInHand, promisesResolvedSince } from "./matters";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const offices = definition.government.offices;
const clock = definition.clock;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const CONSUL = "gaius-genucius";
const CITIZEN = "manius-curius";
const KING = "hieron-ii";

function withCommitment(state: WorldState, commitment: Record<string, unknown>): WorldState {
  return WorldStateSchema.parse({
    ...state,
    commitments: [...state.commitments, {
      id: "promise-test", actionKind: "payment", conditions: "", visibility: "private", sourceEventId: null,
      createdAtStep: 0, reviewAtStep: 30, ...commitment,
    }],
  });
}

const rowsOf = (state: WorldState, characterId: string, section: string) =>
  mattersInHand(state, characterId, offices, clock).sections.find((entry) => entry.section === section)?.rows ?? [];

describe("matters in hand", () => {
  it("shows a promise made to you and one you made, each on its own side", () => {
    let state = withCommitment(world(), { id: "to-you", promisorCharacterId: KING, beneficiaryCharacterId: CONSUL, description: "Grain for the legions", status: "pending" });
    state = withCommitment(state, { id: "by-you", promisorCharacterId: CONSUL, beneficiaryCharacterId: KING, description: "Passage at Rhegium", status: "pending" });
    expect(rowsOf(state, CONSUL, "promised_to_you").map((row) => row.key)).toContain("promise:to-you");
    expect(rowsOf(state, CONSUL, "promised_by_you").map((row) => row.key)).toContain("promise:by-you");
  });

  it("keeps a broken promise in view for a month, then lets it go", () => {
    const broken = { id: "broken", promisorCharacterId: KING, beneficiaryCharacterId: CONSUL, description: "Grain", status: "broken", resolvedAtStep: 0 };
    const state = withCommitment(world(), broken);
    expect(promisesResolvedSince(state, CONSUL, -30).map((promise) => promise.status)).toEqual(["broken"]);
    const row = rowsOf(state, CONSUL, "promised_to_you").find((entry) => entry.key === "promise:broken")!;
    expect(row.detail).toMatch(/^Broken on/);
    const later = WorldStateSchema.parse({ ...state, elapsedStep: 60, instant: { ...state.instant, day: 60 } });
    expect(rowsOf(later, CONSUL, "promised_to_you").map((entry) => entry.key)).not.toContain("promise:broken");
  });

  it("never shows someone else's promise between two other people", () => {
    const state = withCommitment(world(), { id: "theirs", promisorCharacterId: KING, beneficiaryCharacterId: CITIZEN, description: "A secret", status: "pending" });
    const all = mattersInHand(state, CONSUL, offices, clock).sections.flatMap((section) => section.rows.map((row) => row.key));
    expect(all).not.toContain("promise:theirs");
  });

  it("names every war the viewer's power is in, for the citizen as for the consul", () => {
    const consul = rowsOf(world(), CONSUL, "wars").map((row) => row.key);
    const citizen = rowsOf(world(), CITIZEN, "wars").map((row) => row.key);
    expect(citizen).toEqual(consul);
  });

  it("lists a measure that was carried and enacts nothing", () => {
    const base = world();
    const senate = base.material.institutions.find((institution) => institution.polityId === "rome")!;
    const state = WorldStateSchema.parse({
      ...base,
      elapsedStep: 10, instant: { ...base.instant, day: 10 },
      material: {
        ...base.material,
        politicalProcedures: [...base.material.politicalProcedures, {
          id: "carried-nothing", type: "vote", institutionId: senate.id, sponsorCharacterId: CONSUL, subjectKind: "polity", subjectId: "rome",
          label: "Enlarge the army", stage: "resolved", resolutionMechanism: "vote", openedAtStep: 1, resolvedAtStep: 5,
          visibility: "public", outcome: "passed",
        }],
      },
    });
    const row = rowsOf(state, CONSUL, "voted_not_done").find((entry) => entry.key === "carried:carried-nothing");
    expect(row?.detail).toMatch(/says nothing that anyone must do/);
    expect(row?.marked).toBe(true);
  });
});
