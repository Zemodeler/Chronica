import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, localRef, type Office, type WorldDelta, type WorldState } from "@chronica/shared";
import { createIdFactory } from "../ports";
import { applyDeltas } from "./apply-deltas";
import type { ApplyContext } from "./context";

const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const offices: readonly Office[] = definition.government.offices;
const warfare = definition.warfare;

/** Marcus holds the Roman command seat, so he is the authorized actor in these fixtures. */
function context(overrides: Partial<ApplyContext> = {}): ApplyContext {
  return {
    now: { day: 0, minute: 540 },
    actorRef: { kind: "character", id: "marcus-atilius" },
    offices,
    warfare,
    ids: createIdFactory("test"),
    gameId: "game-1",
    ...overrides,
  };
}

const totalMoney = (state: WorldState): number => state.material.accounts.reduce((sum, account) => sum + account.balance, 0);

describe("money", () => {
  it("moves exactly the stated amount between accounts and conserves the rest", () => {
    const before = world();
    const opening = totalMoney(before);
    const result = applyDeltas(
      before,
      [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "hanno-purse", amount: 200, reason: "A private settlement." }],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    expect(totalMoney(result.world)).toBe(opening);
    expect(result.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance).toBe(1_000);
    expect(result.world.material.accounts.find((a) => a.id === "hanno-purse")!.balance).toBe(1_100);
  });

  it("lets money leave the modelled world when it is paid to no account", () => {
    const before = world();
    const result = applyDeltas(
      before,
      [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 200, reason: "Paid to foreign shipwrights." }],
      context(),
    );
    expect(result.rejected).toHaveLength(0);
    expect(totalMoney(result.world)).toBe(totalMoney(before) - 200);
  });

  it("refuses a payment larger than the balance as friction, leaving every balance untouched", () => {
    const before = world();
    const result = applyDeltas(
      before,
      [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "hanno-purse", amount: 99_999, reason: "An impossible levy." }],
      context(),
    );

    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("cannot cover");
    expect(result.world.material.accounts).toEqual(before.material.accounts);
  });

  it("keeps applying the rest of a batch after one delta is refused", () => {
    const result = applyDeltas(
      world(),
      [
        { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "hanno-purse", amount: 99_999, reason: "An impossible levy." },
        { op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "hanno-purse", amount: 100, reason: "What could actually be raised." },
      ],
      context(),
    );

    expect(result.rejected).toHaveLength(1);
    expect(result.applied).toHaveLength(1);
    expect(result.world.material.accounts.find((a) => a.id === "marcus-purse")!.balance).toBe(1_100);
  });
});

describe("engine-assigned ids", () => {
  it("mints ids for created entities and resolves later references to them", () => {
    const create: WorldDelta = {
      op: "project_create",
      localId: "recruitment",
      kind: "recruitment",
      label: "Two new legions",
      sponsorRef: { kind: "polity", id: "rome" },
      fundingAccountRef: "marcus-purse",
      milestones: [{ label: "Financing committed", dueInDays: 9, costAmount: 0 }, { label: "Recruits assemble", dueInDays: 120, costAmount: 0 }],
      reason: "Recruitment takes months.",
    };
    const first = applyDeltas(world(), [create], context());
    const project = first.world.projects[0]!;
    expect(project.id).toBe("project-test-1");
    expect(first.assignedIds.get("recruitment")).toBe("project-test-1");

    const second = applyDeltas(
      first.world,
      [{ op: "project_milestone_update", projectRef: project.id, milestoneId: project.milestones[0]!.id, status: "completed", reason: "Financing arranged." }],
      context(),
    );
    expect(second.rejected).toHaveLength(0);
    expect(second.world.projects[0]!.milestones[0]!.status).toBe("completed");
    expect(second.world.projects[0]!.status).toBe("in_progress");
  });

  it("refuses a reference to a handle nothing in the batch created", () => {
    const result = applyDeltas(
      world(),
      [{ op: "force_modify", forceRef: localRef("phantom_legion"), moraleBpsDelta: 500, reason: "Encouraging a force that does not exist." }],
      context(),
    );
    expect(result.applied).toHaveLength(0);
    expect(result.rejected[0]?.reason).toContain("which nothing in this batch created");
  });

  it("refuses a delta naming an entity that does not exist", () => {
    const result = applyDeltas(
      world(),
      [{ op: "force_modify", forceRef: "force-that-never-was", moraleBpsDelta: 500, reason: "Encouraging nobody." }],
      context(),
    );
    expect(result.rejected[0]?.reason).toContain("No force");
  });
});

