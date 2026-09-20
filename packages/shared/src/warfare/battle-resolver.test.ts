import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import type { Force } from "../material-state";
import type { Character } from "../characters/character";
import { resolveBattle, summarizeBattleResult, type ResolveBattleParticipant } from "./battle-resolver";

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

  it("gives the defender a real bonus from a standing fortress in the battle's province (docs/32 corrective pass, requirement 5)", () => {
    const attacker = participant({
      side: "attacker",
      force: force({ id: "attacker-force", personnel: [{ categoryId: "infantry", label: "Legionaries", fit: 3_000, unavailable: [] }], moraleBps: 8_000, cohesionBps: 8_000, fatigueBps: 0 }),
    });
    const defender = participant({
      side: "defender",
      force: force({ id: "defender-force", personnel: [{ categoryId: "infantry", label: "Garrison", fit: 2_800, unavailable: [] }], moraleBps: 7_000, cohesionBps: 7_000, fatigueBps: 0 }),
    });
    const baseInput = { battle, participants: [attacker, defender], province: province(), provinceMaterial: null, adjacentProvinceIds: ["neighbor-a"] };

    const withoutFortress = resolveBattle(baseInput, "fortress-seed");
    const withFortress = resolveBattle({
      ...baseInput,
      structures: [{
        id: "fortress-1", kind: "fortress", name: "Border Fortress", provinceId: province().id, settlementId: null,
        ownerPolityId: defender.force.polityId, garrisonCapacity: 5_000, defensiveEffectsBps: 4_000, supplyRadius: 0, builtAtStep: 0, provenanceProjectId: null,
      }],
    }, "fortress-seed");

    const defenderCasualties = (result: typeof withoutFortress) =>
      result.casualties.filter((c) => c.forceId === "defender-force").reduce((sum, c) => sum + c.dead + c.deserted + c.wounded, 0);

    // Same seed, same everything else -- the only difference is the
    // fortress's defensive bonus, so the defender must fare no worse, and
    // strictly better in at least one measurable way (fewer casualties, or a
    // less severe outcome for them).
    expect(defenderCasualties(withFortress)).toBeLessThanOrEqual(defenderCasualties(withoutFortress));
    expect(withFortress).not.toEqual(withoutFortress);
  });

  it("gives no defensive bonus from a structure owned by the attacker's own polity", () => {
    const attacker = participant({ side: "attacker", force: force({ id: "attacker-force", polityId: "rome" }) });
    const defender = participant({ side: "defender", force: force({ id: "defender-force", polityId: "carthage" }) });
    const baseInput = { battle, participants: [attacker, defender], province: province(), provinceMaterial: null, adjacentProvinceIds: ["neighbor-a"] };

    const withoutStructures = resolveBattle(baseInput, "owner-seed");
    const withAttackerOwnedStructure = resolveBattle({
      ...baseInput,
      structures: [{
        id: "fortress-2", kind: "fortress", name: "Enemy-held Fort", provinceId: province().id, settlementId: null,
        ownerPolityId: attacker.force.polityId, garrisonCapacity: 5_000, defensiveEffectsBps: 4_000, supplyRadius: 0, builtAtStep: 0, provenanceProjectId: null,
      }],
    }, "owner-seed");

    expect(withAttackerOwnedStructure).toEqual(withoutStructures);
  });

  it("penalizes a defending garrison packed well past its structures' garrisonCapacity (docs/32 corrective pass, requirement 5)", () => {
    const attacker = participant({ side: "attacker", force: force({ id: "attacker-force" }) });
    const overcrowdedDefender = participant({
      side: "defender",
      force: force({ id: "defender-force", personnel: [{ categoryId: "infantry", label: "Garrison", fit: 10_000, unavailable: [] }] }),
    });
    const baseInput = { battle, participants: [attacker, overcrowdedDefender], province: province(), provinceMaterial: null, adjacentProvinceIds: ["neighbor-a"] };

    const withoutCapacityLimit = resolveBattle(baseInput, "garrison-seed");
    const withTightCapacity = resolveBattle({
      ...baseInput,
      structures: [{
        id: "watchtower-1", kind: "watchtower", name: "Small Watchtower", provinceId: province().id, settlementId: null,
        ownerPolityId: null, garrisonCapacity: 500, defensiveEffectsBps: 0, supplyRadius: 0, builtAtStep: 0, provenanceProjectId: null,
      }],
    }, "garrison-seed");

    expect(withTightCapacity).not.toEqual(withoutCapacityLimit);
    const defenderCasualties = (result: typeof withTightCapacity) =>
      result.casualties.filter((c) => c.forceId === "defender-force").reduce((sum, c) => sum + c.dead + c.deserted + c.wounded, 0);
    expect(defenderCasualties(withTightCapacity)).toBeGreaterThanOrEqual(defenderCasualties(withoutCapacityLimit));
  });

  it("relieves a force's supply shortage penalty when a depot in range reaches it (docs/32 corrective pass, requirement 5)", () => {
    const attacker = participant({ side: "attacker", force: force({ id: "attacker-force" }) });
    const shortageDefender = participant({ side: "defender", force: force({ id: "defender-force", provisionStatus: "critical" }) });
    const baseInput = { battle, participants: [attacker, shortageDefender], province: province(), provinceMaterial: null, adjacentProvinceIds: ["neighbor-a"] };

    const withoutDepot = resolveBattle(baseInput, "supply-seed");
    const withDepotHere = resolveBattle({
      ...baseInput,
      structures: [{
        id: "depot-1", kind: "depot", name: "Forward Depot", provinceId: province().id, settlementId: null,
        ownerPolityId: shortageDefender.force.polityId, garrisonCapacity: 0, defensiveEffectsBps: 0, supplyRadius: 1, builtAtStep: 0, provenanceProjectId: null,
      }],
    }, "supply-seed");

    expect(withDepotHere).not.toEqual(withoutDepot);
    const defenderCasualties = (result: typeof withDepotHere) =>
      result.casualties.filter((c) => c.forceId === "defender-force").reduce((sum, c) => sum + c.dead + c.deserted + c.wounded, 0);
    expect(defenderCasualties(withDepotHere)).toBeLessThanOrEqual(defenderCasualties(withoutDepot));
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
      expect(result.rejectedTactics).toHaveLength(1);
      expect(result.rejectedTactics[0]!.actorId).toBe("marcus-atilius");
      expect(result.rejectedTactics[0]!.reason).toContain("Precondition unmet");
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
      expect(result.rejectedTactics).toHaveLength(1);
      expect(result.rejectedTactics[0]!.actorId).toBe("some-uninvolved-character");
      expect(result.rejectedTactics[0]!.reason).toContain("not a participant");
    });
  });
});

