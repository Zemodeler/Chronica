import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { DiplomaticMessageSchema, ScenarioDefinitionSchema, WatchPredicateSchema, WorldDeltaSchema, WorldStateSchema, ensureProvinceMaterial, type DiplomaticMessage, type WorldState } from "@chronica/shared";
import { applyDeltas } from "./apply/apply-deltas";
import type { ApplyContext } from "./apply/context";
import { createIdFactory } from "./ports";
import { runDeterministicTick } from "./tick";
import { isWatchSatisfied } from "./watch";

/**
 * "Demand that Syracuse leave Messana. If Hieron refuses, attack."
 *
 * The second sentence hung on the answer to the first, and no trigger could
 * say so: a question put to a chamber could be waited on, a letter could not.
 * Hieron refused and the order never fired.
 */

const definition = ScenarioDefinitionSchema.parse(punicWarsScenario.definition);
const world = (): WorldState => ensureProvinceMaterial(WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld)), 0);
const context: ApplyContext = {
  now: { day: 0, minute: 540 },
  actorRef: { kind: "character", id: "gaius-genucius" },
  offices: definition.government.offices,
  warfare: definition.warfare,
  terrains: definition.map.terrains,
  ids: createIdFactory("refuses"),
  gameId: "game-refuses",
};

const letter = (id: string, answer: DiplomaticMessage["answer"], day: number): DiplomaticMessage => DiplomaticMessageSchema.parse({
  id, kind: "ultimatum", fromPolityId: "rome", fromCharacterId: "gaius-genucius", toPolityId: "syracuse", toCharacterId: "hieron-ii",
  subject: "Leave Messana", terms: "Withdraw from Messana or face Rome.", sentAtStep: 0,
  ...(answer === null ? {} : { status: "answered", answer, answerText: "No.", answeredAtStep: day }),
});
const withLetters = (state: WorldState, letters: readonly DiplomaticMessage[]): WorldState => ({ ...state, diplomacy: [...state.diplomacy, ...letters] });

describe("a letter's answer, waited on", () => {
  const refused = WatchPredicateSchema.parse({ kind: "letter_answered", fromPolityId: "rome", toPolityId: "syracuse", answer: "refused" });

  it("fires when the letter is refused, and not when it is accepted", () => {
    const sent = withLetters(world(), [letter("demand", null, 0)]);
    const answer = (with_: DiplomaticMessage["answer"]): WorldState => ({ ...sent, diplomacy: sent.diplomacy.map((message) => (message.id === "demand" ? letter("demand", with_, 5) : message)) });
    expect(isWatchSatisfied(refused, sent, answer("refused"))).toBe(true);
    expect(isWatchSatisfied(refused, sent, answer("ignored"))).toBe(true);
    expect(isWatchSatisfied(refused, sent, answer("accepted"))).toBe(false);
    expect(isWatchSatisfied({ kind: "letter_answered", fromPolityId: "rome", toPolityId: "syracuse" }, sent, answer("accepted"))).toBe(true);
  });

  it("is not answered by an old refusal", () => {
    const before = withLetters(world(), [letter("old", "refused", 0), letter("demand", null, 0)]);
    expect(isWatchSatisfied(refused, before, before)).toBe(false);
    const now = { ...before, diplomacy: before.diplomacy.map((message) => (message.id === "demand" ? letter("demand", "refused", 5) : message)) };
    expect(isWatchSatisfied(refused, before, now)).toBe(true);
  });

  it("springs the plan laid against it", () => {
    const given = applyDeltas(withLetters(world(), [letter("demand", null, 0)]), [
      WorldDeltaSchema.parse({
        op: "contingency_arm", localId: "attack", label: "Attack, if Hieron refuses", ownerCharacterRef: "gaius-genucius",
        trigger: { kind: "letter_answered", fromPolityId: "rome", toPolityId: "syracuse", answer: "refused" }, effect: "stand_to",
        provinceId: "punic-italy-latium", standingOrder: "Attack the Syracusan army.",
        reason: "The consul's order for when Hieron refuses.",
      }),
    ], context);
    expect(given.rejected).toEqual([]);
    expect(given.world.contingencies.at(-1)!.armedReading).toBe("0");
    const answered = { ...given.world, elapsedStep: 5, instant: { day: 5, minute: 0 }, diplomacy: given.world.diplomacy.map((message) => (message.id === "demand" ? letter("demand", "refused", 5) : message)) };
    const ticked = runDeterministicTick({ world: answered, toDay: 5, ids: createIdFactory("refuses-5"), warfare: definition.warfare });
    expect(ticked.world.contingencies.at(-1)!.status).toBe("sprung");
    expect(ticked.factProposals.filter((fact) => fact.kind === "contingency_met").map((fact) => fact.summary).join(" ")).toContain("Attack the Syracusan army.");
  });
});
