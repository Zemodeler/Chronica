import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { buildChronicleNarratorPrompt } from "./prompts";

describe("narrator creative boundaries", () => {
  it("supports scene staging and recorded speech without losing settled outcomes or uncertain attribution", () => {
    const world = firstPunicWarScenario.initialWorld;
    const prompt = buildChronicleNarratorPrompt([
      { body: "The transfer completed.", isPlayerAction: true, outcomeLocked: true, depth: "scene" },
      { body: "Word of unrest reached the court.", isPlayerAction: false, knowledgeStatus: "rumour", depth: "dispatch" },
    ], world, world.characters[0]!.id, null);
    expect(prompt).toContain("[OUTCOME: SETTLED");
    expect(prompt).toContain("[KNOWLEDGE: RUMOUR]");
    expect(prompt).toContain("restrained sensory detail");
    expect(prompt).toContain("Use recorded quotations");
    expect(prompt).toContain("never invent an oath, bargain, confession");
    expect(prompt).toContain("will not create new simulation facts");
    expect(prompt).not.toContain("Add the plausible intermediate steps");
  });
});
