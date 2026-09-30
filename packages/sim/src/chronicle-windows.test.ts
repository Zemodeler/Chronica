import { describe, expect, it } from "vitest";
import { firstPunicWarScenario } from "@chronica/db";
import { ScenarioClockSchema, WorldStateSchema, emitFacts, type Fact, type FactDraft, type WorldState } from "@chronica/shared";
import type { WindowSnapshot } from "./burst";
import { createWindowWriter } from "./chronicle-windows";
import type { ChronicleEntry } from "./chronicle";
import type { SimModelPort } from "./ports";

/**
 * The record written window by window: in time order, as it happens, with
 * nothing already shown ever moved. These drive the writer with windows cut by
 * hand, so what is tested is the writing and not the walk.
 */

const clock = ScenarioClockSchema.parse({ epoch: { year: 264, month: 3, day: 1, era: "BCE" }, minSpanDays: 7, maxSpanDays: 365 });
const world = (): WorldState => WorldStateSchema.parse(structuredClone(firstPunicWarScenario.initialWorld));
const OBSERVER = { kind: "character" as const, id: "marcus-atilius" };

let factCounter = 0;
function fact(overrides: Partial<FactDraft>): Fact {
  const draft: FactDraft = {
    time: { day: 0, minute: 0 }, atStep: 0, kind: "event", summary: "Something happened.", affectedEntities: [], resourceChanges: [],
    authorityChange: undefined, visibility: "public", discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] },
    evidence: null, eligibleReactionScopes: [], sourceEventId: null, sourceActionId: null, causalDepth: 0, ...overrides,
  };
  return emitFacts([draft], () => `fact-${(factCounter += 1)}`)[0]!;
}
const rome = { kind: "polity" as const, id: "rome" };
const syracuse = { kind: "polity" as const, id: "syracuse" };

/** Writes every thread it is given, and counts. */
function historian(): SimModelPort & { calls: number } {
  const port = {
    calls: 0,
    complete(_operation: Parameters<SimModelPort["complete"]>[0], _system: string, user: string) {
      port.calls += 1;
      const threads = [...user.matchAll(/^THREAD (\d+)/gm)].map((match) => Number(match[1]));
      return Promise.resolve(JSON.stringify({ entries: threads.map((thread) => ({ thread, title: `Thread ${thread}`, body: "It happened." })) }));
    },
  };
  return port;
}

function window(index: number, fromDay: number, toDay: number, facts: readonly Fact[], weights: ReadonlyMap<string, number>, orderFactIds: readonly string[] = [], final = false): WindowSnapshot {
  const state = world();
  return {
    index, from: { day: fromDay, minute: 0 }, to: { day: toDay, minute: 0 }, worldBefore: state, worldAfter: state,
    facts, significanceByFactId: weights, narrative: [], frictions: [], utterances: [], battleAccounts: [], orderFactIds, final,
  };
}

function writer(port: SimModelPort, onEntry?: (entry: ChronicleEntry, window: number) => Promise<void>) {
  return createWindowWriter({ port, clock, observer: OBSERVER, observerPolityId: "rome", offices: [], recentSubjects: [], recentTitles: [], onEntry });
}

const weigh = (facts: readonly Fact[], weight: number) => new Map(facts.map((candidate) => [candidate.id, weight]));
/** A moment for the historian to finish a window, as she would have long before the next hop closes. */
const tick = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

