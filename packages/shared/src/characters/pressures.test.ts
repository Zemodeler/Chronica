import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import {
  advancePressureLifecycle,
  createPressure,
  decayPressure,
  derivePressureTriggers,
  expirePressure,
  getActivePressures,
  resolvePressure,
  reviewPressure,
} from "./pressures";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);

describe("createPressure", () => {
  it("creates an active pressure and adds it to the owner's mind.currentPressures cache", () => {
    const w = createPressure(world(), {
      id: "p1", characterId: "marcus-atilius", kind: "debt", intensity: 40, label: "Owes money.",
      sourceEventId: null, atStep: 1, reviewInSteps: 4, expiresInSteps: null, visibility: "private",
    });
    expect(getActivePressures(w, "marcus-atilius").map((p) => p.id)).toEqual(["p1"]);
    expect(w.characters.find((c) => c.id === "marcus-atilius")!.mind.currentPressures).toEqual(["p1"]);
  });

  it("caps the pointer cache at 8, keeping the highest-intensity pressures", () => {
    let w: ReturnType<typeof createPressure> = world();
    for (let i = 0; i < 10; i++) {
      w = createPressure(w, {
        id: `p${i}`, characterId: "marcus-atilius", kind: "debt", intensity: i * 10,
        label: "x", sourceEventId: null, atStep: 1, reviewInSteps: 4, expiresInSteps: null, visibility: "private",
      });
    }
    const cache = w.characters.find((c) => c.id === "marcus-atilius")!.mind.currentPressures;
    expect(cache).toHaveLength(8);
    expect(cache).not.toContain("p0");
    expect(cache).not.toContain("p1");
  });
});

describe("review / decay / expire lifecycle", () => {
  it("reviewPressure pushes the review window out without changing intensity", () => {
    const created = createPressure(world(), {
      id: "p1", characterId: "hanno", kind: "threat", intensity: 50, label: "x",
      sourceEventId: null, atStep: 0, reviewInSteps: 2, expiresInSteps: null, visibility: "private",
    });
    const reviewed = reviewPressure(created, "p1", 2, 5);
    const pressure = reviewed.characterPressures.find((p) => p.id === "p1")!;
    expect(pressure.intensity).toBe(50);
    expect(pressure.reviewAtStep).toBe(7);
  });

  it("decayPressure lowers intensity and resolves the pressure once it reaches zero", () => {
    const created = createPressure(world(), {
      id: "p1", characterId: "hanno", kind: "grief", intensity: 8, label: "x",
      sourceEventId: null, atStep: 0, reviewInSteps: 2, expiresInSteps: null, visibility: "private",
    });
    const decayed = decayPressure(created, "p1", 2, 8, 4);
    const pressure = decayed.characterPressures.find((p) => p.id === "p1")!;
    expect(pressure.intensity).toBe(0);
    expect(pressure.status).toBe("resolved");
    expect(getActivePressures(decayed, "hanno")).toEqual([]);
  });

  it("expirePressure and resolvePressure both remove the pressure from the active cache", () => {
    const created = createPressure(world(), {
      id: "p1", characterId: "hanno", kind: "opportunity", intensity: 50, label: "x",
      sourceEventId: null, atStep: 0, reviewInSteps: 2, expiresInSteps: 5, visibility: "private",
    });
    const expired = expirePressure(created, "p1");
    expect(getActivePressures(expired, "hanno")).toEqual([]);
    expect(expired.characterPressures.find((p) => p.id === "p1")!.status).toBe("expired");

    const resolved = resolvePressure(created, "p1");
    expect(getActivePressures(resolved, "hanno")).toEqual([]);
    expect(resolved.characterPressures.find((p) => p.id === "p1")!.status).toBe("resolved");
  });

  it("advancePressureLifecycle expires a pressure past its expiry and decays one due for review", () => {
    let w = createPressure(world(), {
      id: "expiring", characterId: "hanno", kind: "opportunity", intensity: 50, label: "x",
      sourceEventId: null, atStep: 0, reviewInSteps: 100, expiresInSteps: 3, visibility: "private",
    });
    w = createPressure(w, {
      id: "reviewing", characterId: "hanno", kind: "debt", intensity: 50, label: "x",
      sourceEventId: null, atStep: 0, reviewInSteps: 3, expiresInSteps: null, visibility: "private",
    });
    const advanced = advancePressureLifecycle(w, 5);
    expect(advanced.characterPressures.find((p) => p.id === "expiring")!.status).toBe("expired");
    const reviewing = advanced.characterPressures.find((p) => p.id === "reviewing")!;
    expect(reviewing.status).toBe("active");
    expect(reviewing.intensity).toBeLessThan(50);
  });
});

