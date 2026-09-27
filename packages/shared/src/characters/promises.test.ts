import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema } from "../index";
import { promisesOf } from "./promises";
import { CommitmentSchema } from "./commitments";
import type { WorldState } from "../world/world-state";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const promise = (state: WorldState, id: string, from: string, to: string, status = "pending", inDays = 10) => CommitmentSchema.parse({
  id, promisorCharacterId: from, beneficiaryCharacterId: to, actionKind: "political_support", description: "Speak for him in the Senate.",
  visibility: "private", sourceEventId: null, status, createdAtStep: state.elapsedStep, reviewAtStep: state.elapsedStep + inDays,
});

describe("the player's promises", () => {
  it("lists what he promised and what was promised him, and nobody else's", () => {
    const state = world();
    const [player, other, third] = state.characters;
    const withPromises: WorldState = {
      ...state,
      commitments: [
        promise(state, "mine", player!.id, other!.id),
        promise(state, "to-me", other!.id, player!.id, "pending", 40),
        promise(state, "theirs", other!.id, third!.id),
        promise(state, "kept", player!.id, other!.id, "fulfilled"),
      ],
    };
    const readings = promisesOf(withPromises, player!.id);
    expect(readings.map((reading) => reading.id)).toEqual(["mine", "to-me"]);
    expect(readings[0]).toMatchObject({ yours: true, pressing: true });
    expect(readings[0]!.between).toBe(`You promised ${other!.name}`);
    expect(readings[1]).toMatchObject({ yours: false, pressing: false });
  });
});