describe("the record reads forward in time", () => {
  it("publishes entries in non-decreasing date order across the windows of a burst", async () => {
    const answer = fact({ time: { day: 0, minute: 0 }, summary: "The consul orders the levy.", affectedEntities: [rome] });
    const later = fact({ time: { day: 5, minute: 0 }, summary: "The levy assembles at Capua.", affectedEntities: [rome, { kind: "province", id: "campania" }] });
    const latest = fact({ time: { day: 40, minute: 0 }, summary: "Syracuse sends envoys.", affectedEntities: [syracuse, { kind: "character", id: "hieron" }] });
    const weights = weigh([answer, later, latest], 60);
    const seen: { title: string; window: number; at: number }[] = [];
    const w = writer(historian(), (entry, index) => { seen.push({ title: entry.title, window: index, at: entry.toInstantSortKey }); return Promise.resolve(); });
    w.closed(window(0, 0, 0, [answer], weights, [answer.id]));
    w.closed(window(1, 0, 2, [], weights));
    w.closed(window(2, 2, 31, [later], weights));
    w.closed(window(3, 31, 61, [latest], weights));
    const { entries } = await w.finish();

    expect(entries).toHaveLength(3);
    const dates = entries.map((entry) => entry.toInstantSortKey);
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
    expect(seen.map((entry) => entry.window)).toEqual([0, 2, 3]);
  });

  it("tells a delayed fact in the window it became knowable, as news, not the window it happened", async () => {
    // A battle on day 1 that word of reaches the court on day 20 is told on
    // day 20. Placing it on day 1 would put it before entries already shown.
    const early = fact({ time: { day: 0, minute: 0 }, summary: "The consul takes the auspices.", affectedEntities: [rome] });
    const delayed = fact({
      time: { day: 1, minute: 0 }, summary: "Agathocles is murdered at a banquet.", affectedEntities: [syracuse, { kind: "character", id: "agathocles" }],
      // Syracuse's own business, loose in the world: word of it has a road to travel.
      visibility: "polity", discovery: { state: "delayed", knowableAtInstant: { day: 20, minute: 0 }, discoveredBy: [] },
    });
    const weights = weigh([early, delayed], 60);
    const seen: number[] = [];
    const w = writer(historian(), (_entry, index) => { seen.push(index); return Promise.resolve(); });
    w.closed(window(0, 0, 0, [early], weights, [early.id]));
    await tick();
    w.closed(window(1, 0, 2, [delayed], weights));
    await tick();
    w.closed(window(2, 2, 31, [], weights));
    const { entries } = await w.finish();

    expect(entries).toHaveLength(2);
    expect(seen).toEqual([0, 2]);
    const news = entries[1]!;
    expect(news.factIds).toEqual([delayed.id]);
    // Dated when it reached the court, not when it happened.
    expect(news.toInstantSortKey).toBeGreaterThanOrEqual(2 * 1440);
  });

  it("continues a matter seen in an earlier window with a new entry at the later date, and never edits the first", async () => {
    const setsOut = fact({ time: { day: 0, minute: 0 }, summary: "The embassy sets out for Syracuse.", affectedEntities: [rome, syracuse, { kind: "character", id: "falto" }] });
    const received = fact({ time: { day: 31, minute: 0 }, summary: "Hieron receives the embassy.", affectedEntities: [rome, syracuse, { kind: "character", id: "falto" }] });
    const weights = weigh([setsOut, received], 60);
    const published: ChronicleEntry[] = [];
    const w = writer(historian(), (entry) => { published.push(structuredClone(entry)); return Promise.resolve(); });
    w.closed(window(0, 0, 2, [setsOut], weights, [setsOut.id]));
    w.closed(window(1, 2, 32, [received], weights));
    const { entries } = await w.finish();

    expect(entries).toHaveLength(2);
    expect(entries[0]!.factIds).toEqual([setsOut.id]);
    expect(entries[1]!.factIds).toEqual([received.id]);
    expect(entries[1]!.toInstantSortKey).toBeGreaterThan(entries[0]!.toInstantSortKey);
    // What was handed out first is what stands first, unchanged.
    expect(entries[0]).toEqual(published[0]);
  });

  it("writes nothing for a quiet window, at no cost, and carries its facts into the next", async () => {
    const slight = fact({ time: { day: 1, minute: 0 }, summary: "A remittance from Rhegium arrives.", affectedEntities: [{ kind: "province", id: "rhegium" }, { kind: "character", id: "quaestor" }] });
    const grave = fact({ time: { day: 30, minute: 0 }, summary: "Rhegium's garrison mutinies.", affectedEntities: [{ kind: "province", id: "rhegium" }, { kind: "character", id: "quaestor" }] });
    const weights = new Map([[slight.id, 5], [grave.id, 60]]);
    const port = historian();
    const w = writer(port);
    w.closed(window(0, 0, 2, [slight], weights));
    await tick();
    const callsAfterQuietWindow = port.calls;
    w.closed(window(1, 2, 31, [grave], weights));
    const { entries, calls } = await w.finish();

    expect(callsAfterQuietWindow).toBe(0);
    expect(calls).toBe(1);
    expect(entries).toHaveLength(1);
    // Told once the matter had grown, with the slight fact beside the grave one.
    expect(new Set(entries[0]!.factIds)).toEqual(new Set([slight.id, grave.id]));
  });

  it("draws every entry on exactly the facts it was given, and mints nothing", async () => {
    const facts = [
      fact({ time: { day: 0, minute: 0 }, summary: "One.", affectedEntities: [rome] }),
      fact({ time: { day: 3, minute: 0 }, summary: "Two.", affectedEntities: [syracuse, { kind: "character", id: "hieron" }] }),
    ];
    const weights = weigh(facts, 60);
    const w = writer(historian());
    w.closed(window(0, 0, 2, [facts[0]!], weights, [facts[0]!.id]));
    w.closed(window(1, 2, 31, [facts[1]!], weights));
    const { entries } = await w.finish();
    const given = new Set(facts.map((candidate) => candidate.id));
    for (const entry of entries) for (const id of entry.factIds) expect(given.has(id)).toBe(true);
    expect(new Set(entries.flatMap((entry) => entry.factIds))).toEqual(given);
  });

  it("commits exactly the sequence it published, in the same order", async () => {
    const facts = [
      fact({ time: { day: 0, minute: 0 }, summary: "One.", affectedEntities: [rome] }),
      fact({ time: { day: 10, minute: 0 }, summary: "Two.", affectedEntities: [syracuse, { kind: "character", id: "hieron" }] }),
      fact({ time: { day: 40, minute: 0 }, summary: "Three.", affectedEntities: [{ kind: "polity", id: "carthage" }, { kind: "character", id: "hanno" }] }),
    ];
    const weights = weigh(facts, 60);
    const published: string[] = [];
    const w = writer(historian(), (entry) => { published.push(entry.factIds.join(",")); return Promise.resolve(); });
    w.closed(window(0, 0, 2, [facts[0]!], weights, [facts[0]!.id]));
    w.closed(window(1, 2, 31, [facts[1]!], weights));
    w.closed(window(2, 31, 61, [facts[2]!], weights));
    const { entries } = await w.finish();
    expect(entries.map((entry) => entry.factIds.join(","))).toEqual(published);
    expect(published).toHaveLength(3);
  });

  it("tells the weightiest of what no window told, once the burst is over, rather than leaving the span blank", async () => {
    const slight = fact({ time: { day: 1, minute: 0 }, summary: "A remittance from Rhegium arrives.", affectedEntities: [{ kind: "province", id: "rhegium" }, { kind: "character", id: "quaestor" }] });
    const port = historian();
    const w = writer(port);
    w.closed(window(0, 0, 31, [slight], weigh([slight], 5)));
    const { entries, calls } = await w.finish();
    expect(calls).toBe(1);
    expect(entries).toHaveLength(1);
  });
});

