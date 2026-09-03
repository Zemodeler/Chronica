import { describe, expect, it } from "vitest";
import type { CharacterBelief } from "../characters/beliefs";
import { projectChronicleEntry, redactChronicleFacts, resolveChronicleVisibility, type ChronicleFactRecord } from "./knowledge";

const belief = (overrides: Partial<CharacterBelief> = {}): CharacterBelief => ({
  id: "belief-1",
  holderCharacterId: "hanno",
  subjectEntityId: "secret-plot",
  claim: "Something is afoot.",
  kind: "rumour",
  sourceCharacterId: null,
  sourceEventId: null,
  confidence: 50,
  visibility: "private",
  learnedAtStep: 0,
  expiresAtStep: null,
  supersedesBeliefIds: [],
  status: "active",
  ...overrides,
});

const entry = (overrides: Partial<ChronicleFactRecord> = {}): ChronicleFactRecord => ({
  id: "entry-1",
  sequence: 0,
  audience: "all_players",
  body: "Something happened.",
  atStep: 4,
  ...overrides,
});

describe("resolveChronicleVisibility", () => {
  it("always shows an all_players entry", () => {
    expect(resolveChronicleVisibility(entry({ audience: "all_players" }), null, [])).toBe(true);
  });

  it("hides a knowledge_scoped entry with no viewer", () => {
    expect(resolveChronicleVisibility(entry({ audience: "knowledge_scoped", scopeRef: "secret-plot" }), null, [])).toBe(false);
  });

  it("hides a knowledge_scoped entry when the viewer holds no matching belief", () => {
    const visible = resolveChronicleVisibility(entry({ audience: "knowledge_scoped", scopeRef: "secret-plot" }), "hanno", []);
    expect(visible).toBe(false);
  });

  it("shows a knowledge_scoped entry when the viewer holds a matching active belief", () => {
    const visible = resolveChronicleVisibility(
      entry({ audience: "knowledge_scoped", scopeRef: "secret-plot" }),
      "hanno",
      [belief()],
    );
    expect(visible).toBe(true);
  });

  it("does not leak to a viewer whose belief names a different subject", () => {
    const visible = resolveChronicleVisibility(
      entry({ audience: "knowledge_scoped", scopeRef: "other-subject" }),
      "hanno",
      [belief()],
    );
    expect(visible).toBe(false);
  });
});

describe("redactChronicleFacts", () => {
  it("never passes through an unrecognised key", () => {
    const withExtra = { ...entry(), secretPlan: "invade at dawn" } as ChronicleFactRecord & { secretPlan: string };
    const view = redactChronicleFacts(withExtra);
    expect(view).not.toHaveProperty("secretPlan");
  });

  it("defaults title and knowledgeStatus when absent", () => {
    const view = redactChronicleFacts(entry());
    expect(view.title).toBe("Chronicle entry");
    expect(view.knowledgeStatus).toBe("confirmed");
  });

  it("carries politicalOutcome/lifeEvent through unchanged", () => {
    const view = redactChronicleFacts(entry({
      lifeEvent: { characterId: "c1", characterName: "Marcus", kind: "death", cause: "old age", estateOutcome: null, vacatedOfficeIds: [] },
    }));
    expect(view.lifeEvent?.characterName).toBe("Marcus");
  });
});

describe("projectChronicleEntry", () => {
  it("returns null when the viewer may not see the entry", () => {
    expect(projectChronicleEntry(entry({ audience: "knowledge_scoped", scopeRef: "secret-plot" }), null, [])).toBeNull();
  });

  it("returns a redacted view when visible", () => {
    const view = projectChronicleEntry(entry(), null, []);
    expect(view?.id).toBe("entry-1");
    expect(view?.body).toBe("Something happened.");
  });
});
