import { describe, expect, it } from "vitest";
import { MAX_OWED_BURSTS, MAX_OWED_ORDER_BURSTS, OrderPartSchema, OwedTurnSchema, owedBurstsAllowed, type FactProposal, type OrderPart, type WorldState } from "@chronica/shared";
import { opening } from "./fiscal-test-kit";
import { claimsItDone, lineOf, toldOutcome } from "./order-outcomes";
import { reconcileFacts } from "./reconcile-facts";
import { reconcileTheRound } from "./round-corrections";
import { evidenceOfDone, scoreDisplayedOrder, scoreToldPart, toldStatusOfLine } from "./scorecard";
import type { RejectedDelta } from "./apply/context";
import type { SimModelPort } from "./ports";

/**
 * A part of an order is done only on evidence tied to that part.
 *
 * The outcome line used to raise a part to "done" on a name or a post found
 * anywhere in the world: "Raise an army called the Campanian legion" read
 * done because the Campanians already had one, and "Appoint Gnaeus Cornelius
 * Blasio" read done because he was consul. And the scorecard measured the
 * status function while the player read the line that overrode it.
 */

const ACTOR = "gaius-genucius";
const part = (change: Partial<OrderPart> = {}): OrderPart => OrderPartSchema.parse({ said: "Buy a small estate near Capua.", ...change });
const withOrder = (parts: OrderPart[], world: WorldState = opening(150), givenAtStep = 140): WorldState => ({
  ...world, orders: [{ id: "rec", actorCharacterId: ACTOR, text: "x", givenAtStep, parts }],
});

describe("the outcome line takes no credit it cannot tie to the part", () => {
  it("does not take a foreign army that already bears the name for the army asked to be raised", () => {
    const raise = part({ said: "Raise an army called Campanian legion of Rhegium" });
    const world = withOrder([raise]);
    expect(toldOutcome(world, raise, ACTOR).status).toBe("unanswered");
    expect(lineOf(world, raise, ACTOR)).not.toMatch(/-- done/);
  });

  it("does not take the actor's own army raised long before for one asked to be raised now", () => {
    const raise = part({ said: "Raise an army called Roman field army" });
    expect(toldOutcome(withOrder([raise]), raise, ACTOR).status).toBe("unanswered");
  });

  it("takes the army the part itself raised, of the actor's own power", () => {
    const raise = part({ said: "Raise an army called Roman field army", actsCarried: 1, workRefs: [{ kind: "force", id: "roman-field-army" }] });
    const told = toldOutcome(withOrder([raise]), raise, ACTOR);
    expect(told.status).toBe("achieved");
  });

  it("does not take an army of another power for the part's own, though the part names it", () => {
    const raise = part({ said: "Raise an army called Carthaginian fleet", workRefs: [{ kind: "force", id: "carthaginian-fleet" }] });
    expect(toldOutcome(withOrder([raise]), raise, ACTOR).status).not.toBe("achieved");
  });

  it("does not take a man's unrelated seat for the post he was to be appointed to", () => {
    const appoint = part({ said: "Appoint Gnaeus Cornelius Blasio as legate of the new army" });
    const world = withOrder([appoint]);
    expect(toldOutcome(world, appoint, ACTOR).status).toBe("unanswered");
    expect(lineOf(world, appoint, ACTOR)).not.toMatch(/holds the post/);
  });

  it("takes the appointment where he commands an army the part made", () => {
    const appoint = part({ said: "Appoint Gaius Genucius Clepsina to command it", workRefs: [{ kind: "force", id: "roman-field-army" }] });
    expect(toldOutcome(withOrder([appoint]), appoint, ACTOR).status).toBe("achieved");
  });

  it("never raises a refused or failed part to done", () => {
    const refused = part({ said: "Raise an army called Roman field army", refusal: "The Senate would not allow it.", workRefs: [{ kind: "force", id: "roman-field-army" }] });
    expect(toldOutcome(withOrder([refused]), refused, ACTOR).status).toBe("refused");
  });

  it("does not give a part's words a work begun before the order, or by somebody else", () => {
    const world0 = opening(150);
    const road = { ...world0.projects[0], id: "road-1", kind: "road", label: "Road from Rome to Capua", status: "in_progress", startedAtStep: 100, sponsorEntityRef: { kind: "polity", id: "carthage" } } as WorldState["projects"][number];
    const build = part({ said: "Construct the road from Rome to Capua" });
    const world = withOrder([build], { ...world0, projects: [road] });
    expect(toldOutcome(world, build, ACTOR).status).toBe("unanswered");
    expect(toldOutcome(world, build, ACTOR).mayAnswer).toBeUndefined();
  });

  it("says a work begun since by the actor may answer it, without crediting it", () => {
    const world0 = opening(150);
    const road = { id: "road-1", kind: "road", label: "Road from Rome to Capua", status: "in_progress", startedAtStep: 145, sponsorEntityRef: { kind: "character", id: ACTOR },
      reservationId: null, milestones: [{ id: "m1", label: "Survey", requiredAtElapsedOffset: 10, status: "pending" }], completionOutcome: null, linkedEntityIds: [], targetCompletionStep: null, completedAtStep: null, provenanceEventIds: [] } as unknown as WorldState["projects"][number];
    const build = part({ said: "Construct the road from Rome to Capua" });
    const world = withOrder([build], { ...world0, projects: [road] });
    const told = toldOutcome(world, build, ACTOR);
    expect(told.status).toBe("unanswered");
    expect(told.mayAnswer?.id).toBe("road-1");
    expect(lineOf(world, build, ACTOR)).toMatch(/nothing came of it.*may answer it, not tied to this order: Road from Rome to Capua/);
  });
});

