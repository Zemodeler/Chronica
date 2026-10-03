import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { DiplomaticMessageSchema, PoliticalProcedureSchema, ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, advanceWorldTo, diplomaticAnswerChangesTrust, diplomaticSituationKey, emitFacts, negotiationBusinesses, redundantDiplomaticOffer, sameDiplomaticTerms, type DiplomaticMessage, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { routeAttention, routeAmbientActors } from "./attention";
import { runSimulationBurst, DEFAULT_BUDGET } from "./burst";
import { renderCharacterPortrait } from "./cognition";
import { diplomaticMemory } from "./negotiation-business";
import { dueSteps, layPlan, markWoken, nextPlanDay, settleOverdueSteps } from "./plans";
import { createIdFactory, type SimModelPort } from "./ports";
import { isWatchSatisfied } from "./watch";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const initial = () => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const actor = "hanno-carthage", recipient = "hieron-ii";
const negotiation = { issueKey: "consultation:strait", objective: "Protect Carthaginian interests at the strait", question: "How much advance notice?", positions: [{ issue: "advance notice days", value: "5" }] };
const proposal = (changes: Record<string, unknown> = {}) => WorldDeltaSchema.parse({ op: "diplomatic_message_send", localId: "consultation", kind: "letter", fromPolityId: "carthage", fromCharacterRef: actor, toPolityId: "syracuse", toCharacterRef: recipient, subject: "Notice before action at Messana", terms: "Give five days notice before action at Messana.", replyWithinDays: 10, negotiation, reason: "Settle advance notice.", ...changes });
function apply(world: WorldState, deltas: unknown[], by = actor) {
  return applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), { now: world.instant, actorRef: { kind: "character", id: by }, offices: definition.government.offices, warfare: definition.warfare, ids: createIdFactory(`business-${world.diplomacy.length}-${world.instant.day}`), gameId: "business", playerCharacterId: "gaius-genucius" });
}
const send = () => apply(initial(), [proposal()]);
const day = (world: WorldState, value: number) => advanceWorldTo(world, { day: value, minute: 0 });
const letter = (overrides: Partial<DiplomaticMessage> = {}) => DiplomaticMessageSchema.parse({ id: "test-letter", kind: "letter", fromPolityId: "carthage", toPolityId: "syracuse", fromCharacterId: actor, toCharacterId: recipient, subject: "Notice", terms: "Five days notice", negotiation, sentAtStep: 0, deliveredOnDay: 20, replyDueByStep: 30, ...overrides });

