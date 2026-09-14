import { describe, expect, it } from "vitest";
import {
  MatterDispositionSchema,
  MatterEntityRefSchema,
  MatterOfferSchema,
  toPartyRef,
  WorldMatterKindSchema,
  WorldMatterSchema,
  type WorldMatter,
} from "./schema";

const INSTANT = { day: 10, minute: 0 };

function baseMatter(overrides: Partial<WorldMatter> = {}): WorldMatter {
  return {
    id: "scarcity:sicily",
    kind: "scarcity",
    sourceRef: { kind: "province", id: "sicily" },
    status: "due",
    visibility: "public",
    summary: "Food insecurity in Sicily.",
    urgency: 40,
    createdAt: INSTANT,
    dueAt: null,
    nextReviewAt: INSTANT,
    lastReviewedAt: null,
    requiredAuthority: [],
    responsibleScopeRefs: [],
    stakeholderRefs: [],
    relevantFactIds: [],
    standingPlanId: null,
    supersedesMatterId: null,
    parentMatterId: null,
    offers: [],
    dispositions: [],
    resolutionFactIds: [],
    provinceId: "sicily",
    intensity: 40,
    reviews: 1,
    pressureId: null,
    createdAtStep: 1,
    lastReviewedStep: 1,
    nextReviewStep: 2,
    ...overrides,
  };
}

describe("WorldMatterKindSchema", () => {
  it("accepts every legacy and reserved kind", () => {
    const kinds = [
      "scarcity", "reconstruction", "civic", "war_burden", "household",
      "income_assessment", "obligation_due", "treasury_risk", "office_term", "seat_vacancy",
      "supply_review", "treaty_review", "commitment_review", "plan_premise_lost",
    ];
    for (const kind of kinds) expect(WorldMatterKindSchema.safeParse(kind).success).toBe(true);
  });

  it("rejects an unknown kind", () => {
    expect(WorldMatterKindSchema.safeParse("something_else").success).toBe(false);
  });
});

describe("MatterEntityRefSchema and toPartyRef", () => {
  it("accepts every shared and matter-only kind", () => {
    for (const kind of ["character", "polity", "force", "region", "world", "income_source", "obligation", "holding", "household", "seat", "commitment", "treaty", "war"]) {
      expect(MatterEntityRefSchema.safeParse({ kind, id: "x" }).success).toBe(true);
    }
  });

  it(".strict() rejects an unknown key", () => {
    expect(MatterEntityRefSchema.safeParse({ kind: "character", id: "x", extra: 1 }).success).toBe(false);
  });

  it("narrows a shared kind to an OrderPartyRef", () => {
    expect(toPartyRef({ kind: "character", id: "marcus" })).toEqual({ kind: "character", id: "marcus" });
    expect(toPartyRef({ kind: "province", id: "sicily" })).toEqual({ kind: "province", id: "sicily" });
  });

  it("returns null for a matter-only kind", () => {
    expect(toPartyRef({ kind: "obligation", id: "legio-i-pay" })).toBeNull();
    expect(toPartyRef({ kind: "household", id: "h1" })).toBeNull();
  });
});

describe("MatterOfferSchema", () => {
  const validOffer = {
    actorRef: { kind: "character", id: "marcus" },
    offeredAt: INSTANT,
    role: "responsible",
    knowledgeFactIds: [],
    outcome: "pending",
    intentIds: [],
  };

  it("parses a valid offer", () => {
    expect(MatterOfferSchema.safeParse(validOffer).success).toBe(true);
  });

  it(".strict() rejects an unknown key", () => {
    expect(MatterOfferSchema.safeParse({ ...validOffer, extra: 1 }).success).toBe(false);
  });

  it("enforces the knowledgeFactIds cap (max 8)", () => {
    expect(MatterOfferSchema.safeParse({ ...validOffer, knowledgeFactIds: Array.from({ length: 8 }, (_, i) => `f${i}`) }).success).toBe(true);
    expect(MatterOfferSchema.safeParse({ ...validOffer, knowledgeFactIds: Array.from({ length: 9 }, (_, i) => `f${i}`) }).success).toBe(false);
  });

  it("enforces the intentIds cap (max 4)", () => {
    expect(MatterOfferSchema.safeParse({ ...validOffer, intentIds: Array.from({ length: 4 }, (_, i) => `i${i}`) }).success).toBe(true);
    expect(MatterOfferSchema.safeParse({ ...validOffer, intentIds: Array.from({ length: 5 }, (_, i) => `i${i}`) }).success).toBe(false);
  });
});

