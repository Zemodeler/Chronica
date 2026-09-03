import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { Force } from "../material-state";
import type { Character } from "../characters/character";
import { resolveBattle, type ResolveBattleParticipant } from "./battle-resolver";

const world = () => structuredClone(firstPunicWarScenario.initialWorld);
const province = () => world().map.provinces.find((p) => p.id === "ita-72843720b81376294924159-sicily-northeast")!;

function force(overrides: Partial<Force>): Force {
  const base = world().material.forces.find((f) => f.id === "legio-i")!;
  return { ...base, ...overrides };
}

function character(overrides: Partial<Character>): Character {
  const base = world().characters.find((c) => c.id === "marcus-atilius")!;
  return { ...base, ...overrides };
}

function participant(overrides: Partial<ResolveBattleParticipant> & Pick<ResolveBattleParticipant, "side">): ResolveBattleParticipant {
  const f = overrides.force ?? force({});
  return {
    forceId: f.id,
    force: f,
    commander: overrides.commander !== undefined ? overrides.commander : character({}),
    ...overrides,
  };
}

const battle = {
  battleId: "test-battle",
  provinceId: "ita-72843720b81376294924159-sicily-northeast",
  startedAtStep: 10,
  participants: [
    { forceId: "attacker-force", side: "attacker" as const, arrivesAtPhase: "contact" as const },
    { forceId: "defender-force", side: "defender" as const, arrivesAtPhase: "contact" as const },
  ],
};