describe("negotiations progress instead of restarting", () => {
  it("persists an owner and business identity and accepts older saves", () => {
    const sent = send();
    expect(sent.rejected).toEqual([]);
    const message = sent.world.diplomacy.at(-1)!;
    expect(message.negotiationOwnerCharacterId).toBe(actor);
    expect(message.negotiationId).toBe(message.id);
    expect(WorldStateSchema.safeParse(sent.world).success).toBe(true);
    expect(WorldStateSchema.safeParse(initial()).success).toBe(true);
  });

  it("suppresses a paraphrased pending offer even when its title changes", () => {
    const sent = send();
    const repeated = apply(sent.world, [proposal({ subject: "Prompt consultation", terms: "Please provide five days advance notice before moving." })]);
    expect(repeated.rejected).toEqual([]);
    expect(repeated.world.diplomacy).toHaveLength(sent.world.diplomacy.length);
    expect(repeated.factProposals).toEqual([]);
    expect(repeated.applied[0]?.changed).toBe(false);
    expect(repeated.assignedIds.get("consultation")).toBe(sent.world.diplomacy.at(-1)!.id);
  });

  it("permits changed positions within the original business", () => {
    const sent = send();
    const changed = apply(sent.world, [proposal({ negotiation: { ...negotiation, positions: [{ issue: "advance notice days", value: "10" }] }, terms: "Give ten days notice." })]);
    expect(changed.rejected).toEqual([]);
    expect(changed.world.diplomacy).toHaveLength(sent.world.diplomacy.length + 1);
    expect(changed.world.diplomacy.at(-1)?.negotiationId).toBe(sent.world.diplomacy.at(-1)?.id);
    const business = negotiationBusinesses(changed.world.diplomacy).find((entry) => entry.issueKey === negotiation.issueKey)!;
    expect(business.messages).toHaveLength(2);
  });

  it("groups legacy consultation without depending on a particular scenario or title", () => {
    const original = letter({ negotiation: undefined, subject: "Consultation over the northern frontier", terms: "We request consultation before action along the northern frontier." });
    const renewed = { ...original, id: "legacy-renewal", subject: "Prompt notice and consultation", sentAtStep: 2 };
    expect(negotiationBusinesses([original, renewed])).toHaveLength(1);
    expect(redundantDiplomaticOffer([original], renewed, 2, "same")).toBe(original);
    expect(redundantDiplomaticOffer([original], { ...renewed, terms: "We request consultation before action and a payment of 100 talents." }, 2, "same")).toBeUndefined();
  });
  it("allows reminders only after delivery, the deadline and thirty days", () => {
    const m = letter({ replyDueByStep: 50 });
    const offer = { ...m, negotiation: { ...negotiation, reopening: { kind: "reminder" as const, reason: "The reply is overdue." } } };
    expect(redundantDiplomaticOffer([m], offer, 40, "same")).toBe(m);
    expect(redundantDiplomaticOffer([m], offer, 50, "same")).toBeUndefined();
  });

  it("requires an actual changed situation for an unchanged new-event offer", () => {
    const m = letter({ situationKey: "same" });
    const offer = { ...m, negotiation: { ...negotiation, reopening: { kind: "new_event" as const, reason: "An army has arrived." } } };
    expect(redundantDiplomaticOffer([m], offer, 10, "same")).toBe(m);
    expect(redundantDiplomaticOffer([m], offer, 10, "changed")).toBeUndefined();
    const world = initial(), moved = structuredClone(world);
    moved.material.forces.find((force) => force.polityId === "syracuse")!.locationId = "changed-place";
    expect(diplomaticSituationKey(world, "carthage", "syracuse")).not.toBe(diplomaticSituationKey(moved, "carthage", "syracuse"));
  });

  it("preserves a rival's explicit intervention and unrelated private correspondence", () => {
    const m = letter();
    const rival = { ...m, fromCharacterId: "another-diplomat", negotiation: { ...negotiation, reopening: { kind: "rival_intervention" as const, reason: "Challenge Hanno's handling of the talks." } } };
    expect(redundantDiplomaticOffer([m], rival, 1, "same")).toBeUndefined();
    expect(redundantDiplomaticOffer([{ ...m, visibility: "private" }], { ...m, visibility: "private", fromCharacterId: "another-diplomat" }, 1, "same")).toBeUndefined();
  });

  it("compares clause content, numbers and exceptions rather than JSON order", () => {
    const m = letter({ negotiation: undefined, kind: "peace_offer", clauses: [{ kind: "payment", amount: 100 }] });
    expect(sameDiplomaticTerms(m, { ...m, clauses: [{ amount: 100, kind: "payment" }] })).toBe(true);
    expect(sameDiplomaticTerms(m, { ...m, clauses: [{ amount: 200, kind: "payment" }] })).toBe(false);
    expect(sameDiplomaticTerms(m, { ...m, terms: "Five days notice without surrender" })).toBe(false);
  });
});

describe("diplomatic memory and responsibility", () => {
  it("shows pending outgoing business and agreement history, with no incoming leak", () => {
    const world = initial();
    const m = letter();
    world.diplomacy = [m];
    const prompt = renderCharacterPortrait(actor, "Hanno", world, definition.clock);
    expect(prompt).toContain("consultation:strait");
    expect(prompt).toContain("our negotiator [hanno-carthage]");
    expect(prompt).toContain("on the road until day 20");
    expect(diplomaticMemory(world, recipient)).toEqual([]);
    const accepted = day(world, 20);
    accepted.diplomacy = [{ ...m, status: "answered", answer: "accepted", answerText: "Five days is agreed", answeredAtStep: 20 }];
    expect(diplomaticMemory(accepted, actor)[0]?.answer).toBeNull();
    expect(renderCharacterPortrait(recipient, "Hieron", accepted, definition.clock)).toContain("Already agreed in correspondence");
    expect(diplomaticMemory(day(accepted, 40), actor)[0]?.answer).toBe("accepted");
  });

  it("does not wake unrelated officials for routine correspondence", () => {
    const world = day(initial(), 30), m = letter();
    world.diplomacy = [m];
    const fact = emitFacts([{ time: world.instant, atStep: 30, kind: "letter_sent", summary: 'Hanno sent "Notice" to Hieron.', affectedEntities: [{ kind: "polity", id: "carthage" }, { kind: "polity", id: "syracuse" }, { kind: "character", id: actor }, { kind: "character", id: recipient }], resourceChanges: [], visibility: "public", discovery: { state: "public", knowableAtInstant: null, discoveredBy: [] }, eligibleReactionScopes: [], causalDepth: 0, sourceActionId: null, sourceEventId: null, evidence: null }], () => "routine-fact")[0]!;
    const routed = routeAttention({ world, facts: [fact], offices: definition.government.offices, excludeCharacterIds: [], maxFocused: 100, maxCausalDepth: 3 });
    expect([...routed.focused, ...routed.active].every((person) => [actor, recipient].includes(person.characterId))).toBe(true);
    expect(routed.focused.length).toBeGreaterThan(0);
  });

  it("a letter already put to its reader does not repeatedly create urgency", () => {
    const world = day(initial(), 25);
    const candidate = letter({ putToRecipientOnDay: 20 });
    world.diplomacy = [candidate];
    const routed = routeAmbientActors({ world, facts: [], offices: definition.government.offices, excludeCharacterIds: [], max: 100 });
    expect(routed.find((entry) => entry.characterId === recipient)?.why).not.toContain("has a letter to answer");
  });
});

