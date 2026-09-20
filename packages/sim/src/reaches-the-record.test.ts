import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type Office, type ScenarioClock, type WorldState } from "@chronica/shared";
import { runSimulationBurst, type BurstInput } from "./burst";
import { composeChronicle } from "./chronicle";
import type { SimModelPort, SimOperation } from "./ports";

/**
 * Two slices that were built, unit-tested, and never once fired in play.
 *
 * Slice 6 wants somebody to act outside their authority and somebody else to
 * come across it. Slice 8 wants a battle. Neither had happened live after a
 * whole match, and for the same reason both times: the world was at peace with
 * everybody, and the machinery is gated on world conditions that had simply
 * never arisen. "It passes its unit tests" is not the same claim as "it works",
 * and saying the second on the strength of the first is how a pipeline rots
 * between two green suites.
 *
 * So this puts the conditions there deliberately and drives the whole pipeline
 * -- burst, apply, tick, Chronicle -- with a scripted model, which is how every
 * other burst test proves what it proves. What it cannot prove is that a live
 * model chooses to do these things; that is what the `war` archetype and the
 * Messana chain are for.
 */

const definition = ScenarioDefinitionSchema.parse(firstPunicWarScenario.definition);
const offices: readonly Office[] = definition.government.offices;
const clock: ScenarioClock = definition.clock;
const warfare = definition.warfare;
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));

function capturingPort(script: Partial<Record<SimOperation, string[]>>): SimModelPort & { shown: Partial<Record<SimOperation, string[]>> } {
  const remaining: Partial<Record<SimOperation, string[]>> = structuredClone(script);
  const shown: Partial<Record<SimOperation, string[]>> = {};
  return {
    shown,
    complete(operation, _system, user) {
      (shown[operation] ??= []).push(user);
      const next = remaining[operation]?.shift();
      if (next === undefined) return Promise.reject(new Error(`the script has no further "${operation}" response`));
      return Promise.resolve(next);
    },
  };
}

function input(port: SimModelPort, overrides: Partial<BurstInput> = {}): BurstInput {
  return {
    world: world(), clock, offices, warfare, burstId: "b1", gameId: "game-record",
    actorRef: { kind: "character", id: "marcus-atilius" }, actorPolityId: "rome",
    orderText: "Bring them to battle.", knownFacts: [], queue: [], port,
    // Nothing else may stir: this is about one thing reaching the record.
    narratorSeeds: [],
    ...overrides,
  };
}

const NOBODY = JSON.stringify({ actors: [] });

// ── Slice 8: a battle, and what the record says about it ────────────────────

/** Both armies in one province, which is the whole precondition for a fight. */
function armiesFacing(): WorldState {
  const base = world();
  const where = base.material.forces.find((force) => force.id === "legio-i")!.locationId;
  return {
    ...base,
    material: {
      ...base.material,
      forces: base.material.forces.map((force) => (force.id === "carthaginian-army" ? { ...force, locationId: where } : force)),
    },
  };
}

const GIVE_BATTLE = JSON.stringify({
  intent: { summary: "Bring the Carthaginian army to battle.", domains: ["military"] },
  narrativeSummary: "The consul forms his line at first light and offers battle.",
  frictions: [],
  deltas: [{
    op: "force_engage", forceRef: "legio-i", targetForceRef: "carthaginian-army", posture: "offer_battle",
    tactic: { factor: "surprise", magnitude: "meaningful", rationale: "Cross the stream before dawn." },
    reason: "The consul means to settle Sicily in one day.",
  }],
  facts: [{
    localId: "battle-offered", kind: "battle", summary: "The Roman and Carthaginian armies met in the north-east of Sicily.",
    affectedRefs: [{ kind: "polity", id: "rome" }, { kind: "polity", id: "carthage" }],
    visibility: "public", discoveryState: "public", knowableInDays: 0, significance: 85,
  }],
  delegations: [], schedule: [], cognitionCandidates: [], outcome: "chronicle", playerDecision: null,
});

