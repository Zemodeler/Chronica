import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldStateSchema, type Office, type ScenarioClock, type ScenarioLifeRules, type WorldState } from "@chronica/shared";
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
    // Passages are written in the order the reader could know of them, not
    // battle first, so the call that holds the fight is found, not assumed.
    const shown = historian.shown.compose_chronicle!.find((message) => message.includes("This thread holds a battle"))!;
    expect(shown).toBeDefined();
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

// A letter in Rome's name needs nobody's obedience to be written -- which is
// exactly why writing it without the right is a breach and not a refusal.
// (Proclaiming himself consul used to be the example; a seat is now taken only
// by whoever may fill it, or with men at the capital.)
const WRITE_WITHOUT_LEAVE = JSON.stringify({
  intent: { summary: "Treat with Carthage.", domains: ["diplomacy"] },
  narrativeSummary: "Fabius writes to Carthage over Rome's name.",
  frictions: [],
  deltas: [{
    op: "diplomatic_message_send", localId: "fabius_letter", kind: "peace_offer", fromPolityId: "rome", fromCharacterRef: "quintus-fabius",
    toPolityId: "carthage", subject: "Terms for the strait", terms: "Rome will not contest Messana if Carthage keeps to Africa.",
    reason: "Fabius treats with Carthage on his own account.",
  }],
  facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "chronicle", playerDecision: null,
});