describe("waiting is a dependency, not failed activity", () => {
  const waiting = () => {
    const world = initial(); world.diplomacy = [letter()];
    return layPlan(world, actor, { ambition: "Settle consultation", kind: "office", steps: [{ act: "Conclude the notice agreement after Syracuse replies", inDays: 5, afterConditionDays: 7, when: { kind: "letter_answered", messageId: "test-letter", fromPolityId: "carthage", toPolityId: "syracuse" } }] }, createIdFactory("waiting")).world;
  };
  it("does not miss a step while the reply is travelling or still within its deadline", () => {
    const world = day(waiting(), 15);
    expect(dueSteps(world, definition.clock)).toEqual([]);
    expect(settleOverdueSteps(world, definition.clock, () => "miss").missed).toBe(0);
    expect(nextPlanDay(world)).toBe(30);
    expect(renderCharacterPortrait(actor, "Hanno", world, definition.clock)).toContain("waiting on an external decision");
  });
  it("reviews an expired wait once and wakes again when the exact reply arrives", () => {
    const world = day(waiting(), 30);
    const review = dueSteps(world, definition.clock);
    expect(review[0]?.waiting).toBe(true);
    const reviewed = markWoken(world, review);
    expect(dueSteps(reviewed, definition.clock)).toEqual([]);
    reviewed.diplomacy = [{ ...reviewed.diplomacy[0]!, status: "answered", answer: "accepted", answeredAtStep: 31 }];
    expect(dueSteps(day(reviewed, 31), definition.clock)).toEqual([]);
    expect(nextPlanDay(day(reviewed, 31))).toBe(51);
    const received = day(reviewed, 51);
    expect(dueSteps(received, definition.clock)[0]?.waiting).not.toBe(true);
    expect(settleOverdueSteps(day(received, 57), definition.clock, () => "miss").missed).toBe(0);
  });
  it("waits for a vote's deadline and then allows time to act on its result", () => {
    const world = initial();
    world.material.politicalProcedures.push(PoliticalProcedureSchema.parse({ id: "consultation-vote", type: "decree", institutionId: "carthage-council", sponsorCharacterId: actor, subjectKind: "polity", subjectId: "carthage", label: "Authorize consultation", stage: "proposed", resolutionMechanism: "vote", openedAtStep: 0, deadlineStep: 30, visibility: "public" }));
    const planned = layPlan(world, actor, { ambition: "Obtain consultation authority", kind: "office", steps: [{ act: "Send the authorized proposal", inDays: 5, afterConditionDays: 7, when: { kind: "question_decided", procedureId: "consultation-vote" } }] }, createIdFactory("vote-plan")).world;
    expect(dueSteps(day(planned, 15), definition.clock)).toEqual([]);
    expect(settleOverdueSteps(day(planned, 15), definition.clock, () => "miss").missed).toBe(0);
    expect(nextPlanDay(day(planned, 15))).toBe(30);
    const resolved = day(planned, 31);
    resolved.material.politicalProcedures = resolved.material.politicalProcedures.map((procedure) => ({ ...procedure, resolvedAtStep: 31, stage: "resolved", outcome: "passed" }));
    expect(dueSteps(resolved, definition.clock)).toHaveLength(1);
    expect(settleOverdueSteps(day(resolved, 37), definition.clock, () => "miss").missed).toBe(0);
  });
  it("resolves a wait on the letter sent in the same answer and rejects missing handles", () => {
    const sent = send();
    const plan = { ambition: "Await notice reply", kind: "office" as const, steps: [{ act: "Conclude the notice procedure", inDays: 10, when: { kind: "letter_answered" as const, messageId: "local:consultation", fromPolityId: "carthage", toPolityId: "syracuse" } }] };
    const laid = layPlan(sent.world, actor, plan, createIdFactory("reply-plan"), sent.assignedIds);
    const step = laid.world.characters.find((person) => person.id === actor)!.ambitions.find((want) => want.id === laid.ambitionId)!.steps[0]!;
    expect(step.waitsOn).toMatchObject({ messageId: sent.world.diplomacy.at(-1)!.id });
    expect(layPlan(sent.world, actor, plan, createIdFactory("bad-handle")).ambitionId).toBeNull();
  });
  it("an unrelated earlier answer does not release an exact-letter dependency", () => {
    const world = waiting();
    const earlier = letter({ id: "other-letter", status: "answered", answer: "accepted", answeredAtStep: 1 });
    world.diplomacy.push(earlier);
    const trigger = { kind: "letter_answered" as const, messageId: "test-letter", fromPolityId: "carthage", toPolityId: "syracuse" };
    expect(isWatchSatisfied(trigger, world, day(world, 10))).toBe(false);
    expect(dueSteps(day(world, 10), definition.clock)).toEqual([]);
  });
});

