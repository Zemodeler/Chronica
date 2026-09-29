import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { WorldStateSchema, type WorldState } from "@chronica/shared";
import { whoSeeksThePlayer } from "./initiative";

const base = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const player = { kind: "character" as const, id: "marcus-atilius" };
const seekers = (world: WorldState) => whoSeeksThePlayer({ world, playerRef: player });

function withOrderTo(world: WorldState, recipientId: string, status: "issued" | "carried_out"): WorldState {
  return {
    ...world,
    orderAttempts: [{
      id: "order-1", actionId: "action-1",
      issuerRef: player, recipientRef: { kind: "character", id: recipientId },
      claimedAuthorityGrantId: null,
      authorityCheck: { authorized: true, grant: null, standing: null, reason: "Find the money for two new legions" },
    instruction: "Find the money for two new legions",
    standing: "binding" as const,
      status, recipientDecisionReason: null, issuedAtStep: 0,
      decidedAtStep: status === "carried_out" ? 1 : null, consequenceFactRefs: [],
    }],
  };
}

describe("who seeks the ruler out", () => {
  it("sends someone who owes an answer to an order", () => {
    const result = seekers(withOrderTo(base(), "quintus-fabius", "issued"));
    expect(result.map((entry) => entry.characterId)).toContain("quintus-fabius");
    expect(result[0]!.openingLine).toContain("two new legions");
  });

  it("leaves alone someone who has already answered", () => {
    expect(seekers(withOrderTo(base(), "quintus-fabius", "carried_out"))).toHaveLength(0);
  });

  it("sends someone whose promise to the ruler has come due", () => {
    const world = base();
    const withPromise: WorldState = {
      ...world,
      commitments: [{
        id: "c1", promisorCharacterId: "quintus-fabius", beneficiaryCharacterId: "marcus-atilius",
        actionKind: "payment", description: "two hundred talents toward the legions", conditions: "",
        requiredOfficeId: null, requiredResource: null, visibility: "private", sourceEventId: null,
        breachPressureKind: "humiliation", status: "pending", createdAtStep: 0, reviewAtStep: 0,
        resolvedAtStep: null, resolutionReason: null,
      }],
    };
    expect(seekers(withPromise)[0]!.openingLine).toContain("two hundred talents");
  });

  it("waits until a promise is actually due", () => {
    const world = base();
    const notYet: WorldState = {
      ...world,
      commitments: [{
        id: "c1", promisorCharacterId: "quintus-fabius", beneficiaryCharacterId: "marcus-atilius",
        actionKind: "payment", description: "two hundred talents", conditions: "",
        requiredOfficeId: null, requiredResource: null, visibility: "private", sourceEventId: null,
        breachPressureKind: "humiliation", status: "pending", createdAtStep: 0, reviewAtStep: 400,
        resolvedAtStep: null, resolutionReason: null,
      }],
    };
    expect(seekers(notYet)).toHaveLength(0);
  });

  it("never sends the ruler to themselves", () => {
    const result = seekers(withOrderTo(base(), "marcus-atilius", "issued"));
    expect(result).toHaveLength(0);
  });

  it("does not swarm the ruler", () => {
    // Someone ignored because five people all wanted a word is worse than
    // hearing from the two who matter most.
    const world = base();
    const many: WorldState = {
      ...world,
      orderAttempts: world.characters.filter((c) => c.id !== "marcus-atilius").map((character, index) => ({
        id: `order-${index}`, actionId: `action-${index}`,
        issuerRef: player, recipientRef: { kind: "character" as const, id: character.id },
        claimedAuthorityGrantId: null,
        authorityCheck: { authorized: true, grant: null, standing: null, reason: "See to it" },
    instruction: "See to it",
    standing: "binding" as const,
        status: "issued" as const, recipientDecisionReason: null, issuedAtStep: 0,
        decidedAtStep: null, consequenceFactRefs: [],
      })),
    };
    expect(seekers(many).length).toBeLessThanOrEqual(2);
  });

  it("ignores a difficulty someone can be expected to manage themselves", () => {
    const world = base();
    const mild: WorldState = {
      ...world,
      characterPressures: [{
        id: "p1", characterId: "quintus-fabius", kind: "debt", intensity: 20, label: "Some modest debts",
        sourceEventId: null, createdAtStep: 0, reviewAtStep: 30, expiresAtStep: null,
        visibility: "private", status: "active",
      }],
    };
    expect(seekers(mild)).toHaveLength(0);
  });
});

describe("what stays hidden", () => {
  it("never sends someone whose heavy pressure is a secret", () => {
    // A planted fear of being found out at 80/100 used to walk up to the ruler
    // and confess itself as an opening line.
    const world = base();
    const pressure = (visibility: "private" | "polity") => ({
      id: `p-${visibility}`, characterId: "quintus-fabius", kind: "political_danger" as const, intensity: 80,
      label: "Afraid the consul suspects him.", sourceEventId: null, createdAtStep: 0, reviewAtStep: 30, expiresAtStep: null, visibility, status: "active" as const,
    });
    expect(seekers({ ...world, characterPressures: [pressure("private")] })).toHaveLength(0);
    expect(seekers({ ...world, characterPressures: [pressure("polity")] }).map((entry) => entry.characterId)).toContain("quintus-fabius");
  });
});

describe("people with business of their own", () => {
  const withQuintusFeeling = (world: WorldState, score: number, atStep: number, label: string): WorldState => ({
    ...world,
    characters: world.characters.map((character) => (character.id === "quintus-fabius"
      ? { ...character, relations: [{ subjectCharacterId: "marcus-atilius", causes: [{ id: "c", label, score, occurredAtStep: atStep, decayPerYearBps: 0, encounterMemoryId: null }] }] }
      : character)),
  });

  it("sends a man with a fresh and bitter grievance, in his own words, and not once it is old", () => {
    const world = { ...base(), elapsedStep: 10 };
    const bitter = seekers(withQuintusFeeling(world, -60, 5, "He had my brother condemned."));
    expect(bitter.map((entry) => entry.characterId)).toContain("quintus-fabius");
    expect(bitter.find((entry) => entry.characterId === "quintus-fabius")!.openingLine).toContain("He had my brother condemned.");
    expect(seekers(withQuintusFeeling({ ...world, elapsedStep: 100 }, -60, 5, "He had my brother condemned."))).toHaveLength(0);
  });

  it("sends a friend whose plan has come to the step he needs help with", () => {
    const world = withQuintusFeeling(base(), 50, 0, "Old friends.");
    const today = world.instant.day;
    const planning: WorldState = {
      ...world,
      characters: world.characters.map((character) => (character.id === "quintus-fabius"
        ? { ...character, ambitions: [{ id: "a", label: "Stand for the praetorship", kind: "office", targetId: null, status: "active", steps: [{ id: "s", act: "Canvass the tribes", dueDay: today + 5, laidOnDay: today, waitsOn: null, armedReading: null, status: "pending", wokenOnDay: null, settledOnDay: null }] }] }
        : character)),
    };
    expect(seekers(planning).find((entry) => entry.characterId === "quintus-fabius")?.openingLine).toContain("Stand for the praetorship");
  });
});