describe("the scorecard judges the line shown, against evidence of its own", () => {
  const legion = "roman-field-army";
  const at = (world: WorldState): string => world.material.forces.find((force) => force.id === legion)!.locationId;
  const elsewhere = (world: WorldState): string => world.map.provinces.find((province) => province.id !== at(world))!.id;

  it("reads the status a line tells, longest label first", () => {
    expect(toldStatusOfLine("\"x\" -- partly done: 1 of 2.")).toBe("partly_done");
    expect(toldStatusOfLine("\"x\" -- done, beyond his authority.")).toBe("achieved");
    expect(toldStatusOfLine("\"x\" -- ordered; no sign of it yet.")).toBe("carried_unverified");
    expect(toldStatusOfLine("prose")).toBeNull();
  });

  it("flags a line saying done for an army of the wrong owner", () => {
    const world = withOrder([part({ said: "Raise an army called Carthaginian fleet", actsCarried: 1, actsDone: 1, workRefs: [{ kind: "force", id: "carthaginian-fleet" }] })]);
    const score = scoreToldPart(world, world.orders[0]!.parts[0]!, ACTOR, "\"Raise an army called Carthaginian fleet\" -- done.");
    expect(score.doneWithoutEvidence).toBe(true);
  });

  it("flags a line saying done for an appointment to the wrong post", () => {
    const world = withOrder([part({ said: "Appoint Gnaeus Cornelius Blasio as legate of the new army" })]);
    expect(scoreToldPart(world, world.orders[0]!.parts[0]!, ACTOR, "\"Appoint Gnaeus Cornelius Blasio as legate of the new army\" -- done: Gnaeus Cornelius Blasio holds the post.").doneWithoutEvidence).toBe(true);
  });

  it("flags a line saying done for a force that stood there before the order", () => {
    const world0 = opening(150);
    const world = withOrder([part({ said: "Carry the legion to its camp", goals: [{ kind: "force_at", forceId: legion, provinceId: at(world0) }], metAtOrder: true })], world0);
    expect(scoreToldPart(world, world.orders[0]!.parts[0]!, ACTOR, "\"Carry the legion to its camp\" -- done.").doneWithoutEvidence).toBe(true);
    // And the engine's own line says it was so already.
    expect(scoreToldPart(world, world.orders[0]!.parts[0]!, ACTOR).doneWithoutEvidence).toBe(false);
  });

  it("flags a line saying done for an army at the wrong destination", () => {
    const world0 = opening(150);
    const world = withOrder([part({ said: "Carry the legion to Messana", goals: [{ kind: "force_at", forceId: legion, provinceId: elsewhere(world0) }], metAtOrder: false, actsCarried: 1 })], world0);
    expect(scoreToldPart(world, world.orders[0]!.parts[0]!, ACTOR, "\"Carry the legion to Messana\" -- done.").doneWithoutEvidence).toBe(true);
  });

  it("flags a refused payment told as done", () => {
    const world = withOrder([part({ said: "Pay the shipwrights 5000", actsRefused: 1, refusal: "The treasury would not pay without the Senate." })]);
    const score = scoreToldPart(world, world.orders[0]!.parts[0]!, ACTOR, "\"Pay the shipwrights 5000\" -- done.");
    expect(score.erasedFailure).toBe(true);
    expect(score.doneWithoutEvidence).toBe(true);
  });

  it("counts a clause with no line as missing", () => {
    const world = withOrder([part({ said: "Hire ships" }), part({ said: "Write to Hiero" })]);
    const score = scoreDisplayedOrder(world, "rec", ["\"Hire ships\" -- nothing came of it."]);
    expect(score.missingClauses).toBe(1);
    expect(score.parts.find((entry) => entry.said === "Write to Hiero")?.missingClause).toBe(true);
  });

  it("flags a success hidden behind a line saying nothing came of it", () => {
    const world0 = opening(150);
    const world = withOrder([part({ said: "Hold the legion at its camp", goals: [{ kind: "force_at", forceId: legion, provinceId: at(world0) }], metAtOrder: false })], world0);
    expect(evidenceOfDone(world, world.orders[0]!.parts[0]!, ACTOR)).toBe(true);
    expect(scoreToldPart(world, world.orders[0]!.parts[0]!, ACTOR, "\"Hold the legion at its camp\" -- nothing came of it.").hiddenSuccess).toBe(true);
  });

  it("finds nothing wrong with the engine's own lines for the same parts", () => {
    const world0 = opening(150);
    const parts = [
      part({ said: "Raise an army called Campanian legion of Rhegium" }),
      part({ said: "Appoint Gnaeus Cornelius Blasio as legate of the new army" }),
      part({ said: "Pay the shipwrights 5000", actsRefused: 1, refusal: "The treasury would not pay." }),
      part({ said: "Carry the legion to Messana", goals: [{ kind: "force_at", forceId: legion, provinceId: elsewhere(world0) }], metAtOrder: false, actsCarried: 1 }),
    ];
    const world = withOrder(parts, world0);
    const shown = parts.map((one) => lineOf(world, one, ACTOR));
    const score = scoreDisplayedOrder(world, "rec", shown);
    expect(score.doneWithoutEvidence + score.erasedFailures + score.missingClauses + score.hiddenSuccesses).toBe(0);
  });
});

