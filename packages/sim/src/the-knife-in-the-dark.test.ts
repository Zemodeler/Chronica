import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import {
  INJURIES,
  PLOT_MAX_DAYS,
  PLOT_MAX_ODDS_BPS,
  PLOT_MIN_DAYS,
  PLOT_MIN_ODDS_BPS,
  ScenarioDefinitionSchema,
  WorldDeltaSchema,
  WorldStateSchema,
  injuryStatusId,
  stableHash,
  type Character,
  type CovertPlotOutcome,
  type WorldDelta,
  type WorldState,
} from "@chronica/shared";
import { createIdFactory } from "./ports";
import { applyDeltas } from "./apply/apply-deltas";
import { atTheirPeak, ladderOutcome, plotOdds } from "./plots";
import { runDeterministicTick } from "./tick";
import type { ApplyContext } from "./apply/context";

/**
 * "Hire an experienced assassin to kill Fabius, and never let my name be said."
 *
 * The oldest order in this genre, and for the whole life of this engine it did
 * nothing. Death ran through one door -- a peril off the age table -- so no
 * order a player could write ever killed anybody, and the nearest thing the
 * vocabulary could say was health to nothing plus a tag reading `"dead"`. That
 * was accepted, and produced a man at no health, marked dead, and *alive*,
 * still commanding his army.
 *
 * What is held here is the whole of the bargain: the order may always be
 * given, the engine alone decides whether it worked, it takes real time and
 * leaves a record while it takes it, and the player's own death is reserved for
 * the one shape that was asked for by name.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));

const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("knife"),
  gameId: "game-1",
});

/** The order as a player would give it: money, a hand, and a story for afterwards. */
const THE_ORDER: WorldDelta = {
  op: "covert_plot_open",
  localId: "the_knife",
  kind: "assassination",
  targetCharacterRef: "hanno-carthage",
  sponsorCharacterRef: "gaius-genucius",
  agentCharacterRef: null,
  fundingAccountRef: "rome-treasury",
  spend: 1_200,
  cover: "The Carthaginians did this to their own man.",
  expectedInDays: 60,
  reason: "The consul pays a man, and does not ask his name.",
};