describe("acting beyond your place is something a person finds out", () => {
  it("records the breach in words a chronicler could use, and hands it to somebody who would come across it", async () => {
    // Quintus Fabius has no right to speak for Rome. A letter of his own is his
    // own business; offering terms in Rome's name is not. It needs nobody's
    // obedience to happen, so it happens -- and it is discoverable by a person
    // rather than only by an audit line nobody reads.
    const port = capturingPort({ simulate_orchestrate: [WRITE_WITHOUT_LEAVE], simulate_cognition: [NOBODY, NOBODY, NOBODY, NOBODY, NOBODY, NOBODY] });
    const result = await runSimulationBurst(input(port, {
      actorRef: { kind: "character", id: "quintus-fabius" },
      orderText: "Write to Carthage in Rome's name.",
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

    // Somebody other than the man who did it comes to know -- and nobody
    // noticing at all must stay possible elsewhere, or nobody would ever try
    // anything.
    const knowers = breach.discovery.discoveredBy.map((entry) => entry.observerRef.id);
    expect(knowers).toContain("quintus-fabius");
    expect(knowers.length).toBeGreaterThan(1);
  });

  it("does not open another man's strongbox, and everybody hears that it did not", async () => {
    // The other kind of overreach. Money answers to whoever keeps it, so an
    // order to pay out of the consul's chest is not a breach that succeeds --
    // it is an order nobody carries out, and a small public embarrassment.
    const port = capturingPort({ simulate_orchestrate: [SPEND_WITHOUT_LEAVE], simulate_cognition: [NOBODY, NOBODY, NOBODY, NOBODY, NOBODY, NOBODY] });
    const result = await runSimulationBurst(input(port, {
      actorRef: { kind: "character", id: "quintus-fabius" },
      orderText: "Pay the shipwrights out of the consul's chest.",
    }));

    expect(result.world.material.transactions.some((transaction) =>
      transaction.sourceAccountId === "marcus-purse" && transaction.destinationAccountId === "quintus-purse")).toBe(false);
    const ignored = result.newFacts.find((fact) => fact.kind === "order_ignored")!;
    expect(ignored.visibility).toBe("public");
    expect(ignored.summary).toContain("Quintus Fabius");
  });
});

// ── Slice 9: illness impairs, and death asks who follows ────────────────────

/**
 * A scenario whose old men are very likely to die, so the plumbing is what is
 * under test rather than the dice. The peril rule still applies in full: a
 * roll cannot kill anybody who matters until a thread has been open on them
 * for forty-five days and reached crisis, so this still needs several bursts.
 * The real rates, and the rule itself, are tested in `mortality.test.ts`.
 */
const life: ScenarioLifeRules = {
  lifeStages: [
    { id: "adult", label: "adulthood", minAgeYears: 0, maxAgeYears: 64, mortalityRatePerYearBps: 100, incapacityRatePerYearBps: 50, recoveryRatePerYearBps: 4_000 },
    { id: "great-age", label: "great age", minAgeYears: 65, maxAgeYears: null, mortalityRatePerYearBps: 9_000, incapacityRatePerYearBps: 500, recoveryRatePerYearBps: 500 },
  ],
  inheritanceRules: definition.life.inheritanceRules,
  reviewIntervalSteps: 30,
};

const BURY_HIM = JSON.stringify({
  intent: { summary: "Carry on.", domains: ["military"] },
  narrativeSummary: "The camp goes about its business.",
  frictions: [], deltas: [],
  facts: [{
    localId: "carry-on", kind: "routine", summary: "The legion holds its ground.",
    affectedRefs: [{ kind: "polity", id: "rome" }], visibility: "public", discoveryState: "public",
    knowableInDays: 0, significance: 20,
  }],
  delegations: [], schedule: [], cognitionCandidates: [], outcome: "chronicle", playerDecision: null,
});

describe("what a battle does to the man commanding it", () => {
  it("takes a captured or wounded commander out of circulation, which the resolver computed and nothing read", async () => {
    const port = capturingPort({ simulate_orchestrate: [GIVE_BATTLE], simulate_cognition: Array.from({ length: 6 }, () => NOBODY) });
    const result = await runSimulationBurst(input(port, { world: armiesFacing() }));
    const account = result.battleAccounts[0]!;
    for (const commander of account.commanders) {
      if (commander.outcome === "unharmed") continue;
      const person = result.world.characters.find((character) => character.name === commander.name);
      if (person === undefined) continue;
      if (commander.outcome === "killed") {
        expect(person.alive).toBe(false);
        // Through the same door as every other death: no army left under a
        // dead man, because `commanderCharacterId` cannot be null.
        for (const force of result.world.material.forces) {
          const holder = result.world.characters.find((candidate) => candidate.id === force.commanderCharacterId);
          if (holder !== undefined) expect(holder.alive).toBe(true);
        }
      } else {
        expect(person.disqualifyingStatuses.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("illness impairs and never blocks", () => {
  it("gives a player at the end of his strength a full burst, and applies what he ordered", async () => {
    // The order box always works. A player who cannot act is a player with
    // nothing to do about the thing that is happening to him, which is the one
    // dead end this branch forbids outright.
    const failing = world();
    const sick: WorldState = {
      ...failing,
      characters: failing.characters.map((character) => (character.id === "marcus-atilius"
        ? { ...character, healthBps: 1_500, disqualifyingStatuses: ["incapacitated"] }
        : character)),
    };
    const port = capturingPort({
      simulate_orchestrate: [SPEND_WITHOUT_LEAVE],
      simulate_cognition: [NOBODY, NOBODY, NOBODY, NOBODY, NOBODY, NOBODY],
    });
    const result = await runSimulationBurst(input(port, { world: sick, life, orderText: "Pay the shipwrights." }));

    expect(result.parseFailures).toEqual([]);
    // His money moved. Being ill is not being vetoed.
    const purse = result.world.material.accounts.find((account) => account.id === "marcus-purse")!;
    expect(purse.balance).toBeLessThan(failing.material.accounts.find((account) => account.id === "marcus-purse")!.balance);
  });
});

describe("the player dies, and the world asks whose eyes you see through now", () => {
  it("pre-empts whatever else was being asked, and always names somebody", async () => {
    const old = world();
    const dying: WorldState = {
      ...old,
      // Ninety, commanding in the field, at the end of his health: as exposed
      // as this engine gets. Reviewed every interval across a long burst.
      characters: old.characters.map((character) => (character.id === "marcus-atilius"
        ? { ...character, ageYearsAtStart: 92, birthStep: null, healthBps: 600 }
        : character)),
    };

    // Several bursts, because a peril must stand 45 days before it can take
    // anybody -- which is the point, and what this asserts by needing them.
    let state = dying;
    let decision: { prompt: string; options: readonly { id: string }[] } | null = null;
    for (let burst = 0; burst < 8 && decision === null; burst += 1) {
      const port = capturingPort({
        simulate_orchestrate: [BURY_HIM],
        simulate_cognition: Array.from({ length: 8 }, () => NOBODY),
      });
      const result = await runSimulationBurst(input(port, {
        world: state, life, burstId: `b${burst}`, orderText: "Carry on.",
        // A season a burst, so eight of them are two years -- long enough for
        // a peril to open, worsen into crisis, and stand its forty-five days.
        clock: { ...clock, minSpanDays: 90 },
      }));
      state = result.world;
      decision = result.playerDecision;
      if (!state.characters.find((character) => character.id === "marcus-atilius")!.alive) break;
    }

    // He dies, and the burst he dies in is the burst that asks.
    expect(state.characters.find((character) => character.id === "marcus-atilius")!.alive).toBe(false);
    expect(decision).not.toBeNull();
    expect(decision!.prompt).toContain("Marcus Atilius");
    expect(decision!.options.length).toBeGreaterThanOrEqual(1);
    for (const option of decision!.options) expect(option.id.startsWith("succeed-")).toBe(true);
  });
});