describe("a passage held to the part", () => {
  it("catches the landfall said in other words", () => {
    expect(claimsItDone("The legion made landfall at Messana.", "under_way")).toBe(true);
    expect(claimsItDone("The men came ashore below the walls.", "awaiting_condition")).toBe(true);
  });

  it("lets a passage say the thing did not happen", () => {
    expect(claimsItDone("The legion never arrived at Messana.", "failed")).toBe(false);
    expect(claimsItDone("The legion had not yet landed when the month ended.", "under_way")).toBe(false);
    expect(claimsItDone("The fleet failed to reach the strait.", "failed")).toBe(false);
    expect(claimsItDone("The sum wasn't paid.", "refused")).toBe(false);
  });

  it("still catches a claim beside a denial in another clause", () => {
    expect(claimsItDone("The fleet never sailed, but the legion landed at Messana.", "unanswered")).toBe(true);
  });
});

const proposal = (localId: string, summary: string): FactProposal => ({
  localId, kind: "military_movement", summary, affectedRefs: [{ kind: "polity", id: "rome" }], visibility: "public", discoveryState: "known", knowableInDays: 0, significance: 50,
} as unknown as FactProposal);
const refusal = (op = "money_transfer"): RejectedDelta => ({ delta: { op, amount: 5 }, reason: "refused" } as unknown as RejectedDelta);
const failing: SimModelPort = { complete: () => Promise.reject(new Error("provider down")) };
const unreadable: SimModelPort = { complete: () => Promise.resolve("not json") };