describe("trust follows substantive developments", () => {
  it("procedural acceptance has no polity trust reward", () => {
    const sent = send();
    const delivered = day(sent.world, sent.world.diplomacy.at(-1)!.deliveredOnDay!);
    const answered = apply(delivered, [{ op: "diplomatic_message_answer", messageRef: delivered.diplomacy.at(-1)!.id, answer: "accepted", answerText: "Five days notice is agreed.", reason: "Settle procedure." }], recipient);
    expect(answered.rejected).toEqual([]);
    expect(answered.world.polityStances).toEqual(delivered.polityStances);
  });
  it("a substantive acceptance changes trust once, with changed terms eligible again", () => {
    const m = letter({ kind: "alliance_offer", situationKey: "same", status: "answered", answer: "accepted" });
    expect(diplomaticAnswerChangesTrust([], m)).toBe(true);
    expect(diplomaticAnswerChangesTrust([m], { ...m, id: "repeat", sentAtStep: 40 })).toBe(false);
    expect(diplomaticAnswerChangesTrust([m], { ...m, id: "reminder", sentAtStep: 40, situationKey: "changed" })).toBe(false);
    expect(diplomaticAnswerChangesTrust([m], { ...m, id: "changed", sentAtStep: 40, negotiation: { ...negotiation, positions: [{ issue: "advance notice days", value: "10" }] } })).toBe(true);
  });
});


describe("a duplicate cannot manufacture progress inside a burst", () => {
  it("creates no fresh letter, chronicle fact or completed plan step", async () => {
    const sent = send();
    const world = layPlan(sent.world, actor, { ambition: "Settle consultation", kind: "office", steps: [{ act: "Send the notice proposal", inDays: 3, when: null }] }, createIdFactory("duplicate-plan")).world;
    let asked = false;
    const port: SimModelPort = { complete(operation, _system, user) {
      if (operation === "simulate_orchestrate") return Promise.resolve(JSON.stringify({ intent: { summary: "Wait on events.", domains: ["administration"] }, narrativeSummary: "The consul waits.", frictions: [], deltas: [], facts: [], delegations: [], schedule: [], cognitionCandidates: [], outcome: "continue", playerDecision: null }));
      if (operation !== "simulate_cognition" || !user.includes(`[${actor}]`)) return Promise.resolve(operation === "simulate_cognition" ? '{"actors":[]}' : '{}');
      const section = user.split(/^## /m).find((part) => part.split("\n")[0]?.includes(`[${actor}]`));
      const step = section?.match(/(?:next|missed) \[(plan-step-[^\]]+)\]/)?.[1];
      if (step === undefined) return Promise.resolve('{"actors":[]}');
      asked = true;
      return Promise.resolve(JSON.stringify({ actors: [{ actorRef: { kind: "character", id: actor }, proposal: { deltas: [proposal()], facts: [{ localId: "manufactured", kind: "diplomatic_message_sent", summary: "Hanno sent a fresh notice proposal again.", affectedRefs: [{ kind: "character", id: actor }], visibility: "public", discoveryState: "public", significance: 40 }] }, serves: [{ ref: step, acts: [0] }] }] }));
    } };
    const result = await runSimulationBurst({ world, clock: definition.clock, offices: definition.government.offices, warfare: definition.warfare, burstId: "duplicate-burst", gameId: "business", actorRef: { kind: "character", id: "gaius-genucius" }, actorPolityId: "rome", orderText: "Let three days pass.", spanDays: 3, knownFacts: [], queue: [], port, narratorSeeds: [], budget: { ...DEFAULT_BUDGET, maxFocusedActors: 3, maxAmbientActors: 3 } });
    expect(asked, JSON.stringify({ skipped: result.skipped, plans: result.plans, stop: result.stopReason })).toBe(true);
    expect(result.world.diplomacy.filter((message) => message.fromCharacterId === actor && message.negotiation?.issueKey === negotiation.issueKey)).toHaveLength(1);
    expect(result.newFacts.some((fact) => fact.summary.includes("fresh notice proposal"))).toBe(false);
    expect(result.plans.taken).toBe(0);
  });
});