describe("a battle reaches the record as a battle", () => {
  const run = async () => {
    const port = capturingPort({ simulate_orchestrate: [GIVE_BATTLE], simulate_cognition: [NOBODY, NOBODY, NOBODY, NOBODY, NOBODY, NOBODY] });
    const result = await runSimulationBurst(input(port, { world: armiesFacing() }));
    return { port, result };
  };

  it("fights it, and carries the fight out of the resolver instead of one line about the outcome", async () => {
    const { result } = await run();
    expect(result.battleAccounts.length).toBeGreaterThan(0);
    const account = result.battleAccounts[0]!;
    // The resolver computed all of this and it used to be thrown away.
    expect(account.phases.length).toBeGreaterThan(0);
    expect(account.losses.length).toBeGreaterThan(0);
    expect(account.sides.length).toBe(2);
    // `commanders` lists only those whose fate changed, so an empty one here
    // means both came through, which is a thing that happens.
    expect(Array.isArray(account.commanders)).toBe(true);
    expect(account.factIds.length).toBeGreaterThan(0);
    // And men actually died: the world changed, not just the narrative.
    const after = result.world.material.forces.find((force) => force.id === "legio-i")!;
    const before = armiesFacing().material.forces.find((force) => force.id === "legio-i")!;
    const men = (force: typeof after): number => force.personnel.reduce((sum, category) => sum + category.fit, 0);
    expect(men(after)).toBeLessThan(men(before));
  });

  it("puts the fight in front of the chronicler, with the register that says how to write it", async () => {
    const { result } = await run();
    const historian = capturingPort({ compose_chronicle: [JSON.stringify({ entries: [] })] });
    await composeChronicle({
      port: historian, clock, observer: { kind: "character", id: "marcus-atilius" }, observerPolityId: "rome",
      facts: result.newFacts, from: { day: 0, minute: 0 }, to: result.world.instant,
      narrative: result.narrative, frictions: result.frictions, battleAccounts: result.battleAccounts,
      significanceByFactId: result.significanceByFactId, storylines: result.world.storylines,
    });
    const shown = historian.shown.compose_chronicle![0]!;
    expect(shown).toContain("This thread holds a battle");
    expect(shown).toContain("three hundred and fifty to six");
    // Phase by phase, both commanders, and the men lost -- so the entry has
    // somewhere to get its 350 to 600 words from that is not more ways of
    // saying who won.
    expect(shown).toContain("How it went, in order:");
    expect(shown).toMatch(/contact|engagement|cohesion|withdrawal|aftermath/);
    expect(shown).toContain("What it cost:");
    expect(shown).toMatch(/\d+ dead/);
  });
});

// ── Slice 6: somebody acts beyond their place, and somebody notices ─────────

const SPEND_WITHOUT_LEAVE = JSON.stringify({
  intent: { summary: "Pay for the fleet.", domains: ["finance"] },
  narrativeSummary: "Money leaves the treasury for the shipwrights.",
  frictions: [],
  deltas: [{
    op: "money_transfer", fromAccountRef: "marcus-purse", toAccountRef: "quintus-purse", amount: 120,
    reason: "The shipwrights will not begin without it.",
  }],
  facts: [{
    localId: "paid", kind: "expenditure", summary: "A sum left the consul's chest for the shipyards.",
    affectedRefs: [{ kind: "polity", id: "rome" }], visibility: "public", discoveryState: "public",
    knowableInDays: 0, significance: 40,
  }],
  delegations: [], schedule: [], cognitionCandidates: [], outcome: "chronicle", playerDecision: null,
});

describe("acting beyond your place is something a person finds out", () => {
  it("records the breach in words a chronicler could use, and hands it to somebody who would come across it", async () => {
    // Quintus Fabius holds no office over the treasury. Nothing stops him --
    // VISION §12 is explicit that the act is applied anyway -- but it is now
    // discoverable by a person rather than only by an audit line nobody reads.
    const port = capturingPort({ simulate_orchestrate: [SPEND_WITHOUT_LEAVE], simulate_cognition: [NOBODY, NOBODY, NOBODY, NOBODY, NOBODY, NOBODY] });
    const result = await runSimulationBurst(input(port, {
      actorRef: { kind: "character", id: "quintus-fabius" },
      orderText: "Pay the shipwrights out of the consul's chest.",
    }));

    expect(result.breaches.length).toBeGreaterThan(0);
    const breach = result.newFacts.find((fact) => fact.kind === "authority_breach");
    expect(breach).toBeDefined();
    if (breach === undefined) return;
    // In a clause somebody could say aloud, not "no active grant gives
    // character X propose power in the civil domain over polity Y".
    expect(breach.summary).not.toContain("active grant");
    expect(breach.summary).toContain("Quintus Fabius");
    // And it is the evidence, never the published event.
    expect(breach.visibility).toBe("private");

    // The whole point of the slice: somebody other than the man who did it
    // comes to know. Here it is the man whose chest it was, which is who
    // would notice -- and nobody noticing at all must stay possible elsewhere,
    // or nobody would ever try anything.
    const knowers = breach.discovery.discoveredBy.map((entry) => entry.observerRef.id);
    expect(knowers).toContain("quintus-fabius");
    expect(knowers).toContain("marcus-atilius");
  });
});
