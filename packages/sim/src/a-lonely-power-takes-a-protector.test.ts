import { describe, expect, it } from "vitest";
import { punicWarsScenario } from "@chronica/db";
import { WorldStateSchema, type DiplomaticMessage } from "@chronica/shared";
import { letterVerdict } from "./letter-verdict";

/**
 * Hand run as Hannibal Gisco (docs/reports/2026-10-22-hannibal-gisco-3y-hand-run.md, M5): Messana's spokesman, whose government
 * "seeks a protector before Syracuse closes on the city", was counselled "no (no quarrel of ours)" to Carthage's offer of shelter,
 * and Hieron was given no counsel at all on a pact not to make war.
 */
const world = () => WorldStateSchema.parse(structuredClone(punicWarsScenario.initialWorld));
const letter = (over: Partial<DiplomaticMessage>): DiplomaticMessage => ({
  id: "m1", kind: "alliance_offer", fromPolityId: "carthage", fromCharacterId: "hannibal-gisco", toPolityId: "mamertines", toCharacterId: "mamertine-spokesman",
  subject: "Friendship", terms: "Friendship and the shelter of the fleet.", sentAtStep: 0, replyDueByStep: 60, status: "awaiting_reply", proposes: ["alliance"], visibility: "public", ...over,
} as DiplomaticMessage);

describe("counsel on a letter", () => {
  it("is not 'no quarrel of ours' for a power that has named its want of a protector", () => {
    const state = world();
    const answerer = state.characters.find((character) => character.id === "mamertine-spokesman")!;
    const verdict = letterVerdict(state, letter({}), answerer)!;
    expect(verdict.accepted).toBe(true);
  });

  it("is given for a pact not to make war", () => {
    const state = world();
    const answerer = state.characters.find((character) => character.id === "hieron-ii")!;
    const verdict = letterVerdict(state, letter({ toPolityId: "syracuse", toCharacterId: "hieron-ii", proposes: ["non_aggression", "trade_pact"] }), answerer);
    expect(verdict).not.toBeNull();
  });
});