describe("resolveBattle", () => {
  it("gives victory to the decisively stronger side", () => {
    const strongAttacker = participant({
      side: "attacker",
      force: force({ id: "attacker-force", personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 10_000, unavailable: [] }], moraleBps: 9_000, cohesionBps: 9_000, fatigueBps: 0 }),
    });
    const weakDefender = participant({
      side: "defender",
      force: force({ id: "defender-force", personnel: [{ categoryId: "infantry", label: "Levies", fit: 500, unavailable: [] }], moraleBps: 4_000, cohesionBps: 4_000, fatigueBps: 3_000 }),
      commander: null,
    });

    const result = resolveBattle({
      battle,
      participants: [strongAttacker, weakDefender],
      province: province(),
      provinceMaterial: null,
      adjacentProvinceIds: ["neighbor-a", "neighbor-b"],
    }, "seed-1");

    expect(result.outcome).toBe("attacker_victory");
    expect(result.casualties.length).toBeGreaterThan(0);
    expect(result.retreats.some((r) => r.forceId === "defender-force")).toBe(true);
    expect(result.phases.map((p) => p.phase)).toEqual(["contact", "engagement", "cohesion", "withdrawal", "aftermath"]);
    // A decisive victory must actually be reachable: the casualty-rate
    // formula caps below 0.20, so the "heavy losses" threshold that gates
    // siegeAndControlChanges has to sit below that cap, not above it.
    expect(result.siegeAndControlChanges.length).toBeGreaterThan(0);
  });

  it("is fully deterministic for the same seed and inputs", () => {
    const input = {
      battle,
      participants: [
        participant({ side: "attacker", force: force({ id: "attacker-force" }) }),
        participant({ side: "defender", force: force({ id: "defender-force" }) }),
      ],
      province: province(),
      provinceMaterial: null,
      adjacentProvinceIds: ["neighbor-a"],
    };
    const first = resolveBattle(input, "same-seed");
    const second = resolveBattle(input, "same-seed");
    expect(second).toEqual(first);
  });

  it("produces a different draw sequence for a different seed", () => {
    const input = {
      battle,
      participants: [
        participant({ side: "attacker", force: force({ id: "attacker-force" }) }),
        participant({ side: "defender", force: force({ id: "defender-force" }) }),
      ],
      province: province(),
      provinceMaterial: null,
      adjacentProvinceIds: ["neighbor-a"],
    };
    const a = resolveBattle(input, "seed-a");
    const b = resolveBattle(input, "seed-b");
    expect(a.draws).not.toEqual(b.draws);
  });

  it("never lets a losing side's casualties exceed its own headcount", () => {
    const result = resolveBattle({
      battle,
      participants: [
        participant({ side: "attacker", force: force({ id: "attacker-force", personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 4_000, unavailable: [] }] }) }),
        participant({ side: "defender", force: force({ id: "defender-force", personnel: [{ categoryId: "infantry", label: "Levies", fit: 50, unavailable: [] }] }) }),
      ],
      province: province(),
      provinceMaterial: null,
      adjacentProvinceIds: [],
    }, "seed-headcount");

    const defenderCasualties = result.casualties.filter((c) => c.forceId === "defender-force");
    const totalDefenderCasualties = defenderCasualties.reduce((sum, c) => sum + c.dead + c.deserted + c.wounded, 0);
    expect(totalDefenderCasualties).toBeLessThanOrEqual(50);
  });

  it("weakens a side ordered to avoid battle, and names it in the contact summary", () => {
    const evenForce = force({ moraleBps: 9_000, cohesionBps: 9_000, fatigueBps: 0 });
    const withoutPosture = resolveBattle({
      battle,
      participants: [
        participant({ side: "attacker", force: { ...evenForce, id: "attacker-force" } }),
        participant({ side: "defender", force: { ...evenForce, id: "defender-force" } }),
      ],
      province: province(),
      provinceMaterial: null,
      adjacentProvinceIds: [],
    }, "seed-posture");
    const withAvoidance = resolveBattle({
      battle,
      participants: [
        participant({ side: "attacker", force: { ...evenForce, id: "attacker-force" }, posture: "avoid_battle" }),
        participant({ side: "defender", force: { ...evenForce, id: "defender-force" } }),
      ],
      province: province(),
      provinceMaterial: null,
      adjacentProvinceIds: [],
    }, "seed-posture");

    expect(withAvoidance.phases[0]!.attackerEffectiveStrength).toBeLessThan(withoutPosture.phases[0]!.attackerEffectiveStrength);
    expect(withAvoidance.phases[0]!.summary).toContain("despite orders to avoid");
  });

  it("gives a defending side ordered to hold a real advantage over the same fight without that order", () => {
    const evenForce = force({ moraleBps: 9_000, cohesionBps: 9_000, fatigueBps: 0 });
    const buildInput = (defenderPosture?: "hold") => ({
      battle,
      participants: [
        participant({ side: "attacker" as const, force: { ...evenForce, id: "attacker-force" } }),
        participant({ side: "defender" as const, force: { ...evenForce, id: "defender-force" }, ...(defenderPosture ? { posture: defenderPosture } : {}) }),
      ],
      province: province(),
      provinceMaterial: null,
      adjacentProvinceIds: [],
    });
    const withoutHold = resolveBattle(buildInput(), "seed-hold");
    const withHold = resolveBattle(buildInput("hold"), "seed-hold");

    expect(withHold.phases[0]!.defenderEffectiveStrength).toBeGreaterThan(withoutHold.phases[0]!.defenderEffectiveStrength);
  });

  it("leaves an evenly matched, high-morale fight without a retreat or decisive outcome", () => {
    const evenForce = force({ moraleBps: 9_000, cohesionBps: 9_000, fatigueBps: 0 });
    const result = resolveBattle({
      battle,
      participants: [
        participant({ side: "attacker", force: { ...evenForce, id: "attacker-force" } }),
        participant({ side: "defender", force: { ...evenForce, id: "defender-force" } }),
      ],
      province: province(),
      provinceMaterial: null,
      adjacentProvinceIds: [],
    }, "seed-even");

    expect(result.retreats).toEqual([]);
  });

  describe("tactical modifier proposals", () => {
    const evenForce = force({ moraleBps: 9_000, cohesionBps: 9_000, fatigueBps: 0 });
    const buildInput = (tacticalProposals?: Parameters<typeof resolveBattle>[0]["tacticalProposals"]) => ({
      battle,
      participants: [
        participant({ side: "attacker" as const, force: { ...evenForce, id: "attacker-force" } }),
        participant({ side: "defender" as const, force: { ...evenForce, id: "defender-force" } }),
      ],
      province: province(),
      provinceMaterial: null,
      adjacentProvinceIds: [],
      tacticalProposals,
    });

    it("accepts a proposal whose preconditions name a real participant, and strengthens the proposing side", () => {
      const proposal = {
        battleId: "test-battle",
        actorId: "marcus-atilius", // the attacker's commander, per `character()`.
        factor: "effective_strength" as const,
        magnitude: "meaningful" as const,
        phases: ["contact" as const],
        preconditions: [{ label: "attacker still holds the field", subjectId: "attacker-force" }],
        costs: [],
        rationale: "A feigned withdrawal draws the defender out of position.",
      };
      const without = resolveBattle(buildInput(), "seed-tactic");
      const withTactic = resolveBattle(buildInput([proposal]), "seed-tactic");

      expect(withTactic.acceptedTactics).toEqual([proposal]);
      expect(withTactic.rejectedTactics).toEqual([]);
      expect(withTactic.phases[0]!.attackerEffectiveStrength).toBeGreaterThan(without.phases[0]!.attackerEffectiveStrength);
    });

    it("rejects a proposal naming a subject not in this battle", () => {
      const proposal = {
        battleId: "test-battle",
        actorId: "marcus-atilius",
        factor: "morale" as const,
        magnitude: "minor" as const,
        phases: ["contact" as const],
        preconditions: [{ label: "an ally force nearby", subjectId: "nonexistent-force" }],
        costs: [],
        rationale: "Rally the flanking cohort.",
      };
      const result = resolveBattle(buildInput([proposal]), "seed-tactic-reject");
      expect(result.acceptedTactics).toEqual([]);
      expect(result.rejectedTactics).toEqual([{ actorId: "marcus-atilius", reason: expect.stringContaining("Precondition unmet") }]);
    });

    it("rejects a proposal from an actor who isn't a participant in this battle", () => {
      const proposal = {
        battleId: "test-battle",
        actorId: "some-uninvolved-character",
        factor: "surprise" as const,
        magnitude: "minor" as const,
        phases: ["contact" as const],
        preconditions: [{ label: "unrelated", subjectId: null }],
        costs: [],
        rationale: "An outsider tries to intervene.",
      };
      const result = resolveBattle(buildInput([proposal]), "seed-tactic-outsider");
      expect(result.acceptedTactics).toEqual([]);
      expect(result.rejectedTactics).toEqual([{ actorId: "some-uninvolved-character", reason: expect.stringContaining("not a participant") }]);
    });
  });
});
