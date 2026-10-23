import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, economyOf, tradeTermsBetween, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { SUSPENDED_PACT_TRUST, keepTreaties, trustOf } from "./treaties";
import { HUBS, POWERS, agreement, bookOf, flow, opening, setStock, withAgreements, withCustoms } from "./trade-test-kit";

// A fresh seed for each context: one seed reused made two rows with one id (`ids.unique`).
let contexts = 0;

/**
 * War suspends a pact (phase D of the economy rework).
 *
 * A war between two powers used to end every agreement between them, and a
 * trade pact was a word nothing read. It is now held, not ended: nothing
 * crosses the border while the armies are out, whatever the pact says; the
 * record of the pact is untouched, and the day the war is over its terms are
 * back, with no clause to write again. Making the war costs the warmaker the
 * other's trust, a quarter of what breaking a peace does.
 */

const { syracuse } = HUBS;
const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const context = (): ApplyContext => ({
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  actsForTheWorld: true,
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory(`held-${(contexts += 1)}`),
  gameId: "game-held",
});
const apply = (world: WorldState, raw: Record<string, unknown>) => applyDeltas(world, [WorldDeltaSchema.parse(raw)], context());
const PACT = agreement("trade_pact", POWERS.carthage, POWERS.syracuse, { trade: { tariffCapBps: 500, mostFavoured: false, exempt: [], goods: [] } });
const WAR = { op: "agreement_open", localId: "war-1", kind: "war", polityId: "carthage", otherPolityId: "syracuse", terms: "Over the grain of Agrigentum.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "War." };
const PEACE = { op: "agreement_open", localId: "peace-1", kind: "peace", polityId: "carthage", otherPolityId: "syracuse", terms: "Peace.", forDays: null, sourceMessageRef: null, visibility: "public", reason: "Peace." };

/** What crossed from Carthage to Syracuse in a month with Syracuse short of grain and a heavy tariff, and what customs it paid. */
function crossing(world: WorldState): { carthage: number; duty: number } {
  const taxed = withCustoms(world, POWERS.syracuse, 3_000);
  const book = bookOf(taxed);
  setStock(book, syracuse, "grain", 0.6);
  const result = flow(taxed, book);
  return { carthage: result.lanes.get(`${POWERS.carthage}>${POWERS.syracuse}`) ?? 0, duty: result.duties.get(POWERS.syracuse) ?? 0 };
}
const tick = (world: WorldState, day: number) => keepTreaties({ world, toDay: day, ids: createIdFactory(`keep-${day}`), playerPolityId: null });

describe("war suspends a pact", () => {
  it("leaves the pact standing when a war is made, and shuts the border for as long as it lasts", () => {
    const pacted = withAgreements(opening(), PACT);
    expect(crossing(pacted).carthage).toBeGreaterThan(0);
    const warring = apply(pacted, WAR).world;
    const record = warring.polityAgreements.find((entry) => entry.kind === "trade_pact")!;
    expect(record.status).toBe("active");
    expect(record.endedAtStep).toBeNull();
    const terms = tradeTermsBetween(warring, POWERS.carthage, POWERS.syracuse);
    expect(terms.closed).toBe("war");
    expect(terms.pactSuspended).toBe(true);
    expect(terms.pact).toBeNull();
    expect(crossing(warring).carthage).toBe(0);
  });

  it("brings it back, terms and all, on the day the war ends", () => {
    const pacted = withAgreements(opening(), PACT);
    const warring = apply(pacted, WAR).world;
    const peace = apply(warring, PEACE).world;
    const record = peace.polityAgreements.find((entry) => entry.kind === "trade_pact")!;
    expect(record.status).toBe("active");
    expect(record).toEqual(pacted.polityAgreements.find((entry) => entry.kind === "trade_pact"));
    const terms = tradeTermsBetween(peace, POWERS.carthage, POWERS.syracuse);
    expect(terms.closed).toBeNull();
    expect(terms.pactSuspended).toBe(false);
    expect(terms.pact?.tariffCapBps).toBe(500);
    // Grain crosses again at the pact's tariff, not the heavy one.
    const resumed = crossing(peace);
    expect(resumed.carthage).toBeGreaterThan(0);
    expect(resumed.carthage).toBeCloseTo(crossing(pacted).carthage, 3);
  });

  it("costs the warmaker some trust with the power it made war on, a quarter of a broken peace's", () => {
    const pacted = withAgreements(opening(), PACT);
    const settled = tick(pacted, 0).world;
    const warring = apply(settled, WAR).world;
    const before = trustOf(warring, POWERS.syracuse, POWERS.carthage);
    const after = tick(warring, 1);
    expect(trustOf(after.world, POWERS.syracuse, POWERS.carthage)).toBe(before - SUSPENDED_PACT_TRUST);
    // It is a smaller thing than a broken peace: no legitimacy lost, no grievance to answer, no "peace broken" in the news.
    expect(economyOf(after.world).grievances).toEqual([]);
    expect(after.facts.some((fact) => fact.kind === "peace_broken")).toBe(false);
    // And none at all where there was no pact.
    const bare = tick(apply(tick(opening(), 0).world, WAR).world, 1);
    expect(trustOf(bare.world, POWERS.syracuse, POWERS.carthage)).toBe(trustOf(opening(), POWERS.syracuse, POWERS.carthage));
  });

  it("tells of the resumption once, as one line for the two powers, and says nothing of a pact that was never held", () => {
    const pacted = withAgreements(opening(), PACT);
    const settled = tick(pacted, 0).world;
    const warring = tick(apply(settled, WAR).world, 1);
    expect(warring.facts.some((fact) => fact.kind === "trade_resumed")).toBe(false);
    expect(economyOf(warring.world).tradeNews.some((entry) => entry.polityId === POWERS.carthage && entry.otherPolityId === POWERS.syracuse)).toBe(true);
    const peace = apply(warring.world, PEACE).world;
    const resumed = tick(peace, 40);
    expect(resumed.facts.filter((fact) => fact.kind === "trade_resumed")).toHaveLength(1);
    expect(economyOf(resumed.world).tradeNews).toEqual([]);
    // Not told again.
    expect(tick(resumed.world, 41).facts.some((fact) => fact.kind === "trade_resumed")).toBe(false);
  });

  it("does not suspend an embargo, which does not need a war and outlasts one", () => {
    const embargoed = withAgreements(opening(), agreement("embargo", POWERS.carthage, POWERS.syracuse));
    const peace = apply(apply(embargoed, WAR).world, PEACE).world;
    expect(tradeTermsBetween(peace, POWERS.carthage, POWERS.syracuse).closed).toBe("embargo");
  });
});