describe("MatterDispositionSchema", () => {
  it("enforces the evidenceFactIds cap (max 12)", () => {
    const base = { kind: "addressed", atInstant: INSTANT, byActorRef: null, evidenceFactIds: [], note: "" };
    expect(MatterDispositionSchema.safeParse({ ...base, evidenceFactIds: Array.from({ length: 12 }, (_, i) => `f${i}`) }).success).toBe(true);
    expect(MatterDispositionSchema.safeParse({ ...base, evidenceFactIds: Array.from({ length: 13 }, (_, i) => `f${i}`) }).success).toBe(false);
  });
});

describe("WorldMatterSchema", () => {
  it("parses a well-formed matter of every legacy kind", () => {
    for (const kind of ["scarcity", "reconstruction", "civic", "war_burden", "household"] as const) {
      const result = WorldMatterSchema.safeParse(baseMatter({ id: `${kind}:x`, kind }));
      expect(result.success).toBe(true);
    }
  });

  it(".strict() rejects an unknown top-level key", () => {
    expect(WorldMatterSchema.safeParse({ ...baseMatter(), extra: 1 }).success).toBe(false);
  });

  it("enforces the offers cap (max 24)", () => {
    const offer: WorldMatter["offers"][number] = { actorRef: { kind: "character", id: "marcus" }, offeredAt: INSTANT, role: "responsible", knowledgeFactIds: [], outcome: "pending", intentIds: [] };
    expect(WorldMatterSchema.safeParse(baseMatter({ offers: Array.from({ length: 24 }, () => offer) })).success).toBe(true);
    expect(WorldMatterSchema.safeParse(baseMatter({ offers: Array.from({ length: 25 }, () => offer) })).success).toBe(false);
  });

  it("enforces the dispositions cap (max 16)", () => {
    const disposition = { kind: "deferred" as const, atInstant: INSTANT, byActorRef: null, evidenceFactIds: [], note: "" };
    expect(WorldMatterSchema.safeParse(baseMatter({ dispositions: Array.from({ length: 16 }, () => disposition) })).success).toBe(true);
    expect(WorldMatterSchema.safeParse(baseMatter({ dispositions: Array.from({ length: 17 }, () => disposition) })).success).toBe(false);
  });

  it("enforces the responsibleScopeRefs/stakeholderRefs cap (max 8 each)", () => {
    const ref = { kind: "character" as const, id: "marcus" };
    expect(WorldMatterSchema.safeParse(baseMatter({ responsibleScopeRefs: Array.from({ length: 8 }, () => ref) })).success).toBe(true);
    expect(WorldMatterSchema.safeParse(baseMatter({ responsibleScopeRefs: Array.from({ length: 9 }, () => ref) })).success).toBe(false);
    expect(WorldMatterSchema.safeParse(baseMatter({ stakeholderRefs: Array.from({ length: 8 }, () => ref) })).success).toBe(true);
    expect(WorldMatterSchema.safeParse(baseMatter({ stakeholderRefs: Array.from({ length: 9 }, () => ref) })).success).toBe(false);
  });

  it("rejects status \"addressed\" with empty resolutionFactIds", () => {
    const result = WorldMatterSchema.safeParse(baseMatter({ status: "addressed", resolutionFactIds: [] }));
    expect(result.success).toBe(false);
  });

  it("accepts status \"addressed\" once resolutionFactIds is non-empty", () => {
    const result = WorldMatterSchema.safeParse(baseMatter({ status: "addressed", resolutionFactIds: ["fact-1"] }));
    expect(result.success).toBe(true);
  });
});