describe("derivePressureTriggers", () => {
  it("creates a distinct illness pressure for an injury and a distinct humiliation pressure for a broken commitment", () => {
    const charactersBefore = world().characters;
    const marcusBefore = charactersBefore.find((c) => c.id === "marcus-atilius")!;
    const charactersAfter = charactersBefore.map((c) =>
      c.id === "marcus-atilius" ? { ...c, healthBps: c.healthBps - 3_000 } : c,
    );

    const proposals = derivePressureTriggers({
      atStep: 10,
      charactersBefore,
      charactersAfter,
      accountBalanceBefore: new Map(),
      accountBalanceAfter: new Map(),
      appliedSocialEvents: [],
      failedOrCancelledCommitments: [{ id: "commit-1", npcCharacterId: "hanno", playerCharacterId: "marcus-atilius" }],
      warringPolityIds: new Set(),
    });

    const illness = proposals.find((p) => p.characterId === "marcus-atilius" && p.kind === "illness");
    const humiliation = proposals.find((p) => p.characterId === "hanno" && p.kind === "humiliation");
    expect(illness).toBeDefined();
    expect(humiliation).toBeDefined();
    expect(illness!.id).not.toBe(humiliation!.id);
    expect(marcusBefore.healthBps).toBeGreaterThan(charactersAfter.find((c) => c.id === "marcus-atilius")!.healthBps);
  });

  it("creates a debt pressure only when a balance crosses from non-negative to negative", () => {
    const charactersBefore = world().characters;
    const proposals = derivePressureTriggers({
      atStep: 1,
      charactersBefore,
      charactersAfter: charactersBefore,
      accountBalanceBefore: new Map([["marcus-atilius", 100]]),
      accountBalanceAfter: new Map([["marcus-atilius", -50]]),
      appliedSocialEvents: [],
      failedOrCancelledCommitments: [],
      warringPolityIds: new Set(),
    });
    expect(proposals.some((p) => p.characterId === "marcus-atilius" && p.kind === "debt")).toBe(true);
  });

  it("creates a humiliation pressure for every participant of an applied insult event", () => {
    const charactersBefore = world().characters;
    const proposals = derivePressureTriggers({
      atStep: 1,
      charactersBefore,
      charactersAfter: charactersBefore,
      accountBalanceBefore: new Map(),
      accountBalanceAfter: new Map(),
      appliedSocialEvents: [{ id: "evt-1", kind: "insult", participantCharacterIds: ["marcus-atilius", "hanno"] }],
      failedOrCancelledCommitments: [],
      warringPolityIds: new Set(),
    });
    expect(proposals.filter((p) => p.kind === "humiliation" && p.sourceEventId === "evt-1")).toHaveLength(2);
  });

  it("is deterministic: identical inputs produce identical proposal ids", () => {
    const charactersBefore = world().characters;
    const charactersAfter = charactersBefore.map((c) => (c.id === "marcus-atilius" ? { ...c, healthBps: c.healthBps - 3_000 } : c));
    const inputs = {
      atStep: 10, charactersBefore, charactersAfter,
      accountBalanceBefore: new Map(), accountBalanceAfter: new Map(),
      appliedSocialEvents: [], failedOrCancelledCommitments: [], warringPolityIds: new Set<string>(),
    };
    const a = derivePressureTriggers(inputs);
    const b = derivePressureTriggers(inputs);
    expect(a.map((p) => p.id)).toEqual(b.map((p) => p.id));
  });
});
