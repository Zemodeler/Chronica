import { describe, expect, it } from "vitest";
import { DELTA_AUTHORITY_DOMAIN, WORLD_DELTA_OPS, WorldDeltaSchema } from "./deltas";
import { DOMAIN_POWER_BY_ACTION } from "../authority/authority-grant";
import { OrchestratorOutputSchema } from "./proposal";
import { localRef, resolveRef } from "./refs";

const RAISE_TWO_LEGIONS = {
  intent: { summary: "Increase Roman field strength by roughly two legions.", domains: ["military", "finance"] },
  narrativeSummary: "Recruitment opens in Latium and Campania, part-funded by merchant credit.",
  frictions: ["Treasury reserves cover only part of the cost."],
  deltas: [
    { op: "money_transfer", fromAccountRef: "acct-rome", toAccountRef: null, amount: 220, reason: "Initial levy and equipment contracts." },
    {
      op: "project_create",
      localId: "recruitment",
      kind: "recruitment",
      label: "Two new legions",
      sponsorRef: { kind: "polity", id: "rome" },
      fundingAccountRef: "acct-rome",
      milestones: [{ label: "Financing committed", dueInDays: 9, costAmount: 0 }],
      reason: "Recruitment takes months, so it persists as a project.",
    },
    { op: "force_create", localId: "legion_v", name: "Fifth Legion", polityId: "rome", commanderCharacterRef: "char-appius", controllerCharacterRef: "char-appius", locationId: "prov-latium", authorizedStrength: 4200, reason: "First of the two legions." },
  ],
  facts: [
    { localId: "mobilization", kind: "military_mobilization", summary: "Rome begins major military recruitment.", affectedRefs: [{ kind: "polity", id: "rome" }], visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 55 },
  ],
  delegations: [
    { localId: "financing", issuerRef: { kind: "character", id: "char-player" }, recipientRef: { kind: "character", id: "char-quaestor" }, claimedAuthorityGrantRef: null, instruction: "Find the money for two new legions." },
  ],
  schedule: [{ kind: "recruitment_milestone", dueInDays: 30, summary: "First recruits assemble.", subjectRefs: [localRef("recruitment")], causeFactLocalId: "mobilization" }],
  cognitionCandidates: [{ actorRef: { kind: "polity", id: "carthage" }, question: "How should Carthage answer Roman mobilization?", urgency: 70 }],
  outcome: "chronicle",
  playerDecision: null,
};

describe("orchestrator output contract", () => {
  it("round-trips a complete proposal", () => {
    const parsed = OrchestratorOutputSchema.parse(RAISE_TWO_LEGIONS);
    expect(OrchestratorOutputSchema.parse(parsed)).toEqual(parsed);
    expect(parsed.deltas).toHaveLength(3);
  });

  it("rejects an unknown delta op rather than ignoring it", () => {
    const smuggled = { ...RAISE_TWO_LEGIONS, deltas: [{ op: "delete_polity", polityId: "carthage" }] };
    expect(OrchestratorOutputSchema.safeParse(smuggled).success).toBe(false);
  });

  it("rejects unknown top-level keys", () => {
    expect(OrchestratorOutputSchema.safeParse({ ...RAISE_TWO_LEGIONS, stateHash: "forged" }).success).toBe(false);
  });
});

describe("engine-assigned ids", () => {
  // The model may name what it creates, but never id it: a hallucinated id that
  // reaches storage is indistinguishable from a real one afterwards.
  it("rejects a delta that supplies its own entity id", () => {
    const result = WorldDeltaSchema.safeParse({
      op: "force_create",
      id: "force-legion-v",
      localId: "legion_v",
      name: "Fifth Legion",
      polityId: "rome",
      commanderCharacterRef: "char-appius",
      controllerCharacterRef: "char-appius",
      locationId: "prov-latium",
      authorizedStrength: 4200,
      reason: "First of the two legions.",
    });
    expect(result.success).toBe(false);
  });
});

describe("local reference resolution", () => {
  const assigned = new Map([["legion_v", "force-sim-burst1-3"]]);

  it("resolves a handle minted in the same payload", () => {
    expect(resolveRef(localRef("legion_v"), assigned)).toBe("force-sim-burst1-3");
  });

  it("passes an existing world id through untouched", () => {
    expect(resolveRef("acct-rome", assigned)).toBe("acct-rome");
  });

  it("yields undefined for an unknown handle, so the caller can record friction", () => {
    expect(resolveRef(localRef("phantom"), assigned)).toBeUndefined();
  });
});

describe("local handles", () => {
  it("accepts the hyphenated handles the model writes", () => {
    const parsed = WorldDeltaSchema.safeParse({ op: "character_intent_set", actorCharacterRef: "local:clepsina-continues-march", actionType: "prepare", rationale: "On the road." });
    expect(parsed.success).toBe(true);
  });
});

describe("authority domain map", () => {
  it("classifies every delta op", () => {
    for (const op of WORLD_DELTA_OPS) expect(DELTA_AUTHORITY_DOMAIN[op]).toBeDefined();
    expect(Object.keys(DELTA_AUTHORITY_DOMAIN).sort()).toEqual([...WORLD_DELTA_OPS].sort());
  });

  it("gives every op an office can list a power to derive from it", () => {
    // Offices derive their authority from the ops they list, through this
    // second map. An op missing here derived nothing, so the first person to
    // use it lawfully -- a consul resolving a Senate procedure -- was recorded
    // as insubordinate. Fiscal ops are scoped to a named treasury instead.
    const ops = new Set<string>(WORLD_DELTA_OPS);
    for (const key of Object.keys(DOMAIN_POWER_BY_ACTION)) expect(ops.has(key), key).toBe(true);
    for (const op of WORLD_DELTA_OPS) {
      if (DELTA_AUTHORITY_DOMAIN[op] === "fiscal") continue;
      expect(DOMAIN_POWER_BY_ACTION[op], op).toBeDefined();
    }
  });
});