describe("what every window carried past", () => {
  it("rides the pool to the last window and is dated when told, no earlier than what was already shown", async () => {
    // The grave matter of the second window is not yet knowable when that
    // window closes, so it rides in the pool to the last window, which tells
    // it at its own date.
    const answer = fact({ time: { day: 0, minute: 0 }, summary: "The consul orders the levy.", affectedEntities: [rome] });
    const delayed = fact({
      time: { day: 1, minute: 0 }, summary: "Agathocles is murdered at a banquet.", affectedEntities: [syracuse, { kind: "character", id: "agathocles" }],
      visibility: "polity", discovery: { state: "delayed", knowableAtInstant: { day: 20, minute: 0 }, discoveredBy: [] },
    });
    const weights = weigh([answer, delayed], 60);
    const seen: number[] = [];
    const w = writer(historian(), (_entry, index) => { seen.push(index); return Promise.resolve(); });
    w.closed(window(0, 0, 0, [answer], weights, [answer.id]));
    w.closed(window(1, 0, 2, [delayed], weights));
    await tick();
    w.closed(window(2, 2, 31, [], weights, [], true));
    const { entries } = await w.finish();
    expect(entries).toHaveLength(2);
    expect(seen).toEqual([0, 2]);
    expect(entries[1]!.toInstantSortKey).toBeGreaterThanOrEqual(entries[0]!.toInstantSortKey);
  });
});

