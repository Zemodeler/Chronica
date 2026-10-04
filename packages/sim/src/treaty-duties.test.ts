import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { ScenarioDefinitionSchema, WorldDeltaSchema, WorldStateSchema, advanceWorldTo, goalMet, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import { createIdFactory } from "./ports";
import { keepPromises } from "./promises";
import { runDeterministicTick } from "./tick";
import { dutyGoals, impliedUndertakings, offerMetadata, workOnTreatyDuties } from "./treaty-duties";

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const opening = () => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const ROME = "rome";
const CAMPANIANS = "rhegium-campanians";
const DECIUS = "decius-vibellius";
const CONSUL = "gaius-genucius";
const TERMS = "The Campanian legion of Rhegium withdraws from Rhegium within ten days. Rhegium is restored to Rome within twenty days. Rome grants safe passage.";

const commitment = (world: WorldState, by: string, to: string, what: string, goals: NonNullable<WorldState["commitments"][number]["completionGoals"]>, reviewAtStep: number): WorldState["commitments"][number] => ({
  id: `duty-${by}`, promisorCharacterId: by, beneficiaryCharacterId: to, actionKind: "other", description: `Under the treaty: ${what}`, conditions: "", form: "do",
  completionGoals: goals, requiredOfficeId: null, requiredResource: null, visibility: "public", sourceEventId: "peace-rhegium", breachPressureKind: "political_danger",
  status: "pending", createdAtStep: world.elapsedStep, reviewAtStep, resolvedAtStep: null, resolutionReason: null,
});

describe("a treaty's withdrawal and restoration are duties, not prose", () => {
  it("reads both sides' duties out of terms that name them, with their deadlines", () => {
    const duties = impliedUndertakings(opening(), TERMS, ROME, CAMPANIANS, [{ kind: "undertaking", byPolityId: ROME, duty: "protection", what: "Grant safe passage", withinDays: 30 }]);
    expect(duties).toContainEqual(expect.objectContaining({ byPolityId: CAMPANIANS, what: "Withdraw its forces from Rhegium", withinDays: 10 }));
    expect(duties).toContainEqual(expect.objectContaining({ byPolityId: CAMPANIANS, what: "Restore Rhegium to Roman Republic", withinDays: 20 }));
    expect(duties.some((duty) => duty.byPolityId === ROME)).toBe(false);
  });

  it("adds nothing a clause already carries, nor a duty the world cannot bear out", () => {
    const world = opening();
    const carried = [{ kind: "undertaking" as const, byPolityId: CAMPANIANS, duty: "other" as const, what: "Withdraw from Rhegium", withinDays: 5 }];
    expect(impliedUndertakings(world, "The Campanians withdraw from Rhegium.", ROME, CAMPANIANS, carried)).toEqual([]);
    expect(impliedUndertakings(world, "Rome withdraws from Rhegium.", ROME, CAMPANIANS, [])).toEqual([]);
    expect(impliedUndertakings(world, "Both sides keep the peace.", ROME, CAMPANIANS, [])).toEqual([]);
  });

  it("judges a withdrawal by the force leaving and a restoration by the place changing hands", () => {
    const world = opening();
    const withdraw = dutyGoals(world, "Withdraw its forces from Rhegium", CAMPANIANS, ROME)!;
    expect(withdraw).toContainEqual(expect.objectContaining({ kind: "force_withdrawn", forceId: "campanian-legion" }));
    expect(withdraw.every((goal) => goalMet(world, goal) === "not_yet")).toBe(true);
    const restore = dutyGoals(world, "Restore Rhegium to Roman Republic", CAMPANIANS, ROME)!;
    expect(restore).toEqual([expect.objectContaining({ kind: "control", polityId: ROME, settlementId: expect.any(String) })]);
    expect(goalMet(world, restore[0]!)).toBe("not_yet");
  });

  it("sends a power nobody plays out of the place it promised to leave, and finishes the journey", () => {
    const world = opening();
    const goals = dutyGoals(world, "Withdraw its forces from Rhegium", CAMPANIANS, ROME)!;
    world.commitments = [commitment(world, DECIUS, CONSUL, "Withdraw its forces from Rhegium", goals, 10)];
    const begun = workOnTreatyDuties({ world, toDay: 1, ids: createIdFactory("duty"), playerPolityId: ROME });
    const march = begun.world.projects.find((project) => project.completionOutcome?.forceId === "campanian-legion")!;
    expect(march.status).toBe("in_progress");
    expect(begun.facts.some((fact) => fact.kind === "march_begun")).toBe(true);
    // Not sent twice.
    expect(workOnTreatyDuties({ world: begun.world, toDay: 2, ids: createIdFactory("duty2"), playerPolityId: ROME }).world.projects).toHaveLength(begun.world.projects.length);
    const arrived = runDeterministicTick({ world: { ...begun.world, elapsedStep: 1 + march.milestones[0]!.requiredAtElapsedOffset + 1, instant: { day: 1 + march.milestones[0]!.requiredAtElapsedOffset + 1, minute: 0 } },
      toDay: 1 + march.milestones[0]!.requiredAtElapsedOffset + 1, ids: createIdFactory("duty-tick"), playerCharacterId: CONSUL, warfare: definition.warfare });
    expect(goals.every((goal) => goalMet(arrived.world, goal) === "met")).toBe(true);
  });

  it("hands the place back on the day it was promised, and the promise is then kept", () => {
    const world = opening();
    const goals = dutyGoals(world, "Restore Rhegium to Roman Republic", CAMPANIANS, ROME)!;
    world.commitments = [commitment(world, DECIUS, CONSUL, "Restore Rhegium to Roman Republic", goals, 20)];
    const early = workOnTreatyDuties({ world, toDay: 19, ids: createIdFactory("early"), playerPolityId: ROME });
    expect(goalMet(early.world, goals[0]!)).toBe("not_yet");
    const due = workOnTreatyDuties({ world, toDay: 20, ids: createIdFactory("due"), playerPolityId: ROME });
    expect(goalMet(due.world, goals[0]!)).toBe("met");
    expect(keepPromises({ world: due.world, toDay: 20, playerCharacterId: CONSUL }).world.commitments[0]!.status).toBe("fulfilled");
  });

  it("does not do the player's own duties for him", () => {
    const world = opening();
    const goals = dutyGoals(world, "Withdraw its forces from Rhegium", CAMPANIANS, ROME)!;
    world.commitments = [commitment(world, DECIUS, CONSUL, "Withdraw its forces from Rhegium", goals, 10)];
    const result = workOnTreatyDuties({ world, toDay: 1, ids: createIdFactory("mine"), playerPolityId: CAMPANIANS });
    expect(result.world.projects).toHaveLength(world.projects.length);
    expect(result.facts).toEqual([]);
  });
});

describe("an accepted peace carries the duties its terms name", () => {
  const apply = (world: WorldState, actor: string, deltas: unknown[]) => applyDeltas(world, deltas.map((delta) => WorldDeltaSchema.parse(delta)), {
    now: world.instant, actorRef: { kind: "character", id: actor }, offices: definition.government.offices, warfare: definition.warfare,
    ids: createIdFactory(`duties-${world.diplomacy.length}-${actor}`), gameId: "duties-test", playerCharacterId: CONSUL,
  });

  it("makes withdrawal and restoration the Campanians' undertakings though the clauses held only Rome's", () => {
    const sent = apply(opening(), DECIUS, [{ op: "diplomatic_message_send", localId: "offer", kind: "letter", fromPolityId: CAMPANIANS, fromCharacterRef: DECIUS,
      toPolityId: ROME, toCharacterRef: CONSUL, subject: "Safe passage and the return of Rhegium", terms: TERMS, visibility: "public", reason: "Negotiate peace.",
      clauses: [{ kind: "undertaking", byPolityId: ROME, duty: "protection", what: "Grant safe passage to the garrison upon its withdrawal.", withinDays: 30 }] }]);
    expect(sent.rejected).toEqual([]);
    const state = advanceWorldTo(sent.world, { day: sent.world.diplomacy.at(-1)!.deliveredOnDay!, minute: 0 });
    const accepted = apply(state, CONSUL, [{ op: "diplomatic_message_answer", messageRef: state.diplomacy.at(-1)!.id, answer: "accepted", answerText: "Accepted.", reason: "Accept." }]);
    expect(accepted.rejected).toEqual([]);
    const duties = accepted.world.commitments.filter((promise) => promise.description.startsWith("Under the treaty"));
    const withdrawal = duties.find((promise) => promise.description.includes("Withdraw"));
    const restoration = duties.find((promise) => promise.description.includes("Restore"));
    expect(withdrawal).toMatchObject({ promisorCharacterId: DECIUS, completionGoals: [expect.objectContaining({ kind: "force_withdrawn", forceId: "campanian-legion" })] });
    expect(withdrawal!.reviewAtStep - withdrawal!.createdAtStep).toBe(10);
    expect(restoration).toMatchObject({ promisorCharacterId: DECIUS, completionGoals: [expect.objectContaining({ kind: "control", polityId: ROME })] });
    expect(restoration!.reviewAtStep - restoration!.createdAtStep).toBe(20);
    expect(duties.some((promise) => promise.promisorCharacterId === CONSUL)).toBe(true);
    expect(WorldStateSchema.safeParse(accepted.world).success).toBe(true);
  });
});

describe("a plain letter of terms between powers at war is an offer", () => {
  const letter = (terms: string) => ({ kind: "letter" as const, proposes: [] as never[], terms, fromPolityId: CAMPANIANS, toPolityId: ROME });
  it("is recognised when it carries duties, and left alone when it reports or when there is no war", () => {
    const world = opening();
    expect(offerMetadata(world, letter("We agree to withdraw from Rhegium within ten days, if you grant safe passage."))).toEqual({ kind: "peace_offer", proposes: ["peace"] });
    expect(offerMetadata(world, { ...letter("Greetings."), clauses: [{ kind: "undertaking", byPolityId: ROME, duty: "other", what: "Open the strait", withinDays: 10 }] })).toEqual({ kind: "peace_offer", proposes: ["peace"] });
    expect(offerMetadata(world, letter("Our men withdrew from Rhegium last year."))).toEqual({ kind: "letter", proposes: [] });
    expect(offerMetadata({ ...world, polityAgreements: world.polityAgreements.filter((agreement) => agreement.kind !== "war") }, letter("We agree to withdraw from Rhegium within ten days."))).toEqual({ kind: "letter", proposes: [] });
    expect(offerMetadata(world, { ...letter("We agree to withdraw from Rhegium."), onRefusal: "war" })).toEqual({ kind: "letter", proposes: [] });
  });
});