describe("a correction that could not be made", () => {
  it("leaves every fact it was asked about unresolved, never settled", async () => {
    for (const port of [failing, unreadable]) {
      const result = await reconcileFacts({ port, facts: [proposal("a", "The sum left the chest.")], refused: [refusal()] });
      expect(result.failure).not.toBeNull();
      expect(result.unresolved).toEqual(["a"]);
    }
  });

  it("keeps the round's unsettled facts as reports, never as the event", async () => {
    const settled = await reconcileTheRound({ port: failing, held: [{ facts: [proposal("a", "The legion crossed the strait.")], refused: [refusal("force_modify")] }] });
    expect(settled.failure).not.toBeNull();
    expect(settled.facts[0]).toHaveLength(1);
    expect(settled.facts[0]![0]!.kind).toMatch(/^claim_/);
    expect(settled.facts[0]![0]!.summary).toMatch(/^It was said that/);
  });

  it("stands a fact the answer settled, and leaves unsettled what it kept past refusals it was never shown", async () => {
    const answers: SimModelPort = { complete: () => Promise.resolve(JSON.stringify({ withdraw: ["b"], rewrite: [] })) };
    const few = await reconcileFacts({ port: answers, facts: [proposal("a", "Rome stirs."), proposal("b", "The sum left.")], refused: [refusal()] });
    expect(few.facts.map((fact) => fact.localId)).toEqual(["a"]);
    expect(few.unresolved).toEqual([]);
    const many = await reconcileFacts({ port: answers, facts: [proposal("a", "Rome stirs."), proposal("b", "The sum left.")], refused: Array.from({ length: 61 }, () => refusal()) });
    expect(many.unresolved).toEqual(["a"]);
  });
});

describe("a turn owed for want of time or calls", () => {
  it("loads an old save's owed turn, which says nothing of why", () => {
    expect(OwedTurnSchema.parse({ characterId: "x", why: "an order", sinceStep: 3 }).cause).toBeUndefined();
    expect(OwedTurnSchema.parse({ characterId: "x", why: "an order", sinceStep: 3, cause: "time" }).cause).toBe("time");
  });

  it("is kept longer while he holds an open part of the player's order, and as long as ever otherwise", () => {
    const world0 = withOrder([part({ said: "Bring the fleet round" })]);
    const attempt = { id: "att-1", recipientRef: { kind: "character", id: "gnaeus-cornelius" }, status: "accepted", servesRef: "rec-p0" } as unknown as WorldState["orderAttempts"][number];
    const world = { ...world0, orderAttempts: [attempt] };
    expect(owedBurstsAllowed(world, { characterId: "gnaeus-cornelius" })).toBe(MAX_OWED_ORDER_BURSTS);
    expect(owedBurstsAllowed(world, { characterId: "manius-curius" })).toBe(MAX_OWED_BURSTS);
    const closed = { ...world, orders: world.orders.map((order) => ({ ...order, parts: order.parts.map((one) => ({ ...one, closedAtStep: 150 })) })) };
    expect(owedBurstsAllowed(closed, { characterId: "gnaeus-cornelius" })).toBe(MAX_OWED_BURSTS);
  });
});
