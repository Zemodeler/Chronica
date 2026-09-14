import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { WorldState } from "../world/world-state";
import { buildAuthorityIndex, AuthorityGrantSchema, type AuthorityIndex } from "../authority/authority-grant";
import type { WorldMatter } from "./schema";
import { matterPriorityActors, resolveMatterRecipients } from "./routing";

const INSTANT = { day: 10, minute: 0 };

function world(): WorldState {
  return structuredClone(firstPunicWarScenario.initialWorld);
}

function baseMatter(overrides: Partial<WorldMatter> = {}): WorldMatter {
  return {
    id: "test-matter",
    kind: "civic",
    sourceRef: { kind: "institution", id: "test-institution" },
    status: "due",
    visibility: "public",
    summary: "A test matter.",
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
    provinceId: null,
    intensity: 40,
    reviews: 1,
    pressureId: null,
    createdAtStep: 1,
    lastReviewedStep: 1,
    nextReviewStep: 2,
    ...overrides,
  };
}

function forceCommandIndex(w: WorldState, atStep = 1): AuthorityIndex {
  return buildAuthorityIndex({ officeSeats: w.material.officeSeats, forces: w.material.forces }, [], [], atStep);
}

describe("resolveMatterRecipients (docs/plans/ai-world-matters-runtime.md, Phase 2 -- actor selection ladder)", () => {
  it("ranks an authority holder above a merely-interested character", () => {
    const w = world();
    w.characterGoals = [
      {
        id: "goal-1",
        characterId: "hanno",
        objective: "Undermine the Roman command.",
        category: "discredit_rival",
        targetEntityIds: ["test-institution"],
        priority: 3,
        status: "active",
        visibility: "private",
        causalFactIds: [],
        createdAtStep: 1,
        updatedAtStep: 1,
        history: [],
      },
    ];
    const matter = baseMatter({
      sourceRef: { kind: "institution", id: "test-institution" },
      requiredAuthority: [{ domain: "military", power: "command", scope: { kind: "force", id: "legio-i" } }],
    });
    const { recipients } = resolveMatterRecipients(w, matter, forceCommandIndex(w), 1, null);
    expect(recipients.length).toBeGreaterThanOrEqual(2);
    expect(recipients[0]!.actorRef).toEqual({ kind: "character", id: "marcus-atilius" });
    expect(recipients[0]!.role).toBe("responsible");
    const hannoEntry = recipients.find((r) => r.actorRef.kind === "character" && r.actorRef.id === "hanno")!;
    expect(hannoEntry.role).toBe("interested");
    expect(recipients[0]!.score).toBeGreaterThan(hannoEntry.score);
  });

  it("reroutes to the successor once the recorded office-holder dies and someone else holds the office", () => {
    const w = world();
    const matter = baseMatter({ id: "matter-rome", sourceRef: { kind: "polity", id: "rome" } });
    const index = forceCommandIndex(w);

    const before = resolveMatterRecipients(w, matter, index, 1, null);
    expect(before.recipients.some((r) => r.actorRef.kind === "character" && r.actorRef.id === "marcus-atilius" && r.role === "responsible")).toBe(true);

    const succeeded: WorldState = {
      ...w,
      characters: w.characters.map((c) => {
        if (c.id === "marcus-atilius") return { ...c, alive: false, officeId: null };
        if (c.id === "quintus-fabius") return { ...c, officeId: "roman-command" };
        return c;
      }),
    };
    const after = resolveMatterRecipients(succeeded, matter, forceCommandIndex(succeeded), 2, null);
    expect(after.recipients.some((r) => r.actorRef.kind === "character" && r.actorRef.id === "marcus-atilius")).toBe(false);
    expect(after.recipients.some((r) => r.actorRef.kind === "character" && r.actorRef.id === "quintus-fabius" && r.role === "responsible")).toBe(true);
  });

  it("never places the player in the main recipient list, only in playerResponsibleMatterIds", () => {
    const w = world();
    const matter = baseMatter({
      id: "matter-player",
      requiredAuthority: [{ domain: "military", power: "command", scope: { kind: "force", id: "legio-i" } }],
    });
    const { recipients, playerResponsibleMatterIds } = resolveMatterRecipients(w, matter, forceCommandIndex(w), 1, "marcus-atilius");
    expect(recipients.some((r) => r.actorRef.kind === "character" && r.actorRef.id === "marcus-atilius")).toBe(false);
    expect(playerResponsibleMatterIds).toEqual(["matter-player"]);
  });

  it("does not route a merely-affected or merely-interested player into playerResponsibleMatterIds", () => {
    const w = world();
    const matter = baseMatter({ id: "matter-affected", provinceId: "ita-72843720b81376294924159-sicily-northeast" });
    const { recipients, playerResponsibleMatterIds } = resolveMatterRecipients(w, matter, forceCommandIndex(w), 1, "marcus-atilius");
    expect(recipients.some((r) => r.actorRef.kind === "character" && r.actorRef.id === "marcus-atilius")).toBe(false);
    expect(playerResponsibleMatterIds).toEqual([]);
  });
});

describe("matterPriorityActors", () => {
  it("dedupes five due matters against the same actor into one priority entry with every reason folded in", () => {
    const w = world();
    const grant = AuthorityGrantSchema.parse({
      id: "treasury-grant",
      holder: { kind: "character", id: "marcus-atilius" },
      source: "custom",
      domain: "fiscal",
      scope: { kind: "account", id: "rome-treasury" },
      powers: ["spend"],
      standing: "lawful",
      grantedAtStep: 0,
    });
    const index: AuthorityIndex = { grants: [grant] };
    const matters: WorldMatter[] = Array.from({ length: 5 }, (_, i) =>
      baseMatter({
        id: `treasury-matter-${i}`,
        summary: `Obligation ${i} is due.`,
        status: "due",
        requiredAuthority: [{ domain: "fiscal", power: "spend", scope: { kind: "account", id: "rome-treasury" } }],
      }),
    );
    const withMatters: WorldState = { ...w, worldMatters: matters };
    const result = matterPriorityActors(withMatters, index, 1, "hanno", 3);
    expect(result.priorityCharacterIds).toEqual(["marcus-atilius"]);
    expect(result.reasons.get("marcus-atilius")).toHaveLength(5);
  });

  it("is capped at maxReserved even when more characters are eligible", () => {
    const w = world();
    const matters: WorldMatter[] = [
      baseMatter({ id: "m1", status: "due", provinceId: "ita-72843720b81376294924159-sicily-northeast" }),
      baseMatter({ id: "m2", status: "due", provinceId: "ita-72843720b81376294924159-sicily-west" }),
      baseMatter({ id: "m3", status: "overdue", sourceRef: { kind: "polity", id: "rome" } }),
    ];
    const withMatters: WorldState = { ...w, worldMatters: matters };
    const result = matterPriorityActors(withMatters, forceCommandIndex(w), 1, "no-such-player", 1);
    expect(result.priorityCharacterIds.length).toBeLessThanOrEqual(1);
  });
});