describe("what the record says about who won", () => {
  it("names the army that held the field, not the role it happened to hold", () => {
    // A Chronicle once announced that the Boii host prevailed in a battle it
    // lost two to one, broke, and had its chief taken prisoner. The engine was
    // right and the sentence was the problem: "the defender prevails" never
    // said which army the defender was, so the historian guessed.
    const summary = summarizeBattleResult(
      {
        battleId: "b1",
        participantIds: ["boii-host", "roman-army"],
        attackerForceIds: ["boii-host"],
        outcome: "defender_victory",
        phases: [{ phase: "contact", attackerEffectiveStrength: 10, defenderEffectiveStrength: 10, summary: "They meet." }],
        acceptedTactics: [],
        rejectedTactics: [],
        draws: [],
        casualties: [
          { forceId: "boii-host", categoryId: "infantry", dead: 1_217, wounded: 0, deserted: 0, recoveryEligibleAtStep: 0 },
          { forceId: "roman-army", categoryId: "infantry", dead: 560, wounded: 0, deserted: 0, recoveryEligibleAtStep: 0 },
        ],
        captures: [],
        forceChanges: [],
        commanderChanges: [],
        retreats: [{ forceId: "boii-host", toProvinceId: null, orderly: false }],
        siegeAndControlChanges: [],
        facts: [],
      },
      new Map([["boii-host", "Boii Host"], ["roman-army", "Roman field army"]]),
      "Boii",
    );

    expect(summary).toContain("Roman field army holds the field");
    expect(summary).toContain("Boii Host is beaten");
    expect(summary).not.toContain("The defender prevails");
    // And the army that broke is the one that lost, in the same sentence order.
    expect(summary.indexOf("Roman field army holds")).toBeLessThan(summary.indexOf("Boii Host breaks and flees"));
  });
});