describe("authority", () => {
  it("records an authorized act as authorized", () => {
    const result = applyDeltas(
      world(),
      [{ op: "force_modify", forceRef: "legio-i", moraleBpsDelta: 200, reason: "The consul inspects his legion." }],
      context(),
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.authority.authorized).toBe(true);
    expect(result.breaches).toHaveLength(0);
  });

  it("lets a character spend their own purse without recording a breach", () => {
    // Found running a live model: office grants cover an office's named
    // treasury and nothing else, so spending one's own money was reported as
    // insubordination -- which made every privately funded act look like theft.
    const result = applyDeltas(
      world(),
      [{ op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: null, amount: 100, reason: "Paying recruiters from his own purse." }],
      context(),
    );
    expect(result.breaches).toHaveLength(0);
    expect(result.applied[0]!.authority.authorized).toBe(true);
  });

  it("judges an unscoped act in the actor's own polity, not whichever polity happens to be first", () => {
    // Also found live: the fallback scope read `map.polities[0]`, so a Roman
    // consul's every unscoped act was checked against Carthage and breached.
    const result = applyDeltas(
      world(),
      [{ op: "character_intent_set", actorCharacterRef: "marcus-atilius", actionType: "prepare", targetRefs: [], rationale: "Preparing the levy.", priority: 50, visibility: "private" }],
      context(),
    );
    expect(result.applied).toHaveLength(1);
    expect(result.applied[0]!.authority.reason).not.toContain("carthage");
  });

  it("carries out an unauthorized act and records it as a breach rather than refusing it", () => {
    // VISION §12: a general who marches without orders has not performed an
    // invalid action. He has committed insubordination, and the world must be
    // able to see that he did.
    const before = world();
    const result = applyDeltas(
      before,
      [{ op: "force_modify", forceRef: "legio-i", locationId: "tun-13205935b88806172084765", reason: "Marching without authority." }],
      context({ actorRef: { kind: "character", id: "hanno" } }),
    );

    expect(result.rejected).toHaveLength(0);
    expect(result.applied).toHaveLength(1);
    expect(result.breaches).toHaveLength(1);
    expect(result.breaches[0]!.reason).toContain("No active grant");
    expect(result.world.material.forces.find((f) => f.id === "legio-i")!.locationId).toBe("tun-13205935b88806172084765");
  });
});

describe("dynamic world generation", () => {
  it("creates a persistent character the world needed, with a purse of their own", () => {
    const result = applyDeltas(
      world(),
      [
        {
          op: "character_create",
          localId: "quaestor",
          name: "Marcus Fabius Varro",
          polityId: "rome",
          provinceId: null,
          age: 38,
          officeLabel: "Military Quaestor",
          traits: ["methodical", "politically cautious"],
          generatedBecause: "Responsible for financing the current mobilization.",
        },
      ],
      context(),
    );

    expect(result.rejected).toHaveLength(0);
    const created = result.world.characters.find((c) => c.name === "Marcus Fabius Varro");
    expect(created).toBeDefined();
    expect(created!.traits).toContain("methodical");
    expect(result.world.material.accounts.some((a) => a.id === created!.personalAccountId)).toBe(true);
  });

  it("records a novel institution as a generic entity rather than inventing a mechanic", () => {
    const result = applyDeltas(
      world(),
      [
        {
          op: "generic_entity_create",
          localId: "credit_office",
          kind: "financial_institution",
          label: "Roman Public Credit Office",
          ownerRef: { kind: "polity", id: "rome" },
          attributes: { capital: 480, stateOwnershipBps: 6_000 },
          reason: "The Senate charters a public lending office.",
        },
      ],
      context(),
    );
    expect(result.world.genericEntities[0]).toMatchObject({ kind: "financial_institution", label: "Roman Public Credit Office" });
  });
});

describe("diplomacy", () => {
  it("shifts a stance and clamps it inside the score range", () => {
    const result = applyDeltas(
      world(),
      [{ op: "polity_stance_shift", polityId: "carthage", towardPolityId: "rome", trustDelta: -120, reason: "Roman mobilization." }],
      context(),
    );
    const stance = result.world.polityStances.find((s) => s.polityId === "carthage" && s.towardPolityId === "rome");
    expect(stance!.trustScore).toBe(-100);
  });

  it("refuses a stance a polity would hold toward itself", () => {
    const result = applyDeltas(
      world(),
      [{ op: "polity_stance_shift", polityId: "rome", towardPolityId: "rome", trustDelta: 10, reason: "Nonsense." }],
      context(),
    );
    expect(result.rejected).toHaveLength(1);
  });
});
