import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "@chronica/shared";
import { projectConflicts, warsFromAgreements } from "./conflicts";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

describe("what the map shows of the fighting", () => {
  const atWar = (state: WorldState = world()): WorldState => ({
    ...state,
    polityAgreements: [{
      id: "war-1", kind: "war", polityId: "rome", otherPolityId: "carthage",
      terms: "Over Sicily.", sinceStep: 0, untilStep: null, sourceMessageId: null,
      status: "active", endedAtStep: null, endedReason: null, visibility: "public",
    }],
  });

  it("draws a war from the agreement that is the war", () => {
    // The overlay has been read by the map since the map existed and written by
    // nothing, so a war was fought and the map showed a quiet border.
    const wars = warsFromAgreements(atWar());
    expect(wars).toHaveLength(1);
    // The overlay orders the pair, so one war is one entry however it was written.
    expect(wars[0]!.polityAId < wars[0]!.polityBId).toBe(true);
  });

  it("stops drawing it once the war has ended", () => {
    const state = atWar();
    const ended: WorldState = { ...state, polityAgreements: state.polityAgreements.map((agreement) => ({ ...agreement, status: "ended" as const })) };
    expect(warsFromAgreements(ended)).toHaveLength(0);
  });

  it("leaves battles where they were recorded", () => {
    const state: WorldState = {
      ...atWar(),
      conflicts: { battles: [{ battleId: "battle-1", participantForceIds: ["legio-i", "carthaginian-army"], attackerForceIds: ["legio-i"] }], sieges: [], wars: [] },
    };
    expect(projectConflicts(state).battles).toHaveLength(1);
  });
});