describe("the last window", () => {
  it("tells what earlier windows carried to it in its own compose, with no closing pass after it", async () => {
    const slight = fact({ time: { day: 1, minute: 0 }, summary: "A remittance from Rhegium arrives.", affectedEntities: [{ kind: "province", id: "rhegium" }, { kind: "character", id: "quaestor" }] });
    const grave = fact({ time: { day: 30, minute: 0 }, summary: "Rhegium's garrison mutinies.", affectedEntities: [{ kind: "province", id: "rhegium" }, { kind: "character", id: "quaestor" }] });
    const weights = new Map([[slight.id, 5], [grave.id, 60]]);
    const port = historian();
    const seen: number[] = [];
    const w = writer(port, (_entry, index) => { seen.push(index); return Promise.resolve(); });
    w.closed(window(0, 0, 2, [slight], weights));
    await tick();
    w.closed(window(1, 2, 31, [grave], weights, [], true));
    const { entries, calls } = await w.finish();
    expect(calls).toBe(1);
    expect(entries).toHaveLength(1);
    expect(seen).toEqual([1]);
    expect(new Set(entries[0]!.factIds)).toEqual(new Set([slight.id, grave.id]));
  });

  it("does not wait for a window still being written, and still tells what that window carries to it", async () => {
    const first = fact({ time: { day: 20, minute: 0 }, summary: "Rhegium's garrison mutinies.", affectedEntities: [{ kind: "province", id: "rhegium" }] });
    const second = fact({ time: { day: 21, minute: 0 }, summary: "Tarentum's fleet puts to sea.", affectedEntities: [{ kind: "province", id: "tarentum" }] });
    const third = fact({ time: { day: 22, minute: 0 }, summary: "Croton closes its gates.", affectedEntities: [{ kind: "province", id: "croton" }] });
    const fourth = fact({ time: { day: 23, minute: 0 }, summary: "Locri sends envoys to Carthage.", affectedEntities: [{ kind: "province", id: "locri" }] });
    const last = fact({ time: { day: 31, minute: 0 }, summary: "The consul's army drills at Capua.", affectedEntities: [{ kind: "province", id: "capua" }, { kind: "character", id: "quaestor" }] });
    const weights = new Map([[first.id, 60], [second.id, 55], [third.id, 50], [fourth.id, 45], [last.id, 60]]);
    const port = historian();
    const w = writer(port);
    // Four matters over the bar, room for three: the fourth is carried.
    w.closed(window(0, 0, 30, [first, second, third, fourth], weights));
    // The last window closes at once, before the first has been written.
    w.closed(window(1, 30, 31, [last], weights, [], true));
    const { entries } = await w.finish();
    // The last window chose after the first had carried (C07): nothing is lost to the race.
    expect(entries.some((entry) => entry.factIds.includes(fourth.id))).toBe(true);
    expect(entries.some((entry) => entry.factIds.includes(last.id))).toBe(true);
  });
});