function lay(delta: unknown = THE_ORDER, state: WorldState = world()) {
  const parsed = WorldDeltaSchema.safeParse(delta);
  if (!parsed.success) {
    return { unsayable: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`), refusals: [] as string[], world: state };
  }
  const result = applyDeltas(state, [parsed.data], context());
  return { unsayable: [] as string[], refusals: result.rejected.map((rejection) => rejection.reason), world: result.world };
}

/** Runs the world forward to a day, the way a burst does. */
function forwardTo(state: WorldState, day: number, playerCharacterId: string | null = null) {
  return runDeterministicTick({
    world: state,
    warfare: definition.warfare,
    life: definition.life,
    playerCharacterId,
    toDay: day,
    ids: createIdFactory(`tick-${day}`),
  });
}

describe("the order is always allowed to be given", () => {
  it("is laid, and costs what was paid for it", () => {
    const result = lay();

    expect(result.unsayable).toEqual([]);
    expect(result.refusals).toEqual([]);
    const plot = result.world.covertPlots.at(-1)!;
    expect(plot.targetCharacterId).toBe("hanno-carthage");
    expect(plot.outcome).toBeNull();
    // The money actually left the treasury. A plot paid for out of nothing is
    // a plot nobody was paid for.
    const treasury = result.world.material.accounts.find((account) => account.id === "rome-treasury")!;
    const before = world().material.accounts.find((account) => account.id === "rome-treasury")!;
    expect(treasury.balance).toBe(before.balance - 1_200);
  });

  it("opens a thread, so this is several chronicles and not one line", () => {
    const result = lay();
    const thread = result.world.storylines.at(-1)!;

    expect(thread.title).toContain("Hanno");
    // The world's own bookkeeping of a secret: its participants see it because
    // they are in it, and nobody else does.
    expect(thread.visibility).toBe("private");
    expect(thread.participantIds).toContain("gaius-genucius");
    expect(thread.participantIds).not.toContain("hanno-carthage");
  });

  it("refuses only the things that are genuinely not orders", () => {
    // A man plotting against himself, and a second plot from the same quarter
    // against the same man -- which would otherwise let ten in one answer turn
    // a one-in-eight chance into a certainty.
    const himself = lay({ ...THE_ORDER, targetCharacterRef: "gaius-genucius" });
    expect(himself.refusals).toHaveLength(1);

    const once = lay();
    const twice = lay({ ...THE_ORDER, localId: "the_second_knife" }, once.world);
    expect(twice.refusals[0]).toContain("already laid");
  });
});

describe("the odds are the engine's, and nobody else may touch them", () => {
  it("has no field for the chance or the outcome", () => {
    // The player writes "25/75" and "1% chance" in his orders. That is how he
    // rates it; it is not a setting, and there must be nowhere to put it.
    const withOdds = WorldDeltaSchema.safeParse({ ...THE_ORDER, successOddsBps: 7_500 });
    const withOutcome = WorldDeltaSchema.safeParse({ ...THE_ORDER, outcome: "killed" });
    expect(withOdds.success).toBe(false);
    expect(withOutcome.success).toBe(false);
  });

  it("is never certain and never impossible, whatever is spent", () => {
    const state = world();
    const target = state.characters.find((character) => character.id === "hanno-carthage")!;
    const sponsor = state.characters.find((character) => character.id === "gaius-genucius")!;

    const nothingSpent = plotOdds(state, { kind: "assassination", target, sponsor, agent: null, spend: 0 });
    const everythingSpent = plotOdds(state, { kind: "assassination", target, sponsor, agent: null, spend: 10_000_000 });

    expect(nothingSpent.successOddsBps).toBeGreaterThanOrEqual(PLOT_MIN_ODDS_BPS);
    expect(everythingSpent.successOddsBps).toBeLessThanOrEqual(PLOT_MAX_ODDS_BPS);
    // Money helps, and it does not buy certainty: the whole treasury of the
    // world leaves this well short of a sure thing.
    expect(everythingSpent.successOddsBps).toBeGreaterThan(nothingSpent.successOddsBps);
    expect(everythingSpent.successOddsBps).toBeLessThan(7_000);
  });

  it("makes a guarded man harder to reach than an exposed one", () => {
    const state = world();
    const sponsor = state.characters.find((character) => character.id === "gaius-genucius")!;
    const target = state.characters.find((character) => character.id === "hanno-carthage")!;

    const eminent: Character = { ...target, prestigeBps: 9_500, skills: { ...target.skills, intrigue: 80 } };
    const obscure: Character = { ...target, prestigeBps: 1_000, skills: { ...target.skills, intrigue: 20 } };

    expect(plotOdds(state, { kind: "assassination", target: eminent, sponsor, agent: null, spend: 500 }).successOddsBps)
      .toBeLessThan(plotOdds(state, { kind: "assassination", target: obscure, sponsor, agent: null, spend: 500 }).successOddsBps);
  });

  it("makes a warned man a harder one", () => {
    const state = world();
    const sponsor = state.characters.find((character) => character.id === "gaius-genucius")!;
    const target = state.characters.find((character) => character.id === "hanno-carthage")!;
    const plain = plotOdds(state, { kind: "assassination", target, sponsor, agent: null, spend: 500 });

    const forewarned: WorldState = {
      ...state,
      characterPressures: [...state.characterPressures, {
        id: "warned", characterId: target.id, kind: "threat" as const, intensity: 70,
        label: "Somebody is moving against him", sourceEventId: null, createdAtStep: 0,
        reviewAtStep: 30, expiresAtStep: null, visibility: "polity" as const, status: "active" as const,
      }],
    };

    expect(plotOdds(forewarned, { kind: "assassination", target, sponsor, agent: null, spend: 500 }).successOddsBps)
      .toBeLessThan(plain.successOddsBps);
  });
});

describe("it takes time, and the world may notice while it does", () => {
  it("holds the world's own pacing inside the engine's bounds", () => {
    const hasty = lay({ ...THE_ORDER, expectedInDays: 1 }).world.covertPlots.at(-1)!;
    const endless = lay({ ...THE_ORDER, expectedInDays: 3_000 }).world.covertPlots.at(-1)!;

    expect(hasty.resolvesAtStep).toBe(PLOT_MIN_DAYS);
    expect(endless.resolvesAtStep).toBe(PLOT_MAX_DAYS);
  });

  it("stands open, and is not resolved before its day", () => {
    const laid = lay().world;
    const early = forwardTo(laid, 10);

    expect(early.world.covertPlots.at(-1)!.outcome).toBeNull();
    expect(early.world.characters.find((character) => character.id === "hanno-carthage")!.alive).toBe(true);
  });

  it("comes to a head on its day, and ends exactly once", () => {
    const laid = lay().world;
    const after = forwardTo(laid, 90);
    const plot = after.world.covertPlots.at(-1)!;

    expect(plot.outcome).not.toBeNull();
    expect(plot.resolvedAtStep).not.toBeNull();

    // Ticking on does not re-roll it. A plot that resolved twice would be two
    // attempts the player paid for once.
    const later = forwardTo(after.world, 200);
    expect(later.world.covertPlots.at(-1)!.resolvedAtStep).toBe(plot.resolvedAtStep);
  });

  it("puts something in the record on the way, not only at the end", () => {
    const laid = lay().world;
    // Halfway, which is where the plot stirs and may be got wind of.
    const midway = forwardTo(laid, 45);
    expect(midway.factProposals.length).toBeGreaterThan(0);
  });

  it("rolls the same way on a replay, however the burst lands its hops", () => {
    const laid = lay().world;
    const straight = forwardTo(laid, 90);
    const hopped = forwardTo(forwardTo(forwardTo(laid, 30).world, 61).world, 90);

    expect(hopped.world.covertPlots.at(-1)!.outcome).toBe(straight.world.covertPlots.at(-1)!.outcome);
  });
});

describe("the ladder, and the player's place on it", () => {
  /**
   * The ladder read straight, without a world in the way. Every value of the
   * roll, at odds that a real plot could actually have.
   */
  function acrossEveryRoll(input: { oddsBps: number; secrecyBps: number; spared: boolean; kind?: "assassination" | "sabotage" }) {
    const counts: Record<CovertPlotOutcome, number> = { killed: 0, maimed: 0, discovered: 0, nothing: 0, learned: 0 };
    for (let roll = 0; roll < 10_000; roll += 1) {
      counts[ladderOutcome({
        roll, kind: input.kind ?? "assassination",
        oddsBps: input.oddsBps, secrecyBps: input.secrecyBps, spared: input.spared,
      })] += 1;
    }
    return counts;
  }

  it("kills, maims, is found out, or comes to nothing", () => {
    const counts = acrossEveryRoll({ oddsBps: PLOT_MAX_ODDS_BPS, secrecyBps: 5_000, spared: false });

    // Three fifths of the successes are deaths; the rest leave him alive.
    expect(counts.killed).toBe(3_600);
    expect(counts.maimed).toBe(2_400);
    // And even at the very ceiling of what a plot may be worth, two in five
    // attempts fail outright. A plot is a way to try, never a way to remove a
    // man.
    expect(counts.killed + counts.maimed).toBe(PLOT_MAX_ODDS_BPS);
  });

  it("never kills a spared man, and maims him instead", () => {
    const counts = acrossEveryRoll({ oddsBps: PLOT_MAX_ODDS_BPS, secrecyBps: 5_000, spared: true });

    expect(counts.killed).toBe(0);
    // Fair game otherwise: what would have killed him takes an eye instead.
    expect(counts.maimed).toBe(PLOT_MAX_ODDS_BPS);
  });

  it("hurts nobody by sabotage, at any roll", () => {
    const counts = acrossEveryRoll({ oddsBps: PLOT_MAX_ODDS_BPS, secrecyBps: 5_000, spared: false, kind: "sabotage" });

    expect(counts.killed).toBe(0);
    expect(counts.maimed).toBe(0);
  });

  it("hides a failure behind whatever secrecy was bought", () => {
    const quiet = acrossEveryRoll({ oddsBps: 1_000, secrecyBps: 9_500, spared: false });
    const careless = acrossEveryRoll({ oddsBps: 1_000, secrecyBps: 500, spared: false });

    expect(quiet.discovered).toBeLessThan(careless.discovered);
    expect(careless.discovered).toBeGreaterThan(8_000);
  });

  /**
   * Walks a plot to its end in a real world, at odds a plot may actually have.
   *
   * The roll is the plot's own id and the day it was set for, so rather than
   * forcing a value outside the range the schema allows -- which would prove
   * the wiring against a world that cannot exist -- this looks for a day whose
   * real roll lands in the band being tested, and uses that one.
   */
  function walk(band: "kill" | "fail", targetId: string, sponsorId: string, playerCharacterId: string | null, state: WorldState = world()) {
    const odds = PLOT_MAX_ODDS_BPS;
    for (let days = PLOT_MIN_DAYS; days <= 200; days += 1) {
      const laid = lay({ ...THE_ORDER, targetCharacterRef: targetId, sponsorCharacterRef: sponsorId, expectedInDays: days }, state).world;
      const plot = laid.covertPlots.at(-1)!;
      const roll = stableHash([plot.id, plot.resolvesAtStep, "spring"]) % 10_000;
      const wanted = band === "kill" ? roll < Math.round(odds * 0.6) : roll >= odds;
      if (!wanted) continue;

      const forced: WorldState = {
        ...laid,
        covertPlots: laid.covertPlots.map((candidate) => ({ ...candidate, successOddsBps: odds, secrecyBps: 9_500 })),
      };
      const after = runDeterministicTick({
        world: forced, warfare: definition.warfare, life: definition.life,
        playerCharacterId, toDay: plot.resolvesAtStep + 1, ids: createIdFactory("walk"),
      });
      return { outcome: after.world.covertPlots.at(-1)!.outcome!, world: after.world };
    }
    throw new Error(`no day inside the bounds rolls into the ${band} band`);
  }

  it("carries a plot that goes all the way through to a death, in a real world", () => {
    // At the true ceiling of what a plot may be worth, on a day whose roll
    // lands in the kill band: this is the wiring from a resolved plot to a
    // dead man, not a claim about how often that happens.
    const done = walk("kill", "hanno-carthage", "gaius-genucius", "gaius-genucius");

    expect(done.outcome).toBe("killed");
    expect(done.world.characters.find((character) => character.id === "hanno-carthage")!.alive).toBe(false);
  });

  it("leaves the player alive and marked by it", () => {
    const done = walk("kill", "gaius-genucius", "quintus-ogulnius", "gaius-genucius");

    expect(done.outcome).toBe("maimed");
    const player = done.world.characters.find((character) => character.id === "gaius-genucius")!;
    expect(player.alive).toBe(true);
    expect(player.disqualifyingStatuses.some((status) => status.startsWith("injured:"))).toBe(true);
  });

  it("kills the player only at his peak -- old, at the top, and comfortable", () => {
    const state = world();
    const consul = state.characters.find((character) => character.id === "gaius-genucius")!;
    expect(atTheirPeak(state, consul, definition.life, 0)).toBe(false);

    const atTheTop: WorldState = {
      ...state,
      characters: state.characters.map((character) => (character.id === consul.id
        ? { ...character, ageYearsAtStart: 68, prestigeBps: 9_500, officeId: "roman-consul" }
        : character)),
      // Nothing already bearing down on him: a man in trouble who is then
      // murdered has been killed off, which is the thing the rule forbids.
      characterPressures: state.characterPressures.filter((pressure) => pressure.characterId !== consul.id),
    };
    const old = atTheTop.characters.find((character) => character.id === consul.id)!;
    expect(atTheirPeak(atTheTop, old, definition.life, 0)).toBe(true);

    const ides = walk("kill", "gaius-genucius", "quintus-ogulnius", "gaius-genucius", atTheTop);
    expect(ides.outcome).toBe("killed");
  });

  it("leaves a traced failure known to the mark", () => {
    const laid = lay().world;
    const doomed: WorldState = {
      ...laid,
      // No chance at all, and no secrecy to hide behind.
      covertPlots: laid.covertPlots.map((plot) => ({ ...plot, successOddsBps: 0, secrecyBps: 0 })),
    };
    const after = forwardTo(doomed, 90);

    expect(after.world.covertPlots.at(-1)!.outcome).toBe("discovered");
    const hanno = after.world.characterBeliefs.filter((belief) => belief.holderCharacterId === "hanno-carthage");
    expect(hanno.some((belief) => belief.claim.includes("paid to have me killed"))).toBe(true);
  });
});

describe("what a maiming actually costs", () => {
  it("takes health and skill for good, and says so on the man", () => {
    const state = world();
    const before = state.characters.find((character) => character.id === "hanno-carthage")!;
    const armless = INJURIES.find((injury) => injury.id === "lost-arm")!;

    const laid = lay().world;
    const forced: WorldState = { ...laid, covertPlots: laid.covertPlots.map((plot) => ({ ...plot, successOddsBps: 10_000 })) };
    const after = forwardTo({
      ...forced,
      // Everything but the arm already taken, so the deterministic pick lands
      // on the one this test can name.
      characters: forced.characters.map((character) => (character.id === "hanno-carthage"
        ? { ...character, disqualifyingStatuses: INJURIES.filter((injury) => injury.id !== armless.id).map(injuryStatusId) }
        : character)),
    }, 90, "hanno-carthage");

    const maimed = after.world.characters.find((character) => character.id === "hanno-carthage")!;
    expect(maimed.disqualifyingStatuses).toContain(injuryStatusId(armless));
    expect(maimed.healthBps).toBeLessThan(before.healthBps);
    expect(maimed.skills.martial).toBeLessThan(before.skills.martial);
    // Worse at soldiering, not absent from the world.
    expect(maimed.skills.martial).toBeGreaterThan(0);
    expect(maimed.alive).toBe(true);
  });
});

describe("the door that made a living corpse is shut", () => {
  it("refuses a status that asserts a death", () => {
    for (const claim of ["dead", "Killed", "slain", "assassinated"]) {
      const result = lay({
        op: "character_state_set", characterRef: "hanno-carthage",
        healthDeltaBps: -10_000, addStatuses: [claim],
        reason: "The knife found him.",
      });
      expect(result.refusals).toHaveLength(1);
      expect(result.refusals[0]).toContain("cannot end a life");
    }
  });

  it("still allows the states a man can actually be in", () => {
    const result = lay({
      op: "character_state_set", characterRef: "hanno-carthage",
      healthDeltaBps: -4_000, addStatuses: ["wounded", "incapacitated"],
      reason: "He was cut down and carried off the field alive.",
    });

    expect(result.refusals).toEqual([]);
    const hurt = result.world.characters.find((character) => character.id === "hanno-carthage")!;
    expect(hurt.alive).toBe(true);
    expect(hurt.disqualifyingStatuses).toContain("incapacitated");
  });
});
